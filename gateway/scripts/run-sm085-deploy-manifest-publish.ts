import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

const gatewayRoot = resolve(import.meta.dirname, "..");
const protocolRoot = resolve(gatewayRoot, "..");

async function main(): Promise<void> {
  const solanaPath = resolve(protocolRoot, "solana/deployments/devnet.json");
  const evmPath = resolve(protocolRoot, "contracts/deployments/testnets.json");

  const solanaDeployment = JSON.parse(readFileSync(solanaPath, "utf8"));
  const evmDeployments = JSON.parse(readFileSync(evmPath, "utf8"));

  // Validação Solana
  assert.equal(solanaDeployment.cluster, "devnet");
  assert.match(solanaDeployment.programId, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Valid Solana programId must be configured");
  assert.ok(solanaDeployment.registrationLookupTable, "Address lookup table must be configured");
  assert.ok(solanaDeployment.roles.authority, "Authority must be configured");
  assert.ok(solanaDeployment.roles.guardian, "Guardian must be configured");
  assert.ok(solanaDeployment.roles.oracleKey, "Oracle key must be configured");
  assert.ok(solanaDeployment.asset.mint, "SPL Mint must be configured");

  // Validação EVM (3 redes)
  const chains = ["baseSepolia", "arbitrumSepolia", "polygonAmoy"];
  for (const chain of chains) {
    const deployment = evmDeployments.deployments[chain];
    assert.ok(deployment, `Deployment for ${chain} must exist`);
    assert.match(deployment.proxy, /^0x[0-9a-fA-F]{40}$/, `${chain} proxy must be valid 0x address`);
    assert.match(deployment.implementation, /^0x[0-9a-fA-F]{40}$/, `${chain} implementation must be valid 0x address`);
    assert.match(deployment.owner, /^0x[0-9a-fA-F]{40}$/, `${chain} owner must be valid 0x address`);
    assert.match(deployment.guardian, /^0x[0-9a-fA-F]{40}$/, `${chain} guardian must be valid 0x address`);
    assert.match(deployment.oracleNode, /^0x[0-9a-fA-F]{40}$/, `${chain} oracleNode must be valid 0x address`);
  }

  const evmRolesSeparated = chains.every((chain) => {
    const deployment = evmDeployments.deployments[chain];
    return new Set([
      deployment.owner.toLowerCase(),
      deployment.guardian.toLowerCase(),
      deployment.oracleNode.toLowerCase(),
    ]).size === 3;
  });
  const solanaRolesSeparated = new Set([
    solanaDeployment.roles.authority,
    solanaDeployment.roles.guardian,
    solanaDeployment.roles.oracleKey,
  ]).size === 3;
  const multisigEvidencePublished = false;
  const governanceReady = evmRolesSeparated && solanaRolesSeparated && multisigEvidencePublished;

  // Obter o commit atual
  let currentCommit = "unknown";
  try {
    currentCommit = execSync("git rev-parse HEAD", { cwd: protocolRoot, encoding: "utf8" }).trim();
  } catch {
    // fallback
  }

  const runId = Date.now().toString(36);
  const evidence = {
    schemaVersion: 1,
    task: "SM-085",
    runId,
    executedAt: new Date().toISOString(),
    commitHash: currentCommit,
    status: governanceReady ? "PASS" : "TESTNET_DEPLOYED_MULTISIG_PENDING",
    criteria: "Program id, contracts, authorities, commits e configurações publicados; governança entregue a multisig",
    acceptanceCriteriaMet: governanceReady,
    governanceReadiness: {
      evmRolesSeparated,
      solanaRolesSeparated,
      multisigEvidencePublished,
      note: governanceReady
        ? "Governança segregada e evidência multisig publicadas."
        : "Deploys de testnet publicados; handoff para multisig e separação final de papéis ainda pendentes.",
    },
    dependencies: ["SM-080", "SM-083"],
    publishedDeployments: {
      solanaDevnet: {
        networkId: solanaDeployment.networkId,
        programId: solanaDeployment.programId,
        programDataAddress: solanaDeployment.programDataAddress,
        upgradeAuthority: solanaDeployment.upgradeAuthority,
        registryConfigPda: solanaDeployment.registryConfig,
        registrationLookupTable: solanaDeployment.registrationLookupTable,
        splMint: solanaDeployment.asset.mint,
        governance: solanaDeployment.roles,
        economics: solanaDeployment.economics,
      },
      evmTestnets: {
        baseSepolia: {
          chainId: evmDeployments.deployments.baseSepolia.chainId,
          proxy: evmDeployments.deployments.baseSepolia.proxy,
          implementation: evmDeployments.deployments.baseSepolia.implementation,
          canonicalRegistry: evmDeployments.deployments.baseSepolia.legacyRegistry,
          governance: {
            owner: evmDeployments.deployments.baseSepolia.owner,
            guardian: evmDeployments.deployments.baseSepolia.guardian,
            oracleNode: evmDeployments.deployments.baseSepolia.oracleNode,
          },
        },
        arbitrumSepolia: {
          chainId: evmDeployments.deployments.arbitrumSepolia.chainId,
          proxy: evmDeployments.deployments.arbitrumSepolia.proxy,
          implementation: evmDeployments.deployments.arbitrumSepolia.implementation,
          canonicalRegistry: evmDeployments.deployments.arbitrumSepolia.legacyRegistry,
          governance: {
            owner: evmDeployments.deployments.arbitrumSepolia.owner,
            guardian: evmDeployments.deployments.arbitrumSepolia.guardian,
            oracleNode: evmDeployments.deployments.arbitrumSepolia.oracleNode,
          },
        },
        polygonAmoy: {
          chainId: evmDeployments.deployments.polygonAmoy.chainId,
          proxy: evmDeployments.deployments.polygonAmoy.proxy,
          implementation: evmDeployments.deployments.polygonAmoy.implementation,
          canonicalRegistry: evmDeployments.deployments.polygonAmoy.legacyRegistry,
          governance: {
            owner: evmDeployments.deployments.polygonAmoy.owner,
            guardian: evmDeployments.deployments.polygonAmoy.guardian,
            oracleNode: evmDeployments.deployments.polygonAmoy.oracleNode,
          },
        },
      },
    },
  };

  const evidencePath = resolve(protocolRoot, `evidence/sm-085/${runId}.json`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });

  process.stdout.write(`${JSON.stringify({
    evidencePath,
    status: evidence.status,
    networks: 4,
    governanceReady,
  })}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
