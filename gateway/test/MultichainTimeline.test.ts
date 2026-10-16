import assert from "node:assert/strict";
import test from "node:test";
import { MultichainTimelineService } from "../src/multichain/MultichainTimeline.js";

const at = (minute: number) => new Date(`2026-10-16T12:${String(minute).padStart(2, "0")}:00.000Z`);

test("timeline orders registration, fan-out, finality, attestation, confirmation and reconciliation", async () => {
  const service = new MultichainTimelineService({
    originRecord: { findUnique: async () => ({
      id: "origin", status: "ACTIVE", activatedAt: at(0), originNetworkFamily: "EVM",
      originNetworkId: "evm:84532", originTxFamily: "EVM", originTxId: `0x${"11".repeat(32)}`,
      globalDomainEpoch: 1n, originSequence: 2n,
    }) },
    multichainRelayJob: { findMany: async () => [{
      id: "job", operation: "REGISTER", status: "CONFIRMED", detectedAt: at(1),
      originNetworkFamily: "EVM", originNetworkId: "evm:84532", sourceTransactionId: `0x${"11".repeat(32)}`,
      destinations: [{ id: "destination", destinationNetworkFamily: "SOLANA", networkId: "unused", destinationNetworkId: "solana:11111111111111111111111111111111", status: "CONFIRMED" }],
      transitions: [
        { id: "final", destinationId: null, toStatus: "FINALIZED", createdAt: at(2), artifactHash: "state", reference: null, reason: null },
        { id: "attest", destinationId: "destination", toStatus: "ATTESTED", createdAt: at(3), artifactHash: "digest", reference: null, reason: null },
        { id: "confirm", destinationId: "destination", toStatus: "CONFIRMED", createdAt: at(4), artifactHash: null, reference: "solana-signature", reason: null },
      ],
    }] },
    multichainReconciliationRun: { findMany: async () => [{ id: "run", status: "IN_SYNC", completedAt: at(5), auditHash: "audit", findings: [] }] },
  } as any);
  const result = await service.get(`0x${"22".repeat(32)}`);
  assert.deepEqual(result.entries.map((entry) => entry.stage), ["REGISTRATION", "FAN_OUT", "FINALITY", "ATTESTATION", "CONFIRMATION", "RECONCILIATION"]);
  assert.deepEqual(result.entries[4].transaction, { family: "SOLANA", id: "solana-signature" });
  assert.equal(JSON.stringify(result).includes("signedPayload"), false);
});
