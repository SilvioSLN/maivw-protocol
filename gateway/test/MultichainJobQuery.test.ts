import assert from "node:assert/strict";
import test from "node:test";
import { MultichainJobQuery } from "../src/multichain/MultichainJobQuery.js";

test("job projection exposes a family-specific Solana transaction without signed payload", async () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  const query = new MultichainJobQuery({
    multichainRelayJob: { findUnique: async () => ({
      id: "11111111-1111-4111-8111-111111111111", domainHash: `0x${"11".repeat(32)}`,
      operation: "REGISTER", status: "SUBMITTED", originNetworkFamily: "EVM",
      originNetworkId: "evm:84532", originRegistryId: `0x${"22".repeat(32)}`,
      sourceTransactionId: `0x${"33".repeat(32)}`, globalDomainEpoch: 1n, originSequence: 2n,
      detectedAt: now, finalizedAt: now, updatedAt: now,
      destinations: [{
        id: "destination-1", destinationNetworkFamily: "SOLANA",
        destinationNetworkId: "solana:11111111111111111111111111111111",
        destinationRegistryId: `0x${"44".repeat(32)}`, status: "SUBMITTED",
        attestationDigest: `0x${"55".repeat(32)}`, confirmationReference: null,
        reconcileReference: null, updatedAt: now,
        submission: {
          status: "BROADCAST", expectedTransactionId: "expected-signature", attempts: 1,
          submittedAt: now, confirmedAt: null, finalityReference: null,
          signedPayload: "must-not-leak",
          attemptsLog: [{ transactionId: "solana-signature", finalityRef: null, outcome: "BROADCAST", createdAt: now }],
        },
      }],
    }) },
  } as any);
  const result = await query.get("11111111-1111-4111-8111-111111111111");
  assert.deepEqual(result?.destinations[0].transaction, { family: "SOLANA", id: "solana-signature" });
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
});
