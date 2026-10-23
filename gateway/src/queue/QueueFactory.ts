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

export async function pauseAllQueues(): Promise<void> {
  for (const queue of queueRegistry.values()) {
    try {
      await queue.pause();
    } catch {
      // Ignore cleanup error on pause
    }
  }
}

export async function getActiveJobsCount(): Promise<number> {
  let total = 0;
  for (const queue of queueRegistry.values()) {
    try {
      const metrics = await queue.getMetrics();
      total += metrics.active;
    } catch {
      // Ignore metric fetch error
    }
  }
  return total;
}

export async function drainQueues(timeoutMs: number = 5000): Promise<{ drained: boolean; remainingActive: number }> {
  const start = Date.now();
  const pollInterval = 50;
  while (Date.now() - start < timeoutMs) {
    const active = await getActiveJobsCount();
    if (active === 0) return { drained: true, remainingActive: 0 };
    await new Promise((r) => setTimeout(r, pollInterval));
  }
  const remaining = await getActiveJobsCount();
  return { drained: remaining === 0, remainingActive: remaining };
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
