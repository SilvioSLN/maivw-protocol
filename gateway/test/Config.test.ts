import { test } from "node:test";
import assert from "node:assert/strict";
import { EnvSchema, environmentSafetyErrors, isLocalDemoConfig, parseEnvironment } from "../src/config.js";
import { createConfiguredLedgerAdapters } from "../src/services/ledger/LedgerAdapterFactory.js";
import { Keypair } from "@solana/web3.js";

const required = { JWT_SECRET: "a".repeat(32), MASTER_SECRET_KEY: "b".repeat(32), INTERNAL_SERVICE_KEY: "c".repeat(32) };
const solanaRelayer = Keypair.fromSeed(Uint8Array.from(Array(32).fill(1)));
const solanaConfig = {
  SOLANA_ENABLED: true,
  SOLANA_RPC_URL: "https://api.testnet.solana.com",
  SOLANA_WS_URL: "wss://api.testnet.solana.com",
  SOLANA_GENESIS_HASH: "11111111111111111111111111111111",
  SOLANA_PROGRAM_ID: "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9",
  SOLANA_RELAYER_PUBLIC_KEY: solanaRelayer.publicKey.toBase58(),
  SOLANA_RELAYER_KEYPAIR_BASE64: Buffer.from(JSON.stringify([...solanaRelayer.secretKey])).toString("base64"),
};

test("IS_CLOUD interprets string false as false and rejects ambiguous flags", () => {
  for (const [input, expected] of [["false", false], ["true", true], [false, false], [true, true], [undefined, false]]) {
    assert.equal(EnvSchema.parse({ ...required, IS_CLOUD: input }).IS_CLOUD, expected);
  }
  assert.equal(EnvSchema.safeParse({ ...required, IS_CLOUD: "no" }).success, false);
});

test("Solana deployment fails fast on partial RPC, WS, program, signer or commitment configuration", () => {
  assert.equal(EnvSchema.safeParse({ ...required, SOLANA_ENABLED: true }).success, false);
  assert.equal(EnvSchema.safeParse({ ...required, ...solanaConfig, SOLANA_COMMITMENT: "confirmed" }).success, false);
  assert.equal(EnvSchema.safeParse({ ...required, ...solanaConfig, SOLANA_RELAYER_KEYPAIR_BASE64: "invalid" }).success, false);
  assert.equal(EnvSchema.safeParse({ ...required, ...solanaConfig, SOLANA_OBSERVER_PAGE_SIZE: 1001 }).success, false);
});

test("validated configuration constructs only explicitly enabled EVM and Solana adapters", () => {
  const config = EnvSchema.parse({
    ...required,
    ...solanaConfig,
    MULTICHAIN_RELAY_ENABLED: true,
    ORACLE_PRIVATE_KEY: `0x${"11".repeat(32)}`,
    BASE_REGISTRY_ADDRESS: "0x1111111111111111111111111111111111111111",
    BASE_WS_URL: "wss://base.example/ws",
  });
  const adapters = createConfiguredLedgerAdapters(config);
  assert.deepEqual(adapters.map((adapter) => adapter.family).sort(), ["EVM", "SOLANA"]);
  assert.ok(adapters.some((adapter) => adapter.networkId === "evm:84532"));
  assert.ok(adapters.some((adapter) => adapter.networkId.startsWith("solana:")));
});

test("enabled relayer rejects missing EVM WebSocket, signer and unsafe limits", () => {
  const base = {
    ...required, ...solanaConfig, MULTICHAIN_RELAY_ENABLED: true,
    BASE_REGISTRY_ADDRESS: "0x1111111111111111111111111111111111111111",
  };
  assert.equal(EnvSchema.safeParse(base).success, false);
  assert.equal(EnvSchema.safeParse({
    ...base, BASE_WS_URL: "wss://base.example/ws", ORACLE_PRIVATE_KEY: `0x${"11".repeat(32)}`,
    RELAY_LEASE_SECONDS: 1,
  }).success, false);
});

test("local demo is restricted to chain 31337 on a loopback or Docker Anvil RPC", () => {
  assert.equal(isLocalDemoConfig({ CHAIN_ID: 31337, RPC_URL: "http://anvil:8545" }), true);
  assert.equal(isLocalDemoConfig({ CHAIN_ID: 31337, RPC_URL: "http://localhost:55443" }), true);
  assert.equal(isLocalDemoConfig({ CHAIN_ID: 84532, RPC_URL: "https://sepolia.base.org" }), false);
  assert.equal(isLocalDemoConfig({ CHAIN_ID: 31337, RPC_URL: "https://rpc.example.com" }), false);
});

test("external networks reject local demo secrets, keys, endpoints and missing Registry", () => {
  const config = EnvSchema.parse({
    CHAIN_ID: 84532,
    RPC_URL: "https://sepolia.base.org",
    JWT_SECRET: "local-demo-jwt-secret-change-before-testnet-2026",
    MASTER_SECRET_KEY: "local-demo-master-key-change-before-testnet-2026",
    INTERNAL_SERVICE_KEY: "local-demo-internal-key-change-before-testnet-2026",
    ADMIN_REGISTRATION_TOKEN: "local-demo-admin-invite-change-before-testnet-2026",
    ORACLE_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    DEFAULT_P2P_ENDPOINT: "http://gateway:3001/api/v1/inbox",
  });
  const errors = environmentSafetyErrors(config);
  assert.equal(errors.length, 7);
  assert.ok(errors.some((error) => error.includes("REGISTRY_CONTRACT_ADDRESS")));
  assert.ok(errors.some((error) => error.includes("ORACLE_PRIVATE_KEY")));
  assert.ok(errors.some((error) => error.includes("HTTPS")));
});

test("empty optional Docker values use defaults without bypassing required secrets", () => {
  const env = {
    JWT_SECRET: "a".repeat(32), MASTER_SECRET_KEY: "b".repeat(32), INTERNAL_SERVICE_KEY: "c".repeat(32),
    ORACLE_AI_JUDGE_URL: "", RPC_URL: "", IS_CLOUD: "false",
  };
  const parsed = parseEnvironment(env);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.ORACLE_AI_JUDGE_URL, undefined);
    assert.equal(parsed.data.RPC_URL, "http://localhost:8545");
    assert.equal(parsed.data.IS_CLOUD, false);
  }
  assert.equal(parseEnvironment({ ...env, JWT_SECRET: "" }).success, false);
});
