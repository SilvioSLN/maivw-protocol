import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, padHex, stringToHex, type Address, type Hex } from "viem";
import { createAttestationSigner } from "../src/multichain/AttestationSigner.js";
import type { CanonicalDomainState } from "../src/multichain/FinalizedStateReader.js";
import {
  RelayFanoutService,
  type FanoutDestination,
  type PreparedRelayTransactionSigner,
} from "../src/multichain/RelayFanout.js";
import type { RelayBroadcastAdapter, RelaySubmissionRow } from "../src/multichain/RelaySubmission.js";

const PRIVATE_KEY = `0x${"00".repeat(31)}01` as Hex;
const PROGRAM_ID = "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9";
const EVM_REGISTRY = "0x2222222222222222222222222222222222222222" as Address;
const networkHash = (id: string) => keccak256(stringToHex(id));

function originState(family: "EVM" | "SOLANA"): CanonicalDomainState {
  const domain = `${family.toLowerCase()}.example`;
  const evmKey = padHex("0x1111111111111111111111111111111111111111", { size: 32 });
  return {
    domain,
    domainHash: keccak256(stringToHex(domain)),
    recordKind: "ORIGIN",
    originFamily: family,
    originNetworkHash: networkHash(family === "EVM" ? "evm:8453" : `solana:${PROGRAM_ID}`),
    originRegistry: family === "EVM" ? evmKey : `0x${"33".repeat(32)}` as Hex,
    operationalKey: family === "EVM" ? { algorithm: 1, value: evmKey } : { algorithm: 2, value: `0x${"44".repeat(32)}` as Hex },
    adminKey: family === "EVM" ? { algorithm: 1, value: evmKey } : { algorithm: 2, value: `0x${"45".repeat(32)}` as Hex },
    endpoint: `https://${domain}`,
    tlsFingerprint: `0x${"55".repeat(32)}` as Hex,
    status: "ACTIVE",
    globalDomainEpoch: 1n,
    originSequence: 2n,
    isProvider: false,
    providerTier: 0,
    strikes: 0,
    registrationTime: 1_700_000_000n,
    updatedAt: 1_700_000_001n,
    attestedStake: 0n,
    attestedDailyLimit: 0n,
    originTransactionFamily: family,
    originTransaction: `0x${"66".repeat(32)}` as Hex,
    schemaVersion: 2,
  };
}

class FakeJobs {
  readonly attested: Array<{ destinationId: string; digest: string }> = [];
  async advanceDestination(input: any) {
    this.attested.push({ destinationId: input.destinationId, digest: input.artifactHash });
    return { destination: {}, changed: true } as any;
  }
}

class FakeSubmissions {
  readonly rows = new Map<string, RelaySubmissionRow>();
  async getByDestination(destinationId: string) {
    return [...this.rows.values()].find((row) => row.destinationId === destinationId) ?? null;
  }
  async prepare(input: any) {
    const row = {
      id: `submission:${input.destinationId}`,
      destinationId: input.destinationId,
      expectedTransactionId: input.expectedTransactionId,
      signedPayload: input.signedPayload,
      idempotencyKey: input.idempotencyKey,
    } as RelaySubmissionRow;
    this.rows.set(row.id, row);
    return { submission: row, created: true };
  }
  async submit(id: string, _worker: string, adapter: RelayBroadcastAdapter) {
    const row = this.rows.get(id)!;
    const result = await adapter.broadcast({
      signedPayload: row.signedPayload,
      expectedTransactionId: row.expectedTransactionId,
      idempotencyKey: row.idempotencyKey,
    });
    return { transactionId: result.transactionId, broadcast: true };
  }
}

function adapter(fail = false): RelayBroadcastAdapter {
  return {
    broadcast: async ({ expectedTransactionId }) => {
      if (fail) throw new Error("destination rpc unavailable");
      return { transactionId: expectedTransactionId };
    },
    checkFinality: async () => ({ status: "PENDING" }),
  };
}

const transactionSigner: PreparedRelayTransactionSigner = {
  async sign(input) {
    return {
      signedPayload: input.family === "EVM" ? "0x0102" : "0x0304",
      transactionId: input.family === "EVM" ? "0xevm-tx" : "solana-signature",
    };
  },
};

async function fanout() {
  const jobs = new FakeJobs();
  const submissions = new FakeSubmissions();
  const signer = await createAttestationSigner({
    ORACLE_SIGNER_TYPE: "local",
    ORACLE_PRIVATE_KEY: PRIVATE_KEY,
    GCP_KMS_KEY_VERSION: undefined,
    GCP_KMS_CREDENTIALS_BASE64: undefined,
  });
  return { jobs, submissions, service: new RelayFanoutService(jobs as any, submissions as any, signer, transactionSigner) };
}

test("fans a Solana origin out to an EVM mirror", async () => {
  const { jobs, service } = await fanout();
  const destination: FanoutDestination = {
    family: "EVM", destinationId: "dest-evm", networkId: "evm:42161",
    networkHash: networkHash("evm:42161"), mirrorRegistry: EVM_REGISTRY, adapter: adapter(),
  };
  const result = await service.execute({
    jobId: "job-solana-origin", operation: "REGISTER", state: originState("SOLANA"),
    attestationDeadline: 2_000_000_000n, destinations: [destination], workerId: "worker",
    now: new Date("2026-10-16T12:00:00Z"),
  });
  assert.deepEqual(result.map(({ family, status, transactionId }) => ({ family, status, transactionId })), [
    { family: "EVM", status: "SUBMITTED", transactionId: "0xevm-tx" },
  ]);
  assert.equal(jobs.attested.length, 1);
});

test("fans an EVM origin out to Solana and isolates another destination failure", async () => {
  const { jobs, service } = await fanout();
  const destinations: FanoutDestination[] = [
    {
      family: "EVM", destinationId: "dest-failing", networkId: "evm:42161",
      networkHash: networkHash("evm:42161"), mirrorRegistry: EVM_REGISTRY, adapter: adapter(true),
    },
    {
      family: "SOLANA", destinationId: "dest-solana",
      networkId: `solana:${PROGRAM_ID}`, networkHash: networkHash(`solana:${PROGRAM_ID}`),
      programId: PROGRAM_ID, relayer: "11111111111111111111111111111111", adapter: adapter(),
    },
  ];
  const result = await service.execute({
    jobId: "job-evm-origin", operation: "SYNC", state: originState("EVM"),
    attestationDeadline: 2_000_000_000n, destinations, workerId: "worker",
    now: new Date("2026-10-16T12:00:00Z"),
  });
  assert.equal(result.find((item) => item.destinationId === "dest-failing")?.status, "FAILED");
  assert.equal(result.find((item) => item.destinationId === "dest-solana")?.status, "SUBMITTED");
  assert.equal(result.find((item) => item.destinationId === "dest-solana")?.transactionId, "solana-signature");
  assert.equal(jobs.attested.length, 2, "both branches reach their own attestation before isolated submit");
});
