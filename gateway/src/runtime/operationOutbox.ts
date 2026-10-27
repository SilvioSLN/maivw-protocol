import type { PrismaClient } from "@prisma/client";
import type { JobQueue } from "../queue/types.js";

/** Recover prepared-but-not-started requests; never enqueue ambiguous external effects. */
export async function enqueuePreparedOperations(db: PrismaClient, kind: "MAIL" | "DISPUTE" | "RELAY", queue: JobQueue,
  now = new Date(), minimumAgeMs = 60_000) {
  const before = new Date(now.getTime() - minimumAgeMs);
  const rows = kind === "RELAY"
    ? await db.multichainRelayJob.findMany({ where: { status: { in: ["DETECTED", "FINALIZED", "ATTESTED", "SUBMITTED"] }, queueDispatchExhausted: false, updatedAt: { lt: before } }, select: { id: true }, take: 100, orderBy: { updatedAt: "asc" } })
    : await db.runtimeOperation.findMany({ where: { kind, status: "PREPARED", queueDispatchExhausted: false, createdAt: { lt: before } }, select: { id: true }, take: 100, orderBy: { createdAt: "asc" } });
  for (const row of rows) {
    const existing = await queue.getJob(row.id);
    if (existing && ["failed", "dead_letter"].includes(existing.status) && existing.attempts >= existing.maxAttempts) {
      if (kind === "RELAY") await db.multichainRelayJob.update({ where: { id: row.id }, data: { queueDispatchExhausted: true } });
      else await db.runtimeOperation.update({ where: { id: row.id }, data: { queueDispatchExhausted: true } });
      continue;
    }
    await queue.enqueue({ name: kind.toLowerCase(), id: row.id, data: { version: 1, operationId: row.id } });
  }
  return rows.length;
}
export function startOperationOutbox(db: PrismaClient, kind: "MAIL" | "DISPUTE" | "RELAY", queue: JobQueue, onError: () => void) {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try { await enqueuePreparedOperations(db, kind, queue); } catch { onError(); }
    finally { if (!stopped) timer = setTimeout(poll, 5000); }
  };
  void poll();
  return { stop() { stopped = true; clearTimeout(timer); } };
}
