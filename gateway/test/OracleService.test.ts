import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OracleService } from "../src/services/OracleService.js";
import { type EnvConfig } from "../src/config.js";
import { type Address, recoverAddress, hashTypedData } from "viem";

describe("OracleService Integration & Factory", () => {
  const TEST_ORACLE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const EXPECTED_ORACLE_ADDR: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  const mockLedgerService = {
    getContractAddress: () => "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address,
    getPublicClient: () => ({
      getBalance: async () => 1000000000000000000n, // 1 ETH
      readContract: async () => 0n,
    }),
    deactivateDemoDomain: () => {},
  } as any;

  const baseConfig: EnvConfig = {
    GATEWAY_PORT: 3001,
    GATEWAY_HOST: "0.0.0.0",
    RPC_URL: "http://localhost:8545",
    CHAIN_ID: 31337,
    REDIS_URL: "redis://localhost:6379",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
    REGISTRY_CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    DEPLOYER_PRIVATE_KEY: TEST_ORACLE_KEY,
    ORACLE_PRIVATE_KEY: TEST_ORACLE_KEY,
    COMPANY_A_PRIVATE_KEY: TEST_ORACLE_KEY,
    COMPANY_B_PRIVATE_KEY: TEST_ORACLE_KEY,
    PROVIDER_PRIVATE_KEY: TEST_ORACLE_KEY,
    SENDER_DOMAIN: "empresaA.com",
    MASTER_SECRET_KEY: "secret",
    LEGACY_WEBHOOK_SECRET: "secret",
    JWT_SECRET: "secret",
    BASE_RPC_URL: "https://sepolia.base.org",
    ARBITRUM_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc",
    POLYGON_RPC_URL: "https://rpc-amoy.polygon.technology",
    INTERNAL_SERVICE_KEY: "secret",
    ORACLE_SIGNER_TYPE: "local",
    ORACLE_MIN_BALANCE_WEI: 10000000000000000n,
  };

  it("deve inicializar com signer local por padrão no ambiente dev", async () => {
    const oracle = await OracleService.create(baseConfig, mockLedgerService);

    assert.equal(oracle.getSignerType(), "local");
    assert.equal(oracle.getOracleAddress().toLowerCase(), EXPECTED_ORACLE_ADDR.toLowerCase());

    const balance = await oracle.getBalance();
    assert.equal(balance, 1000000000000000000n);
  });

  it("deve aplicar Fail-Fast e abortar se ORACLE_SIGNER_TYPE='gcp-kms' for configurado sem GCP_KMS_KEY_VERSION", async () => {
    const invalidConfig = {
      ...baseConfig,
      ORACLE_SIGNER_TYPE: "gcp-kms" as const,
      GCP_KMS_KEY_VERSION: undefined,
    };

    await assert.rejects(
      async () => await OracleService.create(invalidConfig, mockLedgerService),
      /GCP_KMS_KEY_VERSION/
    );
  });

  it("deve gerar assinaturas EIP-712 válidas de registro (Registration Proof)", async () => {
    const oracle = await OracleService.create(baseConfig, mockLedgerService);

    const domain = "empresa-teste.com";
    const userPublicKey = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
    const callerAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

    const signature = await oracle.generateRegistrationProof(
      domain,
      userPublicKey,
      callerAddress
    );

    assert.ok(signature.startsWith("0x"));
    assert.equal(signature.length, 132); // 65 bytes
  });

  it("deve gerar assinaturas EIP-712 válidas de reciclagem (Reclaim Proof)", async () => {
    const oracle = await OracleService.create(baseConfig, mockLedgerService);

    const domain = "empresa-reciclada.com";
    const newPublicKey = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
    const buyerAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

    const signature = await oracle.generateReclaimProof(
      domain,
      newPublicKey,
      buyerAddress
    );

    assert.ok(signature.startsWith("0x"));
    assert.equal(signature.length, 132);
  });

  it("deve julgar violação semântica com precisão (Judge IA)", () => {
    const oracle = new OracleService(baseConfig, mockLedgerService);

    // TX_CODE com promoção deve ser bloqueado
    const r1 = oracle.judgeSemanticViolation("TX_CODE", "Seu código de acesso é 123456. Aproveite 50% off hoje!");
    assert.equal(r1.isSpoofed, true);

    // TX_CODE legítimo
    const r2 = oracle.judgeSemanticViolation("TX_CODE", "Seu código de verificação é 849201. Válido por 5 minutos.");
    assert.equal(r2.isSpoofed, false);
  });
});
