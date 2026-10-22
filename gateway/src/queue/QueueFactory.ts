import { InMemoryJobQueue } from "./InMemoryJobQueue.js";
import { BullMQJobQueue } from "./BullMQJobQueue.js";
import type { JobQueue, RetryPolicy } from "./types.js";
import { DEFAULT_QUEUE_POLICIES, type StandardQueueName } from "./contracts.js";

export interface JobQueueFactoryOptions {
  driver?: "bullmq" | "memory";
  redisUrl?: string;
  defaultRetry?: RetryPolicy;
}

const queueRegistry = new Map<string, JobQueue<any, any>>();

export function createJobQueue<TData = any, TResult = any>(
  name: string,
  options?: JobQueueFactoryOptions,
): JobQueue<TData, TResult> {
  const existing = queueRegistry.get(name);
  if (existing) return existing as JobQueue<TData, TResult>;

  const defaultRetry = options?.defaultRetry
    ?? (DEFAULT_QUEUE_POLICIES as Record<string, RetryPolicy>)[name]
    ?? { maxAttempts: 3, backoff: { type: "exponential", delayMs: 1000 } };

  const driver = options?.driver
    ?? (process.env.QUEUE_DRIVER as "bullmq" | "memory" | undefined)
    ?? "bullmq";

  let queue: JobQueue<TData, TResult>;

  if (driver === "bullmq" && options?.redisUrl) {
    queue = new BullMQJobQueue<TData, TResult>(name, {
      redisUrl: options.redisUrl,
      defaultRetry,
    });
  } else {
    queue = new InMemoryJobQueue<TData, TResult>(name, defaultRetry);
  }

  queueRegistry.set(name, queue);
  return queue;
}

export function getQueue<TData = any, TResult = any>(name: string): JobQueue<TData, TResult> | undefined {
  return queueRegistry.get(name) as JobQueue<TData, TResult> | undefined;
}

export function listQueues(): readonly JobQueue<any, any>[] {
  return Array.from(queueRegistry.values());
}

export async function closeAllQueues(): Promise<void> {
  for (const queue of queueRegistry.values()) {
    try {
      await queue.close();
    } catch {
      // Ignore cleanup error on close
    }
  }
}

export async function resetQueueFactory(): Promise<void> {
  await closeAllQueues();
  queueRegistry.clear();
}
