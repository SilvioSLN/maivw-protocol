import { randomUUID } from "node:crypto";
import type {
  BackoffStrategy,
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

function calculateBackoffDelay(strategy: BackoffStrategy | undefined, attempt: number): number {
  if (!strategy) return 0;
  if (strategy.type === "fixed") return strategy.delayMs;
  return strategy.delayMs * Math.pow(2, Math.max(0, attempt - 1));
}

class InMemoryDlq<TData> implements DeadLetterQueue<TData> {
  private readonly records = new Map<string, DlqRecord<TData>>();

  constructor(private readonly queue: InMemoryJobQueue<TData, any>) {}

  add(record: DlqRecord<TData>): void {
    this.records.set(record.id, record);
  }

  async list(options?: { limit?: number; offset?: number }): Promise<DlqRecord<TData>[]> {
    const all = Array.from(this.records.values());
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async get(id: string): Promise<DlqRecord<TData> | null> {
    return this.records.get(id) ?? null;
  }

  async retry(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) return false;
    this.records.delete(id);
    return this.queue.requeueFromDlq(record.originalJobId);
  }

  async purge(): Promise<number> {
    const count = this.records.size;
    this.records.clear();
    return count;
  }

  async count(): Promise<number> {
    return this.records.size;
  }
}

export class InMemoryJobQueue<TData = any, TResult = any> implements JobQueue<TData, TResult> {
  readonly dlq: InMemoryDlq<TData>;
  private readonly jobs = new Map<string, JobRecord<TData, TResult>>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly waitingQueue: string[] = [];
  private readonly retryPolicies = new Map<string, RetryPolicy>();
  private readonly activeTimers = new Set<NodeJS.Timeout>();

  private handler?: JobProcessor<TData, TResult>;
  private concurrency = 5;
  private activeCount = 0;
  private paused = false;
  private closed = false;

  constructor(
    readonly name: string,
    private readonly defaultRetry: RetryPolicy = {
      maxAttempts: 3,
      backoff: { type: "exponential", delayMs: 1000 },
    },
  ) {
    this.dlq = new InMemoryDlq(this);
  }

  async enqueue(options: EnqueueOptions<TData>): Promise<JobRecord<TData, TResult>> {
    if (this.closed) throw new Error(`Queue "${this.name}" is closed`);

    // 1. Idempotency Check
    if (options.idempotencyKey) {
      const existingJobId = this.idempotencyIndex.get(options.idempotencyKey);
      if (existingJobId) {
        const existingJob = this.jobs.get(existingJobId);
        if (existingJob) return existingJob;
      }
    }

    const id = options.id ?? options.idempotencyKey ?? randomUUID();
    const now = new Date();
    const retry = options.retry ?? this.defaultRetry;

    const job: JobRecord<TData, TResult> = {
      id,
      queueName: this.name,
      name: options.name,
      data: options.data,
      idempotencyKey: options.idempotencyKey,
      status: "queued",
      attempts: 0,
      maxAttempts: retry.maxAttempts,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(id, job);
    this.retryPolicies.set(id, retry);
    if (options.idempotencyKey) {
      this.idempotencyIndex.set(options.idempotencyKey, id);
    }

    if (options.delayMs && options.delayMs > 0) {
      const timer = setTimeout(() => {
        this.activeTimers.delete(timer);
        if (!this.closed && this.jobs.has(id)) {
          this.waitingQueue.push(id);
          this.pump();
        }
      }, options.delayMs);
      this.activeTimers.add(timer);
    } else {
      this.waitingQueue.push(id);
      this.pump();
    }

    return job;
  }

  process(handler: JobProcessor<TData, TResult>, options?: ProcessOptions): void {
    if (this.handler) throw new Error(`Processor already registered for queue "${this.name}"`);
    this.handler = handler;
    if (options?.concurrency && options.concurrency > 0) {
      this.concurrency = options.concurrency;
    }
    this.pump();
  }

  async getJob(id: string): Promise<JobRecord<TData, TResult> | null> {
    return this.jobs.get(id) ?? null;
  }

  async getJobByIdempotencyKey(key: string): Promise<JobRecord<TData, TResult> | null> {
    const id = this.idempotencyIndex.get(key);
    if (!id) return null;
    return this.getJob(id);
  }

  async getMetrics(): Promise<QueueMetrics> {
    let waiting = 0;
    let active = 0;
    let completed = 0;
    let failed = 0;
    let deadLetter = 0;

    for (const job of this.jobs.values()) {
      switch (job.status) {
        case "queued":
          waiting++;
          break;
        case "active":
          active++;
          break;
        case "completed":
          completed++;
          break;
        case "failed":
          failed++;
          break;
        case "dead_letter":
          deadLetter++;
          break;
      }
    }

    return { waiting, active, completed, failed, deadLetter };
  }

  async pause(): Promise<void> {
    this.paused = true;
  }

  async resume(): Promise<void> {
    this.paused = false;
    this.pump();
  }

  isPaused(): boolean {
    return this.paused;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.activeTimers) clearTimeout(timer);
    this.activeTimers.clear();
    this.waitingQueue.length = 0;
  }

  internalRequeue(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || this.closed) return false;
    job.status = "queued";
    job.updatedAt = new Date();
    this.waitingQueue.push(jobId);
    this.pump();
    return true;
  }

  requeueFromDlq(originalJobId: string): boolean {
    const job = this.jobs.get(originalJobId);
    if (!job || this.closed) return false;
    job.status = "queued";
    job.attempts = 0;
    job.error = undefined;
    job.deadLetterAt = undefined;
    job.updatedAt = new Date();
    this.waitingQueue.push(originalJobId);
    this.pump();
    return true;
  }

  private pump(): void {
    if (this.paused || this.closed || !this.handler) return;

    while (this.activeCount < this.concurrency && this.waitingQueue.length > 0) {
      const nextId = this.waitingQueue.shift()!;
      const job = this.jobs.get(nextId);
      if (!job || job.status !== "queued") continue;

      this.activeCount++;
      const now = new Date();
      job.status = "active";
      job.processedAt = now;
      job.updatedAt = now;
      job.ownership = {
        workerId: `in-memory-worker-${process.pid}`,
        lockedUntil: new Date(Date.now() + 30000),
      };

      this.executeJob(job).finally(() => {
        this.activeCount--;
        this.pump();
      });
    }
  }

  private async executeJob(job: JobRecord<TData, TResult>): Promise<void> {
    job.attempts++;
    const retryPolicy = this.retryPolicies.get(job.id) ?? this.defaultRetry;

    try {
      const result = await this.handler!(job);
      const now = new Date();
      job.status = "completed";
      job.result = result;
      job.completedAt = now;
      job.updatedAt = now;
      job.ownership = undefined;
    } catch (err: any) {
      const now = new Date();
      job.error = {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      };
      job.updatedAt = now;
      job.ownership = undefined;

      if (job.attempts < job.maxAttempts) {
        job.status = "failed";
        job.failedAt = now;
        const delay = calculateBackoffDelay(retryPolicy.backoff, job.attempts);

        const timer = setTimeout(() => {
          this.activeTimers.delete(timer);
          if (!this.closed) {
            this.internalRequeue(job.id);
          }
        }, delay);
        this.activeTimers.add(timer);
      } else {
        job.status = "dead_letter";
        job.deadLetterAt = now;

        const dlqRecord: DlqRecord<TData> = {
          id: `dlq-${job.id}`,
          originalJobId: job.id,
          queueName: this.name,
          name: job.name,
          data: job.data,
          failedReason: job.error.message,
          error: job.error,
          attemptsMade: job.attempts,
          deadLetteredAt: now,
        };
        this.dlq.add(dlqRecord);
      }
    }
  }
}
