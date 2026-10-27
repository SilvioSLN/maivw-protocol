import { createHash, randomUUID } from "node:crypto";
import { Queue, Worker, type Job as BullJob, type ConnectionOptions } from "bullmq";
import type {
  DeadLetterQueue,
  DlqRecord,
  EnqueueOptions,
  JobProcessor,
  JobQueue,
  JobRecord,
  ProcessOptions,
  QueueMetrics,
  RetryPolicy,
} from "./types.js";

function parseRedisConnection(redisUrl?: string): ConnectionOptions {
  if (!redisUrl) {
    throw new Error("Explicit Redis connection required");
  }
  try {
    const parsed = new URL(redisUrl);
    if (!["redis:", "rediss:"].includes(parsed.protocol)) throw new Error("Redis scheme required");
    return {
      host: parsed.hostname || "127.0.0.1",
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      password: parsed.password || undefined,
      username: parsed.username || undefined,
      ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
      maxRetriesPerRequest: null,
      lazyConnect: true,
      connectTimeout: 5000,
    };
  } catch {
    throw new Error("Invalid Redis connection");
  }
}

class BullMqDlq<TData> implements DeadLetterQueue<TData> {
  constructor(
    private readonly dlqQueue: Queue,
    private readonly mainQueue: BullMQJobQueue<TData, any>,
  ) {}

  async list(options?: { limit?: number; offset?: number }): Promise<DlqRecord<TData>[]> {
    const start = options?.offset ?? 0;
    const end = start + (options?.limit ?? 100) - 1;
    const jobs = await this.dlqQueue.getJobs(["waiting", "completed", "failed"], start, end);
    return jobs.map((job) => this.mapToDlqRecord(job));
  }

  async get(id: string): Promise<DlqRecord<TData> | null> {
    const job = await this.dlqQueue.getJob(id);
    if (!job) return null;
    return this.mapToDlqRecord(job);
  }

  async retry(id: string): Promise<boolean> {
    const job = await this.dlqQueue.getJob(id);
    if (!job) return false;
    const record = this.mapToDlqRecord(job);
    const existing = await this.mainQueue.replayFailed(record.originalJobId);
    if (existing) { await job.remove(); return true; }
    await this.mainQueue.enqueue({
      name: record.name,
      data: record.data,
      id: record.originalJobId,
    });
    await job.remove();
    return true;
  }

  async purge(): Promise<number> {
    const count = await this.dlqQueue.count();
    await this.dlqQueue.drain(true);
    return count;
  }

  async count(): Promise<number> {
    return this.dlqQueue.count();
  }

  private mapToDlqRecord(job: BullJob): DlqRecord<TData> {
    return {
      id: job.id ?? randomUUID(),
      originalJobId: job.data?.__originalJobId ?? job.id ?? "",
      queueName: this.mainQueue.name,
      name: job.name,
      data: job.data?.__payload ?? job.data,
      failedReason: job.failedReason || "Exceeded max retry attempts",
      attemptsMade: job.attemptsMade,
      deadLetteredAt: new Date(job.timestamp),
    };
  }
}

export class BullMQJobQueue<TData = any, TResult = any> implements JobQueue<TData, TResult> {
  readonly dlq: BullMqDlq<TData>;
  private readonly queue: Queue;
  private readonly dlqQueue: Queue;
  private readonly connection: ConnectionOptions | any;
  private worker?: Worker;
  private readonly wireName: string;
  private readonly defaultRetry: RetryPolicy;
  private paused = false;
  private closed = false;

  constructor(
    readonly name: string,
    options?: {
      redisUrl?: string;
      connection?: any;
      defaultRetry?: RetryPolicy;
    },
  ) {
    this.defaultRetry = options?.defaultRetry ?? { maxAttempts: 3, backoff: { type: "exponential", delayMs: 1000 } };
    this.connection = options?.connection ?? parseRedisConnection(options?.redisUrl);
    const sanitizedName = name.replace(/:/g, "-");
    this.wireName = sanitizedName;
    const dlqName = `${sanitizedName}-dlq`;

    this.queue = new Queue(sanitizedName, { connection: this.connection });
    this.queue.on("error", () => {});
    (this.queue as any).connection?.on?.("error", () => {});

    this.dlqQueue = new Queue(dlqName, { connection: this.connection });
    this.dlqQueue.on("error", () => {});
    (this.dlqQueue as any).connection?.on?.("error", () => {});

    this.dlq = new BullMqDlq(this.dlqQueue, this);
  }

  async enqueue(options: EnqueueOptions<TData>): Promise<JobRecord<TData, TResult>> {
    if (this.closed) throw new Error(`Queue "${this.name}" is closed`);

    const logicalId = options.idempotencyKey ?? options.id ?? randomUUID();
    const jobId = this.wireId(logicalId);
    const maxAttempts = options.retry?.maxAttempts ?? this.defaultRetry.maxAttempts;
    const backoffType = options.retry?.backoff?.type ?? this.defaultRetry.backoff?.type ?? "exponential";
    const backoffDelay = options.retry?.backoff?.delayMs ?? this.defaultRetry.backoff?.delayMs ?? 1000;

    const bullJob = await this.queue.add(
      options.name,
      {
        __payload: options.data,
        __idempotencyKey: options.idempotencyKey,
      },
      {
        jobId,
        attempts: maxAttempts,
        backoff: {
          type: backoffType,
          delay: backoffDelay,
        },
        delay: options.delayMs,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    return this.mapToJobRecord(bullJob, options.idempotencyKey);
  }

  process(handler: JobProcessor<TData, TResult>, options?: ProcessOptions): void {
    if (this.worker) throw new Error(`Processor already registered for queue "${this.name}"`);

    this.worker = new Worker(
      this.wireName,
      async (bullJob) => {
        const record = this.mapToJobRecord(bullJob, bullJob.data?.__idempotencyKey);
        record.status = "active";
        record.attempts = bullJob.attemptsMade + 1;
        record.ownership = {
          workerId: `bullmq-worker-${process.pid}`,
          lockedUntil: new Date(Date.now() + 30000),
        };
        return handler(record);
      },
      {
        connection: this.connection,
        concurrency: options?.concurrency ?? 5,
      },
    );

    this.worker.on("error", () => {
      // Catch worker errors
    });

    this.worker.on("failed", async (bullJob, err) => {
      if (!bullJob) return;
      if (bullJob.attemptsMade >= (bullJob.opts.attempts ?? 1)) {
        // Exceeded retries, push to DLQ
        await this.dlqQueue.add(
          bullJob.name,
          {
            __originalJobId: bullJob.id,
            __payload: bullJob.data?.__payload ?? bullJob.data,
            __failedReason: err.message,
          },
          {
            jobId: `dlq-${bullJob.id}`,
            removeOnComplete: false,
            removeOnFail: false,
          },
        );
      }
    });
  }

  async getJob(id: string): Promise<JobRecord<TData, TResult> | null> {
    const bullJob = await this.queue.getJob(this.wireId(id));
    if (!bullJob) return null;
    return this.mapToJobRecord(bullJob, bullJob.data?.__idempotencyKey);
  }

  async getJobByIdempotencyKey(key: string): Promise<JobRecord<TData, TResult> | null> {
    return this.getJob(key);
  }

  async getMetrics(): Promise<QueueMetrics> {
    const counts = await this.queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
    );
    const dlqCount = await this.dlq.count();
    return {
      waiting: (counts.waiting || 0) + (counts.delayed || 0),
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      deadLetter: dlqCount,
    };
  }

  async pause(): Promise<void> {
    this.paused = true;
    if (this.worker) await this.worker.pause();
  }

  async resume(): Promise<void> {
    this.paused = false;
    if (this.worker) this.worker.resume();
  }

  isPaused(): boolean {
    return this.paused;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.worker) await this.worker.close();
    await this.queue.close();
    await this.dlqQueue.close();
  }

  private wireId(id: string) { return id.includes(":") ? createHash("sha256").update(id).digest("hex") : id; }
  async replayFailed(id: string): Promise<boolean> {
    const job = await this.queue.getJob(this.wireId(id));
    if (!job) return false;
    if (await job.getState() !== "failed") throw new Error("Only failed jobs may be replayed from DLQ");
    await job.retry("failed", { resetAttemptsMade: true });
    return true;
  }

  private mapToJobRecord(bullJob: BullJob, idempotencyKey?: string): JobRecord<TData, TResult> {
    return {
      id: bullJob.id ?? randomUUID(),
      queueName: this.name,
      name: bullJob.name,
      data: bullJob.data?.__payload ?? bullJob.data,
      idempotencyKey: idempotencyKey ?? bullJob.data?.__idempotencyKey,
      status: this.mapBullMqStatus(bullJob),
      attempts: bullJob.attemptsMade,
      maxAttempts: bullJob.opts.attempts ?? 3,
      result: bullJob.returnvalue,
      error: bullJob.failedReason ? { message: bullJob.failedReason } : undefined,
      createdAt: new Date(bullJob.timestamp),
      updatedAt: new Date(),
      processedAt: bullJob.processedOn ? new Date(bullJob.processedOn) : undefined,
      completedAt: bullJob.finishedOn && !bullJob.failedReason ? new Date(bullJob.finishedOn) : undefined,
      failedAt: bullJob.finishedOn && bullJob.failedReason ? new Date(bullJob.finishedOn) : undefined,
    };
  }

  private mapBullMqStatus(bullJob: BullJob): JobRecord["status"] {
    if (bullJob.failedReason) {
      return bullJob.attemptsMade >= (bullJob.opts.attempts ?? 1) ? "dead_letter" : "failed";
    }
    if (bullJob.finishedOn) return "completed";
    if (bullJob.processedOn) return "active";
    return "queued";
  }
}
