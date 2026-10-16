import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import { LedgerService } from "../src/services/LedgerService.js";
import { LedgerAdapterError, type LedgerAdapter } from "../src/services/ledger/LedgerAdapter.js";
import { parseNetworkId, parseRegistryId } from "../src/multichain/NetworkModel.js";

const registry = "0x1111111111111111111111111111111111111111";
const bytes = (value: number) => `0x${value.toString(16).padStart(64, "0")}` as Hex;

function fakeSolanaAdapter(): LedgerAdapter {
  return {
    family: "SOLANA",
    networkId: parseNetworkId("SOLANA", "solana:11111111111111111111111111111111"),
    registryId: parseRegistryId(bytes(2)),
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
    async checkHealth() {},
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
