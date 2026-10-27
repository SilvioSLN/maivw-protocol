import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createJobQueue,
  resetQueueFactory,
  InMemoryJobQueue,
  BullMQJobQueue,
  STANDARD_QUEUES,
  DEFAULT_QUEUE_POLICIES,
  QUEUE_ROLE_OWNERS,
  type MailSendJobData,
} from "../src/queue/index.js";

test("JobQueue: basic enqueue and process executes to completion", async () => {
  const queue = new InMemoryJobQueue<{ text: string }, { echo: string }>("test-basic");
  try {
    let processed = false;
    queue.process(async (job) => {
      processed = true;
      assert.equal(job.data.text, "hello");
      return { echo: `echo:${job.data.text}` };
    });

    const job = await queue.enqueue({
      name: "echo-task",
      data: { text: "hello" },
    });

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    const updated = await queue.getJob(job.id);
    assert.equal(processed, true);
    assert.equal(updated?.status, "completed");
    assert.deepEqual(updated?.result, { echo: "echo:hello" });
    assert.equal(updated?.attempts, 1);

    const metrics = await queue.getMetrics();
    assert.equal(metrics.completed, 1);
    assert.equal(metrics.waiting, 0);
  } finally {
    await queue.close();
  }
});

test("JobQueue: idempotency key guarantees duplicate submissions do not execute twice", async () => {
  const queue = new InMemoryJobQueue<{ counter: number }>("test-idempotency");
  try {
    let executionCount = 0;
    queue.process(async () => {
      executionCount++;
    });

    const idempotencyKey = "tx-unique-12345";
    const job1 = await queue.enqueue({
      name: "dedup-task",
      data: { counter: 1 },
      idempotencyKey,
    });

    const job2 = await queue.enqueue({
      name: "dedup-task",
      data: { counter: 2 },
      idempotencyKey,
    });

    // Both return the exact same job ID
    assert.equal(job1.id, job2.id);
    assert.equal(job2.idempotencyKey, idempotencyKey);

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(executionCount, 1);

    const byKey = await queue.getJobByIdempotencyKey(idempotencyKey);
    assert.equal(byKey?.id, job1.id);
    assert.equal(byKey?.status, "completed");
  } finally {
    await queue.close();
  }
});

test("JobQueue: retries transient failures with backoff", async () => {
  const queue = new InMemoryJobQueue("test-retry", {
    maxAttempts: 3,
    backoff: { type: "fixed", delayMs: 20 },
  });
  try {
    let attemptsMade = 0;
    queue.process(async (job) => {
      attemptsMade++;
      if (attemptsMade < 3) {
        throw new Error(`Transient failure on attempt ${attemptsMade}`);
      }
      return { success: true };
    });

    const job = await queue.enqueue({
      name: "flaky-task",
      data: { action: "send" },
    });

    // Wait long enough for retries
    await new Promise((resolve) => setTimeout(resolve, 150));

    const updated = await queue.getJob(job.id);
    assert.equal(attemptsMade, 3);
    assert.equal(updated?.status, "completed");
    assert.deepEqual(updated?.result, { success: true });
    assert.equal(updated?.attempts, 3);
  } finally {
    await queue.close();
  }
});

test("JobQueue: dead-letter queue (DLQ) captures exhausted jobs with error context", async () => {
  const queue = new InMemoryJobQueue("test-dlq", {
    maxAttempts: 2,
    backoff: { type: "fixed", delayMs: 10 },
  });
  try {
    queue.process(async () => {
      throw new Error("Permanent fatal failure");
    });

    const job = await queue.enqueue({
      name: "doomed-task",
      data: { critical: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 80));

    const updated = await queue.getJob(job.id);
    assert.equal(updated?.status, "dead_letter");
    assert.equal(updated?.attempts, 2);
    assert.ok(updated?.error?.message.includes("Permanent fatal failure"));

    const dlqCount = await queue.dlq.count();
    assert.equal(dlqCount, 1);

    const dlqList = await queue.dlq.list();
    assert.equal(dlqList.length, 1);
    assert.equal(dlqList[0].originalJobId, job.id);
    assert.equal(dlqList[0].failedReason, "Permanent fatal failure");
    assert.equal(dlqList[0].attemptsMade, 2);

    const metrics = await queue.getMetrics();
    assert.equal(metrics.deadLetter, 1);
  } finally {
    await queue.close();
  }
});

test("JobQueue: DLQ replay re-enqueues and processes job to completion", async () => {
  const queue = new InMemoryJobQueue("test-dlq-replay", {
    maxAttempts: 1,
  });
  try {
    let shouldFail = true;
    queue.process(async () => {
      if (shouldFail) throw new Error("Service down");
      return { recovered: true };
    });

    const job = await queue.enqueue({
      name: "replay-task",
      data: { step: 1 },
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    const dlqItem = (await queue.dlq.list())[0];
    assert.ok(dlqItem);

    // Now fix service and replay from DLQ
    shouldFail = false;
    const replayed = await queue.dlq.retry(dlqItem.id);
    assert.equal(replayed, true);

    await new Promise((resolve) => setTimeout(resolve, 30));

    const dlqAfter = await queue.dlq.count();
    assert.equal(dlqAfter, 0);

    const finished = await queue.getJob(job.id);
    assert.equal(finished?.status, "completed");
    assert.deepEqual(finished?.result, { recovered: true });
  } finally {
    await queue.close();
  }
});

test("JobQueue: respects concurrency limits under backpressure", async () => {
  const queue = new InMemoryJobQueue<{ idx: number }>("test-concurrency");
  try {
    let maxConcurrent = 0;
    let currentActive = 0;

    queue.process(
      async () => {
        currentActive++;
        if (currentActive > maxConcurrent) maxConcurrent = currentActive;
        await new Promise((resolve) => setTimeout(resolve, 30));
        currentActive--;
      },
      { concurrency: 2 },
    );

    for (let i = 0; i < 6; i++) {
      await queue.enqueue({ name: "concurrency-job", data: { idx: i } });
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(maxConcurrent, 2);
    const metrics = await queue.getMetrics();
    assert.equal(metrics.completed, 6);
  } finally {
    await queue.close();
  }
});

test("JobQueue: pause and resume halts and continues processing", async () => {
  const queue = new InMemoryJobQueue("test-pause");
  try {
    let processed = false;
    queue.process(async () => {
      processed = true;
    });

    await queue.pause();
    assert.equal(queue.isPaused(), true);

    await queue.enqueue({ name: "paused-job", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(processed, false);

    await queue.resume();
    assert.equal(queue.isPaused(), false);

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(processed, true);
  } finally {
    await queue.close();
  }
});

test("JobQueue: standard queue contracts and role ownership are mapped", () => {
  assert.equal(STANDARD_QUEUES.MAIL_SEND, "mail:send");
  assert.equal(STANDARD_QUEUES.ORACLE_DISPUTE, "oracle:dispute");
  assert.equal(STANDARD_QUEUES.RELAYER_MIRROR, "relayer:mirror");

  assert.equal(QUEUE_ROLE_OWNERS["mail:send"], "mail-worker");
  assert.equal(QUEUE_ROLE_OWNERS["oracle:dispute"], "oracle-worker");
  assert.equal(QUEUE_ROLE_OWNERS["relayer:mirror"], "relayer-worker");

  assert.equal(DEFAULT_QUEUE_POLICIES["mail:send"].maxAttempts, 3);
  assert.equal(DEFAULT_QUEUE_POLICIES["oracle:dispute"].maxAttempts, 3);
  assert.equal(DEFAULT_QUEUE_POLICIES["relayer:mirror"].maxAttempts, 20);
});

test("JobQueue: QueueFactory manages instances and supports typed queues", async () => {
  await resetQueueFactory();
  try {
    const q1 = createJobQueue<MailSendJobData>(STANDARD_QUEUES.MAIL_SEND, { driver: "memory" });
    const q2 = createJobQueue<MailSendJobData>(STANDARD_QUEUES.MAIL_SEND, { driver: "memory" });
    assert.equal(q1, q2);

    const job = await q1.enqueue({
      name: "dispatch-email",
      data: {
        messageId: "msg-123",
        senderDomain: "test.com",
        recipient: "user@test.com",
        subject: "Hello",
      },
    });

    assert.equal(job.name, "dispatch-email");
    assert.equal(job.data.messageId, "msg-123");
  } finally {
    await resetQueueFactory();
  }
});

test("JobQueue: BullMQJobQueue instantiates with correct contract and closes cleanly", async () => {
  const { EventEmitter } = await import("node:events");
  class MockRedis extends EventEmitter {
    status = "ready";
    options = {};
    duplicate() { return new MockRedis(); }
    async quit() { return "OK"; }
    disconnect() {}
    async client() { return "OK"; }
    async info() { return "redis_version:7.0.0"; }
  }

  const mock = new MockRedis();
  const bullQueue = new BullMQJobQueue("test:bullmq", {
    connection: mock,
  });
  assert.equal(bullQueue.name, "test:bullmq");
  assert.ok(bullQueue.dlq);
  await bullQueue.close();
});

