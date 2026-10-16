import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import { LedgerService } from "../src/services/LedgerService.js";
import { LedgerAdapterError, type LedgerAdapter } from "../src/services/ledger/LedgerAdapter.js";
import { parseNetworkId, parseRegistryId } from "../src/multichain/NetworkModel.js";

const registry = "0x1111111111111111111111111111111111111111";
const bytes = (value: number) => `0x${value.toString(16).padStart(64, "0")}` as Hex;

function fakeSolanaAdapter(healthError?: Error & { code?: string }): LedgerAdapter {
  const network = {
    family: "SOLANA", networkId: parseNetworkId("SOLANA", "solana:11111111111111111111111111111111"),
    registryId: parseRegistryId(bytes(2)), registryVersion: 2, name: "Solana Test",
    rpcUrl: "https://api.testnet.solana.com", genesisHash: "11111111111111111111111111111111",
    programId: "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9",
    explorer: { family: "SOLANA", baseUrl: "https://explorer.solana.com", clusterQuery: "cluster=testnet", transactionPath: "/tx/{id}", addressPath: "/address/{id}", blockPath: "/block/{id}" },
    asset: { family: "SOLANA", kind: "NATIVE", symbol: "SOL", decimals: 9, mint: null },
    finality: { family: "SOLANA", mode: "COMMITMENT", commitment: "finalized", reorgMarginSlots: 64 },
    capabilities: { origin: true, mirror: true },
  } as const;
  return {
    network,
    family: "SOLANA",
    networkId: network.networkId,
    registryId: network.registryId,
    async readDomainIdentity(domain) {
      return {
        family: "SOLANA", networkId: this.networkId, registryId: this.registryId,
        recordKind: "ORIGIN", domain, endpointUrl: "https://mail.example.com",
        operationalKey: { algorithm: 2, keyData: bytes(3) },
        adminKey: { algorithm: 2, keyData: bytes(4) }, status: "ACTIVE",
        globalDomainEpoch: 1n, originSequence: 2n,
        originNetworkHash: bytes(5), originRegistryId: this.registryId,
      };
    },
    async readProviderState() {
      return { isProvider: true, tier: 2, stake: 100n, attestedStake: 100n, dailyLimit: 1_000n, strikes: 0, suspended: false };
    },
    async checkHealth() {
      if (healthError) throw healthError;
    },
  };
}

function config() {
  return {
    RPC_URL: "http://localhost:8545", CHAIN_ID: 31337,
    REGISTRY_CONTRACT_ADDRESS: registry,
  } as any;
}

test("facade routes common reads by canonical NetworkId without family switches", async () => {
  const solana = fakeSolanaAdapter();
  const ledger = new LedgerService(config(), [solana]);
  assert.equal(ledger.listAdapters().length, 2);
  assert.equal(ledger.getPrimaryNetworkId(), "evm:31337");
  const identity = await ledger.readDomainIdentity(solana.networkId, "example.com");
  assert.equal(identity?.family, "SOLANA");
  assert.equal(identity?.operationalKey.algorithm, 2);
  assert.equal((await ledger.readProviderState(solana.networkId, "example.com"))?.stake, 100n);
  await ledger.checkNetworkHealth(solana.networkId);
});

test("facade rejects unknown or duplicate adapters and preserves the legacy EVM surface", () => {
  const solana = fakeSolanaAdapter();
  const ledger = new LedgerService(config(), [solana]);
  assert.equal(ledger.getContractAddress(), registry);
  assert.throws(
    () => ledger.getAdapter("evm:84532"),
    (error: unknown) => error instanceof LedgerAdapterError && error.code === "LEDGER_ADAPTER_NOT_FOUND",
  );
  assert.throws(
    () => new LedgerService(config(), [solana, solana]),
    (error: unknown) => error instanceof LedgerAdapterError && error.code === "LEDGER_ADAPTER_CONFLICT",
  );
});

test("network catalog exposes configured deployments, capabilities and observed health without RPC URLs", async () => {
  const solana = fakeSolanaAdapter();
  const ledger = new LedgerService(config(), [solana]);
  ledger.getAdapter(ledger.getPrimaryNetworkId()).checkHealth = async () => {};

  const networks = await ledger.getMultichainNetworks();
  assert.equal(networks.length, 2);

  const evm = networks.find((network) => network.networkId === "evm:31337");
  assert.ok(evm);
  assert.deepEqual(evm.capabilities, { origin: true, mirror: true });
  assert.equal(evm.state.status, "AVAILABLE");
  assert.equal(evm.explorer.family, "EVM");
  assert.equal("rpcUrl" in evm, false);

  const solanaNetwork = networks.find((network) => network.family === "SOLANA");
  assert.ok(solanaNetwork);
  assert.equal(solanaNetwork.registryId, solana.registryId);
  assert.equal(solanaNetwork.asset.symbol, "SOL");
  assert.equal(solanaNetwork.finality.commitment, "finalized");
  assert.equal(solanaNetwork.state.status, "AVAILABLE");
  assert.match(solanaNetwork.state.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("network catalog isolates adapter health failures and publishes only a stable error code", async () => {
  const healthError = Object.assign(new Error("RPC contained secret detail"), { code: "SOLANA_GENESIS_MISMATCH" });
  const ledger = new LedgerService(config(), [fakeSolanaAdapter(healthError)]);
  ledger.getAdapter(ledger.getPrimaryNetworkId()).checkHealth = async () => {};

  const networks = await ledger.getMultichainNetworks();
  const solanaNetwork = networks.find((network) => network.family === "SOLANA");
  assert.ok(solanaNetwork);
  assert.deepEqual(solanaNetwork.state, {
    status: "UNAVAILABLE",
    checkedAt: solanaNetwork.state.checkedAt,
    errorCode: "SOLANA_GENESIS_MISMATCH",
  });
  assert.equal(JSON.stringify(solanaNetwork).includes("secret detail"), false);
});
