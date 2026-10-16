import assert from "node:assert/strict";
import test from "node:test";
import {
  RelayCircuitBreakerError,
  RelayCircuitBreakerService,
  RelayCircuitSubmissionGate,
  reconciliationCircuitSignals,
  type RelayCircuitBreakerRepository,
  type RelayCircuitBreakerRow,
  type RelayCircuitEventRow,
  type RelayCircuitSignal,
  type RelayCircuitScope,
} from "../src/multichain/RelayCircuitBreaker.js";
import type { ReconciliationFindingRow } from "../src/multichain/MultichainReconciliation.js";

const bytes = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;

class MemoryCircuitRepository implements RelayCircuitBreakerRepository {
  readonly breakers = new Map<string, RelayCircuitBreakerRow>();
  readonly events: RelayCircuitEventRow[] = [];

  async transaction<T>(operation: (repository: RelayCircuitBreakerRepository) => Promise<T>) { return operation(this); }
  async findBreaker(scopeKey: string) { return this.breakers.get(scopeKey) ?? null; }
  async findOpenBreakers(scopeKeys: readonly string[]) {
    return [...this.breakers.values()].filter((breaker) => scopeKeys.includes(breaker.scopeKey) && breaker.status === "OPEN");
  }
  async findEvent(scopeKey: string, requestId: string) {
    const breaker = this.breakers.get(scopeKey);
    return this.events.find((event) => event.breakerId === breaker?.id && event.requestId === requestId) ?? null;
  }
  async createBreaker(row: RelayCircuitBreakerRow) { this.breakers.set(row.scopeKey, row); }
  async updateBreaker(
    id: string,
    expectedVersion: number,
    next: Pick<RelayCircuitBreakerRow,
      "status" | "triggerSignal" | "reason" | "consecutiveFailures" | "openedAt" | "resetAt" | "lastAuditHash"
    >,
    at: Date,
  ) {
    const breaker = [...this.breakers.values()].find((item) => item.id === id);
    if (!breaker || breaker.version !== expectedVersion) return false;
    this.breakers.set(breaker.scopeKey, { ...breaker, ...next, version: breaker.version + 1, updatedAt: at });
    return true;
  }
  async createEvent(row: RelayCircuitEventRow) { this.events.push(row); }
}

const deployment: RelayCircuitScope = {
  kind: "DOMAIN_DEPLOYMENT",
  domainHash: bytes(1),
  networkId: "solana:11111111111111111111111111111111",
  registryId: bytes(2),
};
const context = { domainHash: bytes(1), networkId: deployment.networkId, registryId: bytes(2) };
const at = (offset: number) => new Date(Date.parse("2026-10-16T15:00:00Z") + offset * 1_000);

test("critical safety signals immediately pause their exact relay scope", async (t) => {
  const signals: RelayCircuitSignal[] = [
    { kind: "ORIGIN_CONFLICT", evidence: { originA: "evm:8453", originB: "solana:mainnet" } },
    { kind: "STATE_DRIFT", evidence: { expected: bytes(3), actual: bytes(4) } },
    { kind: "RPC_DIVERGENCE", evidence: { rpcA: "block:100:a", rpcB: "block:100:b" } },
    { kind: "LOW_BALANCE", asset: "SOL", available: 10n, required: 20n },
  ];
  for (const [index, signal] of signals.entries()) {
    await t.test(signal.kind, async () => {
      const repository = new MemoryCircuitRepository();
      const service = new RelayCircuitBreakerService(repository);
      const result = await service.recordSignal({
        requestId: `critical-${index}`, scope: deployment, signal, observedAt: at(index),
      });
      assert.equal(result.breaker.status, "OPEN");
      assert.equal(result.event.action, "TRIPPED");
      await assert.rejects(
        service.assertRelayAllowed(context),
        (error: unknown) => error instanceof RelayCircuitBreakerError
          && error.code === "CIRCUIT_OPEN" && error.openBreakers.length === 1,
      );
    });
  }
});

test("repeated failures trip only at threshold and success resets a closed counter", async () => {
  const repository = new MemoryCircuitRepository();
  const service = new RelayCircuitBreakerService(repository, { failureThreshold: 3 });
  for (let index = 1; index <= 2; index += 1) {
    const result = await service.recordSignal({
      requestId: `failure-${index}`, scope: deployment,
      signal: { kind: "RELAY_FAILURE", error: `rpc timeout ${index}` }, observedAt: at(index),
    });
    assert.equal(result.breaker.status, "CLOSED");
    assert.equal(result.breaker.consecutiveFailures, index);
  }
  const success = await service.recordSignal({
    requestId: "success", scope: deployment, signal: { kind: "RELAY_SUCCESS" }, observedAt: at(3),
  });
  assert.equal(success.event.action, "FAILURE_COUNTER_RESET");
  assert.equal(success.breaker.consecutiveFailures, 0);
  for (let index = 4; index <= 6; index += 1) {
    await service.recordSignal({
      requestId: `failure-${index}`, scope: deployment,
      signal: { kind: "RELAY_FAILURE", error: `rpc timeout ${index}` }, observedAt: at(index),
    });
  }
  await assert.rejects(service.assertRelayAllowed(context), { code: "CIRCUIT_OPEN" });
});

test("manual reset is audited, idempotent and is the only way to close an open circuit", async () => {
  const repository = new MemoryCircuitRepository();
  const service = new RelayCircuitBreakerService(repository);
  const opened = await service.recordSignal({
    requestId: "drift", scope: deployment,
    signal: { kind: "STATE_DRIFT", evidence: { finding: "finding-1" } }, observedAt: at(1),
  });
  const ignoredSuccess = await service.recordSignal({
    requestId: "success-open", scope: deployment, signal: { kind: "RELAY_SUCCESS" }, observedAt: at(2),
  });
  assert.equal(ignoredSuccess.breaker.status, "OPEN");
  const resetInput = {
    requestId: "reset-1", scope: deployment, actor: "operator:incident-42",
    reason: "RPC quorum and canonical origin verified", resetAt: at(3),
  };
  const reset = await service.reset(resetInput);
  const retry = await service.reset(resetInput);
  assert.equal(reset.breaker.status, "CLOSED");
  assert.equal(reset.event.previousAuditHash, ignoredSuccess.event.auditHash);
  assert.equal(retry.created, false);
  assert.equal(repository.events.length, 3);
  assert.equal(opened.created, true);
  await service.assertRelayAllowed(context);
});

test("submission adapter resolves a destination and enforces its persisted scopes", async () => {
  const repository = new MemoryCircuitRepository();
  const service = new RelayCircuitBreakerService(repository);
  const gate = new RelayCircuitSubmissionGate(service, {
    async resolve(destinationId) { return destinationId === "destination-1" ? context : null; },
  });
  await gate.assertAllowed("destination-1");
  await service.recordSignal({
    requestId: "rpc-divergence", scope: deployment,
    signal: { kind: "RPC_DIVERGENCE", evidence: { primary: "hash-a", secondary: "hash-b" } },
    observedAt: at(1),
  });
  await assert.rejects(gate.assertAllowed("destination-1"), { code: "CIRCUIT_OPEN" });
  await assert.rejects(gate.assertAllowed("unknown"), { code: "INVALID_CIRCUIT" });
});

test("reconciliation maps only origin conflict and state drift to scoped breaker signals", () => {
  const base: ReconciliationFindingRow = {
    id: "finding-1", runId: "run-1", destinationNetworkFamily: "EVM",
    destinationNetworkId: "evm:42161", destinationRegistryId: bytes(2),
    kind: "IN_SYNC", repairAction: "NONE", mirrorStateHash: bytes(3),
    mirrorGlobalDomainEpoch: 1n, mirrorOriginSequence: 1n, details: {}, repair: {},
    auditHash: bytes(4), createdAt: at(1),
  };
  const findings = [
    { ...base, id: "conflict", kind: "ORIGIN_CONFLICT" as const },
    { ...base, id: "drift", kind: "STATE_DRIFT" as const },
    { ...base, id: "behind", kind: "VERSION_BEHIND" as const },
  ];
  const signals = reconciliationCircuitSignals("run-1", bytes(1), findings);
  assert.deepEqual(signals.map((signal) => signal.signal.kind), ["ORIGIN_CONFLICT", "STATE_DRIFT"]);
  assert.ok(signals.every((signal) => signal.scope.kind === "DOMAIN_DEPLOYMENT"));
});
