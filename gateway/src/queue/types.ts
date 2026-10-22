export type JobStatus = "queued" | "active" | "completed" | "failed" | "dead_letter";

export interface BackoffStrategy {
  type: "fixed" | "exponential";
  delayMs: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoff?: BackoffStrategy;
}

export interface EnqueueOptions<TData = any> {
  name: string;
  data: TData;
  id?: string;
  idempotencyKey?: string;
  retry?: RetryPolicy;
  timeoutMs?: number;
  delayMs?: number;
  priority?: number;
}

export interface JobRecord<TData = any, TResult = any> {
  id: string;
  queueName: string;
  name: string;
  data: TData;
  idempotencyKey?: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  result?: TResult;
  error?: { message: string; stack?: string };
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  deadLetterAt?: Date;
  ownership?: { workerId: string; lockedUntil: Date };
}

export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  deadLetter: number;
}

export interface DlqRecord<TData = any> {
  id: string;
  originalJobId: string;
  queueName: string;
  name: string;
  data: TData;
  failedReason: string;
  error?: { message: string; stack?: string };
  attemptsMade: number;
  deadLetteredAt: Date;
}

export interface DeadLetterQueue<TData = any> {
  list(options?: { limit?: number; offset?: number }): Promise<DlqRecord<TData>[]>;
  get(id: string): Promise<DlqRecord<TData> | null>;
  retry(id: string): Promise<boolean>;
  purge(): Promise<number>;
  count(): Promise<number>;
}

export type JobProcessor<TData = any, TResult = any> = (
  job: JobRecord<TData, TResult>
) => Promise<TResult>;

export interface ProcessOptions {
  concurrency?: number;
}

export interface JobQueue<TData = any, TResult = any> {
  readonly name: string;
  readonly dlq: DeadLetterQueue<TData>;
  enqueue(options: EnqueueOptions<TData>): Promise<JobRecord<TData, TResult>>;
  process(handler: JobProcessor<TData, TResult>, options?: ProcessOptions): void;
  getJob(id: string): Promise<JobRecord<TData, TResult> | null>;
  getJobByIdempotencyKey(key: string): Promise<JobRecord<TData, TResult> | null>;
  getMetrics(): Promise<QueueMetrics>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
  isPaused(): boolean;
}
