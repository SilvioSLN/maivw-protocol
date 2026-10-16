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

const EVM_RPC = process.env.LOCAL_EVM_RPC_URL;
const SOLANA_RPC = process.env.LOCAL_SOLANA_RPC_URL;
const PROGRAM_ID = "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9";
const EVM_REGISTRY = "0x2222222222222222222222222222222222222222" as Address;
const PRIVATE_KEY = `0x${"00".repeat(31)}01` as Hex;
const hashNetwork = (networkId: string) => keccak256(stringToHex(networkId));
let solanaNetworkId = `solana:${PROGRAM_ID}`;

async function rpc(url: string, method: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  });
  assert.equal(response.ok, true, `${method} RPC failed with HTTP ${response.status}`);
  const body = await response.json() as { result?: unknown; error?: unknown };
  assert.equal(body.error, undefined, `${method} RPC returned ${JSON.stringify(body.error)}`);
  return body.result;
}

function origin(family: "EVM" | "SOLANA", sequence: bigint): CanonicalDomainState {
  const domain = `${family.toLowerCase()}-origin.local`;
  const evmKey = padHex("0x1111111111111111111111111111111111111111", { size: 32 });
  return {
    domain,
    domainHash: keccak256(stringToHex(domain)),
    recordKind: "ORIGIN",
    originFamily: family,
    originNetworkHash: hashNetwork(family === "EVM" ? "evm:31337" : solanaNetworkId),
    originRegistry: family === "EVM" ? padHex(EVM_REGISTRY, { size: 32 }) : `0x${"33".repeat(32)}` as Hex,
    operationalKey: family === "EVM"
      ? { algorithm: 1, value: evmKey }
      : { algorithm: 2, value: `0x${"44".repeat(32)}` as Hex },
    adminKey: family === "EVM"
      ? { algorithm: 1, value: evmKey }
      : { algorithm: 2, value: `0x${"45".repeat(32)}` as Hex },
    endpoint: `https://${domain}/inbox`,
    tlsFingerprint: `0x${"55".repeat(32)}` as Hex,
    status: "ACTIVE",
    globalDomainEpoch: 1n,
    originSequence: sequence,
    isProvider: false,
    providerTier: 0,
    strikes: 0,
    registrationTime: 1_700_000_000n,
    updatedAt: 1_700_000_001n,
    attestedStake: 65_000_000n,
    attestedDailyLimit: 0n,
    originTransactionFamily: family,
    originTransaction: `0x${"66".repeat(32)}` as Hex,
    schemaVersion: 2,
  };
}

class LocalRegistry {
  readonly records = new Map<string, CanonicalDomainState>();

  registerOrigin(state: CanonicalDomainState): void {
    assert.equal(state.recordKind, "ORIGIN");
    assert.equal(this.records.has(state.domainHash), false, "origin must be unique per registry");
    this.records.set(state.domainHash, structuredClone(state));
  }

  applyMirror(state: CanonicalDomainState): void {
    this.records.set(state.domainHash, { ...structuredClone(state), recordKind: "MIRROR" });
  }
}

class Jobs {
  async advanceDestination() { return { destination: {}, changed: true } as any; }
}

class Submissions {
  private readonly rows = new Map<string, RelaySubmissionRow>();
  async getByDestination(destinationId: string) {
    return [...this.rows.values()].find((row) => row.destinationId === destinationId) ?? null;
  }
  async prepare(input: any) {
    const row = { id: `submission:${input.destinationId}`, ...input } as RelaySubmissionRow;
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

test("local EVM and Solana validators converge bidirectional origin fan-out", {
  skip: !EVM_RPC || !SOLANA_RPC ? "run through integration/run-local-multichain.sh" : false,
}, async () => {
  assert.equal(await rpc(EVM_RPC!, "eth_chainId"), "0x7a69");
  const genesisHash = String(await rpc(SOLANA_RPC!, "getGenesisHash"));
  assert.match(genesisHash, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  solanaNetworkId = `solana:${genesisHash}`;

  const evm = new LocalRegistry();
  const solana = new LocalRegistry();
  const signer = await createAttestationSigner({
    ORACLE_SIGNER_TYPE: "local",
    ORACLE_PRIVATE_KEY: PRIVATE_KEY,
    GCP_KMS_KEY_VERSION: undefined,
    GCP_KMS_CREDENTIALS_BASE64: undefined,
  });
  let activeOrigin!: CanonicalDomainState;
  const txSigner: PreparedRelayTransactionSigner = {
    async sign(input) {
      const suffix = input.family === "EVM" ? "evm" : "solana";
      return { signedPayload: `signed-${suffix}`, transactionId: `local-${suffix}-${activeOrigin.originSequence}` };
    },
  };
  const service = new RelayFanoutService(new Jobs() as any, new Submissions() as any, signer, txSigner);
  const destination = (family: "EVM" | "SOLANA", registry: LocalRegistry): FanoutDestination => ({
    ...(family === "EVM"
      ? { family, destinationId: "evm-destination", networkId: "evm:31337", networkHash: hashNetwork("evm:31337"), mirrorRegistry: EVM_REGISTRY }
      : { family, destinationId: "solana-destination", networkId: solanaNetworkId, networkHash: hashNetwork(solanaNetworkId), programId: PROGRAM_ID, relayer: "11111111111111111111111111111111" }),
    adapter: {
      broadcast: async ({ expectedTransactionId }) => {
        registry.applyMirror(activeOrigin);
        return { transactionId: expectedTransactionId };
      },
      checkFinality: async () => ({ status: "CONFIRMED", finalizedReference: "local-finalized" }),
    },
  } as FanoutDestination);

  activeOrigin = origin("SOLANA", 1n);
  solana.registerOrigin(activeOrigin);
  const toEvm = await service.execute({
    jobId: "solana-to-evm", operation: "REGISTER", state: activeOrigin,
    attestationDeadline: 2_000_000_000n, destinations: [destination("EVM", evm)],
    workerId: "local-integration", now: new Date("2026-10-16T12:00:00Z"),
  });
  assert.equal(toEvm[0].status, "SUBMITTED");
  assert.deepEqual(evm.records.get(activeOrigin.domainHash), { ...activeOrigin, recordKind: "MIRROR" });

  activeOrigin = origin("EVM", 7n);
  evm.registerOrigin(activeOrigin);
  const toSolana = await service.execute({
    jobId: "evm-to-solana", operation: "REGISTER", state: activeOrigin,
    attestationDeadline: 2_000_000_000n, destinations: [destination("SOLANA", solana)],
    workerId: "local-integration", now: new Date("2026-10-16T12:00:00Z"),
  });
  assert.equal(toSolana[0].status, "SUBMITTED");
  assert.deepEqual(solana.records.get(activeOrigin.domainHash), { ...activeOrigin, recordKind: "MIRROR" });
});
