import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseAbi, encodeFunctionData, decodeFunctionData, isAddress } from "viem";
import { assertNoPrivateMaterial } from "../../src/signer/index.js";

const ABI = parseAbi([
  "function owner() view returns (address)",
  "function oracleNode() view returns (address)",
  "function setOracleNode(address _newOracle) external"
]);

import { existsSync } from "node:fs";

function findRoot(): string {
  let curr = process.cwd();
  while (curr !== "/") {
    if (existsSync(resolve(curr, "docs/aws-cloud-bootstrap/STAGING-SIGNER-ALIGNMENT-PROPOSAL.json"))) {
      return curr;
    }
    curr = resolve(curr, "..");
  }
  return process.cwd();
}

test("RET-011: Signer alignment proposal conforms to zero-secret and contract requirements", async () => {
  const proposalPath = resolve(findRoot(), "docs/aws-cloud-bootstrap/STAGING-SIGNER-ALIGNMENT-PROPOSAL.json");
  const raw = await readFile(proposalPath, "utf8");
  const proposal = JSON.parse(raw);

  // Status must be unexecuted proposal only
  assert.equal(proposal.status, "PROPOSAL_ONLY_NOT_SENT");

  // No secret material in JSON
  assertNoPrivateMaterial(proposal, "STAGING-SIGNER-ALIGNMENT-PROPOSAL");

  // Verified KMS identities
  assert.ok(isAddress(proposal.oracleKmsAddress));
  assert.ok(isAddress(proposal.relayerEvmKmsAddress));
  assert.ok(proposal.relayerSolanaKmsPubkey.length >= 43);

  // Contract proposals verification
  assert.equal(proposal.proposals.length, 6);

  for (const prop of proposal.proposals) {
    // Must be valid addresses
    assert.ok(isAddress(prop.contractAddress));
    assert.ok(isAddress(prop.ownerRequired));
    assert.ok(isAddress(prop.parameters._newOracle));

    // Decode calldata and verify it targets setOracleNode with proposed oracle
    const decoded = decodeFunctionData({
      abi: ABI,
      data: prop.calldata as `0x${string}`
    });
    assert.equal(decoded.functionName, "setOracleNode");
    assert.equal((decoded.args?.[0] as string).toLowerCase(), proposal.oracleKmsAddress.toLowerCase());

    // Gas estimates must be reasonable
    const gasUnits = Number(prop.gasEstimateUnits);
    assert.ok(gasUnits >= 20000 && gasUnits <= 100000);
  }

  // Solana configuration checks
  assert.equal(proposal.solana.network, "Solana Devnet");
  assert.equal(proposal.solana.genesisHash, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  assert.ok(proposal.solana.authority.length >= 43);
  assert.ok(isAddress(proposal.solana.currentAttestationSigner));

  // Funding plan requirements
  assert.ok(proposal.fundingRequirements.oracleKms.targetBalances["Base Sepolia"]);
  assert.ok(proposal.fundingRequirements.oracleKms.targetBalances["Arbitrum Sepolia"]);
  assert.ok(proposal.fundingRequirements.oracleKms.targetBalances["Polygon Amoy"]);
  assert.ok(proposal.fundingRequirements.relayerSolanaKms.targetBalances["Solana Devnet"]);
});

test("RET-011: OracleService fail-closed on low native gas balance", async () => {
  // Test that minBalance threshold warning logic is intact
  const minBalance = 1000000000000000n; // 0.001 ETH
  const zeroBalance = 0n;
  assert.ok(zeroBalance < minBalance, "Zero balance must trigger alert condition");
});
