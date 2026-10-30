import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import assert from "node:assert/strict";
import { keccak256, padHex, stringToHex, type Hex } from "viem";
import type { CanonicalDomainState } from "../src/multichain/FinalizedStateReader.js";
import {
  MultichainReconciliationService,
  type ReconciliationFindingRow,
  type ReconciliationRepository,
  type ReconciliationRunRow,
} from "../src/multichain/MultichainReconciliation.js";

const gatewayRoot = resolve(import.meta.dirname, "..");
const protocolRoot = resolve(gatewayRoot, "..");

class MemoryReconciliationRepository implements ReconciliationRepository {
  readonly runs: ReconciliationRunRow[] = [];
  readonly findings: ReconciliationFindingRow[] = [];
  async transaction<T>(operation: (repository: ReconciliationRepository) => Promise<T>) { return operation(this); }
  async findRunByRequestId(requestId: string) { return this.runs.find((run) => run.requestId === requestId) ?? null; }
  async listFindings(runId: string) { return this.findings.filter((finding) => finding.runId === runId); }
  async lastRun(domainHash: string) {
    return [...this.runs].reverse().find((run) => run.domainHash === domainHash) ?? null;
  }
  async createRun(run: ReconciliationRunRow, findings: readonly ReconciliationFindingRow[]) {
    this.runs.push(run);
    this.findings.push(...findings);
  }
}

async function main(): Promise<void> {
  const dir = resolve(protocolRoot, "evidence/sm-080");
  const candidates = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ path: resolve(dir, name), data: JSON.parse(readFileSync(resolve(dir, name), "utf8")) }))
    .sort((a, b) => String(b.data.executedAt ?? "").localeCompare(String(a.data.executedAt ?? "")));
  assert.ok(candidates[0], "Local SM-080 evidence file is required in evidence/sm-080/");
  const sm080Path = candidates[0].path;
  const sm080 = candidates[0].data;
  assert.equal(sm080.status, "PASS");

  const repo = new MemoryReconciliationRepository();
  const service = new MultichainReconciliationService(repo);

  const canaryDomains = [
    {
      domain: sm080.domains.solanaOrigin,
      originFamily: "SOLANA" as const,
      originNetworkId: "solana:devnet",
      destinations: ["baseSepolia", "arbitrumSepolia", "polygonAmoy"],
    },
    {
      domain: `sm080-basesepolia-${sm080.runId}.maivw.test`,
      originFamily: "EVM" as const,
      originNetworkId: "evm:84532",
      destinations: ["solanaDevnet"],
    },
    {
      domain: `sm080-arbitrumsepolia-${sm080.runId}.maivw.test`,
      originFamily: "EVM" as const,
      originNetworkId: "evm:421614",
      destinations: ["solanaDevnet"],
    },
    {
      domain: `sm080-polygonamoy-${sm080.runId}.maivw.test`,
      originFamily: "EVM" as const,
      originNetworkId: "evm:80002",
      destinations: ["solanaDevnet"],
    },
  ];

  const results: any[] = [];

  for (const canary of canaryDomains) {
    const domainHash = keccak256(stringToHex(canary.domain));
    const originState: CanonicalDomainState = {
      domain: canary.domain,
      domainHash,
      recordKind: "ORIGIN",
      originFamily: canary.originFamily,
      originNetworkHash: keccak256(stringToHex(canary.originNetworkId)),
      originRegistry: padHex("0x01", { size: 32 }),
      operationalKey: { algorithm: canary.originFamily === "SOLANA" ? 2 : 1, value: padHex("0xaa", { size: 32 }) },
      adminKey: { algorithm: canary.originFamily === "SOLANA" ? 2 : 1, value: padHex("0xbb", { size: 32 }) },
      endpoint: `https://${canary.domain}/inbox`,
      tlsFingerprint: padHex("0x00", { size: 32 }),
      status: "ACTIVE",
      globalDomainEpoch: 0n,
      originSequence: 0n,
      isProvider: false,
      providerTier: 0,
      strikes: 0,
      registrationTime: 1_700_000_000n,
      updatedAt: 1_700_000_000n,
      attestedStake: 0n,
      attestedDailyLimit: 0n,
      originTransactionFamily: canary.originFamily,
      originTransaction: padHex("0xcc", { size: 32 }),
      schemaVersion: 2,
    };

    const targetDestinations = canary.destinations.map((destName, i) => {
      const family = destName === "solanaDevnet" ? "SOLANA" as const : "EVM" as const;
      const networkId = destName === "solanaDevnet" ? "solana:devnet" : `evm:${destName}`;
      const registryId = padHex(`0x${(i + 1).toString(16)}`, { size: 32 });
      return {
        family,
        networkId,
        registryId,
        state: {
          ...structuredClone(originState),
          recordKind: "MIRROR" as const,
        },
      };
    });

    const runResult = await service.reconcile({
      requestId: `canary-reconcile-${canary.domain}`,
      origin: {
        family: canary.originFamily,
        networkId: canary.originNetworkId,
        registryId: originState.originRegistry,
      },
      originState,
      targets: targetDestinations,
      startedAt: new Date(),
    });

    assert.equal(runResult.run.status, "CLEAN", `Canary domain ${canary.domain} must be CLEAN`);
    assert.ok(runResult.findings.every((f) => f.kind === "IN_SYNC"), `All findings for ${canary.domain} must be IN_SYNC`);

    results.push({
      domain: canary.domain,
      originFamily: canary.originFamily,
      originNetwork: canary.originNetworkId,
      destinations: canary.destinations,
      status: runResult.run.status,
      findingsCount: runResult.findings.length,
      allInSync: runResult.findings.every((f) => f.kind === "IN_SYNC"),
    });
  }

  const runId = Date.now().toString(36);
  const evidence = {
    schemaVersion: 1,
    task: "SM-086",
    runId,
    baselineEvidence: relative(protocolRoot, sm080Path),
    evaluatedAt: new Date().toISOString(),
    status: "SIMULATION_PASS_LIVE_CANARY_PENDING",
    criteria: "Reconciliação do conjunto canário validada contra leituras on-chain atuais",
    acceptanceCriteriaMet: false,
    liveCanary: {
      status: "PENDING",
      onChainReads: 0,
      note: "O runner atual exercita a reconciliação com estados sintéticos derivados da evidência SM-080; não é um monitor contínuo on-chain.",
    },
    dependencies: ["SM-084", "SM-085"],
    canarySummary: {
      totalDomainsTested: canaryDomains.length,
      solanaOriginCount: 1,
      evmOriginCount: 3,
      totalDrifts: 0,
      overallStatus: "SIMULATED_ZERO_DRIFT",
    },
    results,
  };

  const evidencePath = resolve(protocolRoot, `evidence/sm-086/${runId}.json`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });

  process.stdout.write(`${JSON.stringify({ evidencePath, status: evidence.status, canaryDomains: canaryDomains.length })}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
