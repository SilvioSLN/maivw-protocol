import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { Connection, PublicKey } from "@solana/web3.js";
import { hexToBytes, keccak256, stringToHex } from "viem";

interface Sm080Evidence {
  schemaVersion: number;
  task: string;
  runId: string;
  executedAt: string;
  status: string;
  computeUnits: Record<string, number | null>;
  steps: Array<{
    network: string;
    direction: string;
    operation: string;
    transaction: string;
    blockOrSlot: string;
    gasUsed?: string;
    latencyMs: number;
  }>;
}

const gatewayRoot = resolve(import.meta.dirname, "..");
const protocolRoot = resolve(gatewayRoot, "..");

// Limites operacionais de projeto
const LIMITS = {
  solana: {
    maxComputeUnits: 450_000,
    maxTransactionBytes: 1_232, // IPv6 MTU limit
    originClaimReceiptBytes: 211,
  },
  evm: {
    maxGasTarget: 500_000,
  },
  latency: {
    maxStepLatencyMs: 30_000,
  },
};

async function main(): Promise<void> {
  const sm080LatestPath = resolve(protocolRoot, "evidence/sm-080/example-run.json");
  const sm080Data = JSON.parse(readFileSync(sm080LatestPath, "utf8")) as Sm080Evidence;
  const solanaDeployment = JSON.parse(readFileSync(resolve(protocolRoot, "solana/deployments/devnet.json"), "utf8"));

  assert.equal(sm080Data.status, "PASS", "SM-080 baseline evidence must be PASS");

  // 1. Métricas Solana
  const requiredMetric = (name: string): number => {
    const value = sm080Data.computeUnits[name];
    assert.equal(typeof value, "number", `SM-080 metric ${name} is required`);
    return value;
  };
  const solOriginCU = requiredMetric("solanaOriginRegistration");
  const solOriginBytes = requiredMetric("solanaOriginRegistrationBytes");
  const solBaseMirrorCU = requiredMetric("baseSepoliaToSolana");
  const solArbMirrorCU = requiredMetric("arbitrumSepoliaToSolana");
  const solPolyMirrorCU = requiredMetric("polygonAmoyToSolana");
  const rpcUrl = process.env.SOLANA_RPC_URL;
  assert.ok(rpcUrl, "SOLANA_RPC_URL is required to measure current Devnet rent");
  const connection = new Connection(rpcUrl, "finalized");
  const domain = (sm080Data as Sm080Evidence & { domains: { solanaOrigin: string } }).domains.solanaOrigin;
  const domainHash = Buffer.from(hexToBytes(keccak256(stringToHex(domain))));
  const programId = new PublicKey(solanaDeployment.programId);
  const [domainRecordAddress] = PublicKey.findProgramAddressSync([Buffer.from("domain"), domainHash], programId);
  const domainAccount = await connection.getAccountInfo(domainRecordAddress, "finalized");
  assert.ok(domainAccount, "SM-080 DomainRecord must still exist on Solana Devnet");
  const [domainRentLamports, receiptRentLamports] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(domainAccount.data.length, "finalized"),
    connection.getMinimumBalanceForRentExemption(LIMITS.solana.originClaimReceiptBytes, "finalized"),
  ]);

  const solanaMetrics = {
    originRegistration: {
      computeUnitsUsed: solOriginCU,
      computeUnitsBudget: LIMITS.solana.maxComputeUnits,
      computeUnitsMarginPercent: Number((((LIMITS.solana.maxComputeUnits - solOriginCU) / LIMITS.solana.maxComputeUnits) * 100).toFixed(1)),
      serializedBytes: solOriginBytes,
      maxBytesLimit: LIMITS.solana.maxTransactionBytes,
      bytesMarginPercent: Number((((LIMITS.solana.maxTransactionBytes - solOriginBytes) / LIMITS.solana.maxTransactionBytes) * 100).toFixed(1)),
    },
    mirrorRegistration: {
      averageComputeUnits: Math.round((solBaseMirrorCU + solArbMirrorCU + solPolyMirrorCU) / 3),
      maxComputeUnitsObserved: Math.max(solBaseMirrorCU, solArbMirrorCU, solPolyMirrorCU),
      computeUnitsBudget: LIMITS.solana.maxComputeUnits,
      computeUnitsMarginPercent: Number((((LIMITS.solana.maxComputeUnits - Math.max(solBaseMirrorCU, solArbMirrorCU, solPolyMirrorCU)) / LIMITS.solana.maxComputeUnits) * 100).toFixed(1)),
    },
    rentEconomics: {
      measuredAtCluster: "devnet",
      domainRecordAddress: domainRecordAddress.toBase58(),
      domainRecordBytes: domainAccount.data.length,
      domainRecordBalanceLamports: domainAccount.lamports,
      domainRecordMinimumRentLamports: domainRentLamports,
      originClaimReceiptBytes: LIMITS.solana.originClaimReceiptBytes,
      originClaimReceiptMinimumRentLamports: receiptRentLamports,
      standardFeeSplBaseUnits: Number(solanaDeployment.economics.standardFee),
    },
  };

  // 2. Métricas EVM
  const evmMirrorSteps = sm080Data.steps.filter((s) => s.operation === "registerMirrorV2");
  const evmOriginSteps = sm080Data.steps.filter((s) => s.operation === "registerCompany");

  const evmMirrorGas = evmMirrorSteps.map((s) => ({
    network: s.network,
    gasUsed: Number(s.gasUsed),
    marginPercent: Number((((LIMITS.evm.maxGasTarget - Number(s.gasUsed)) / LIMITS.evm.maxGasTarget) * 100).toFixed(1)),
  }));

  const evmOriginGas = evmOriginSteps.map((s) => ({
    network: s.network,
    gasUsed: Number(s.gasUsed),
    marginPercent: Number((((LIMITS.evm.maxGasTarget - Number(s.gasUsed)) / LIMITS.evm.maxGasTarget) * 100).toFixed(1)),
  }));

  // 3. Métricas de Latência
  const latenciesByNetwork = sm080Data.steps.map((s) => ({
    network: s.network,
    direction: s.direction,
    operation: s.operation,
    latencyMs: s.latencyMs,
    withinBudget: s.latencyMs < LIMITS.latency.maxStepLatencyMs,
  }));

  // Validações de sanidade e margem mínima
  assert.ok(solanaMetrics.originRegistration.computeUnitsMarginPercent > 50, "Solana origin CU margin must be > 50%");
  assert.ok(solanaMetrics.originRegistration.bytesMarginPercent > 10, "Solana byte size margin must be > 10%");
  assert.ok(solanaMetrics.mirrorRegistration.computeUnitsMarginPercent > 50, "Solana mirror CU margin must be > 50%");
  assert.ok(evmMirrorGas.every((m) => m.gasUsed < LIMITS.evm.maxGasTarget), "EVM mirror gas must be within budget");
  assert.ok(evmOriginGas.every((m) => m.gasUsed < LIMITS.evm.maxGasTarget), "EVM origin gas must be within budget");
  assert.ok(latenciesByNetwork.every((l) => l.withinBudget), "All step latencies must be within budget");

  const runId = sm080Data.runId;
  const evidence = {
    schemaVersion: 1,
    task: "SM-082",
    runId,
    baselineEvidence: "evidence/sm-080/example-run.json",
    evaluatedAt: new Date().toISOString(),
    status: "PASS",
    criteria: "Limites e custos possuem margem e orçamento operacional",
    metrics: {
      solana: solanaMetrics,
      evm: {
        mirrorRegistrations: evmMirrorGas,
        originRegistrations: evmOriginGas,
        maxGasBudget: LIMITS.evm.maxGasTarget,
      },
      latency: latenciesByNetwork,
    },
    verdict: {
      cuLimitsWithinBudget: true,
      packetSizeWithinMtu: true,
      gasLimitsWithinBudget: true,
      latenciesWithinBudget: true,
      operationalSafetyMarginApproved: true,
    },
  };

  const evidencePath = resolve(protocolRoot, `evidence/sm-082/${runId}.json`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });

  process.stdout.write(`${JSON.stringify({ evidencePath, status: evidence.status })}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
