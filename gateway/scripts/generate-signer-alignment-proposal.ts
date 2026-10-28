/**
 * protocol/gateway/scripts/generate-signer-alignment-proposal.ts
 * 
 * RET-011: Auditoria on-chain, geração de proposta de autorização e relatório de fundos.
 * Não envia transações on-chain. Não exporta chaves do KMS.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbi, encodeFunctionData, formatEther } from "viem";
import { baseSepolia, arbitrumSepolia, polygonAmoy } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";

import { existsSync } from "node:fs";

function findProjectRoot(): string {
  let curr = process.cwd();
  while (curr !== "/") {
    if (existsSync(resolve(curr, "protocol/.env.testnet"))) {
      return curr;
    }
    curr = resolve(curr, "..");
  }
  return process.cwd();
}

const root = findProjectRoot();

const ABI = parseAbi([
  "function owner() view returns (address)",
  "function oracleNode() view returns (address)",
  "function paused() view returns (bool)",
  "function setOracleNode(address _newOracle) external"
]);

const KMS_ORACLE = "0x0000000000000000000000000000000000000001";
const KMS_EVM_RELAYER = "0x0000000000000000000000000000000000000002";
const KMS_SOLANA_RELAYER = "11111111111111111111111111111111";

async function loadEnvTestnet(): Promise<Record<string, string>> {
  const envPath = resolve(root, "protocol/.env.testnet");
  const env: Record<string, string> = {};
  try {
    const raw = await readFile(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        env[key] = val;
      }
    }
  } catch {
    // fallback to process.env
  }
  return { ...env, ...(process.env as Record<string, string>) };
}

export async function generateSignerAlignmentReport() {
  const env = await loadEnvTestnet();

  const NETWORKS = [
    {
      name: "Base Sepolia",
      chain: baseSepolia,
      rpc: env.BASE_RPC_URL || env.RPC_URL || "https://sepolia.base.org",
      registry: (env.BASE_REGISTRY_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
      mirror: (env.BASE_MIRROR_REGISTRY_V2_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
      nativeSymbol: "ETH"
    },
    {
      name: "Arbitrum Sepolia",
      chain: arbitrumSepolia,
      rpc: env.ARBITRUM_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      registry: (env.ARBITRUM_REGISTRY_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
      mirror: (env.ARBITRUM_MIRROR_REGISTRY_V2_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
      nativeSymbol: "ETH"
    },
    {
      name: "Polygon Amoy",
      chain: polygonAmoy,
      rpc: env.POLYGON_RPC_URL || "https://rpc-amoy.polygon.technology",
      registry: (env.POLYGON_REGISTRY_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
      mirror: (env.POLYGON_MIRROR_REGISTRY_V2_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
      nativeSymbol: "POL"
    }
  ];

  const calldata = encodeFunctionData({
    abi: ABI,
    functionName: "setOracleNode",
    args: [KMS_ORACLE as `0x${string}`]
  });

  const proposals = [];

  for (const net of NETWORKS) {
    const client = createPublicClient({ chain: net.chain, transport: http(net.rpc) });
    const gasPrice = await client.getGasPrice();

    for (const [targetName, address] of [["Registry", net.registry], ["MirrorRegistryV2", net.mirror]] as const) {
      const owner = await client.readContract({ address, abi: ABI, functionName: "owner" });
      const currentOracle = await client.readContract({ address, abi: ABI, functionName: "oracleNode" });
      let paused = false;
      try { paused = await client.readContract({ address, abi: ABI, functionName: "paused" }); } catch {}

      const gasEstimate = await client.estimateGas({
        account: owner,
        to: address,
        data: calldata
      });
      const gasCostWei = gasEstimate * gasPrice;
      const gasCostNative = formatEther(gasCostWei);

      const ownerBalance = await client.getBalance({ address: owner });
      const oracleBalance = await client.getBalance({ address: KMS_ORACLE as `0x${string}` });
      const relayerBalance = await client.getBalance({ address: KMS_EVM_RELAYER as `0x${string}` });

      proposals.push({
        network: net.name,
        chainId: net.chain.id,
        contractName: targetName,
        contractAddress: address,
        function: "setOracleNode(address)",
        calldata,
        parameters: { _newOracle: KMS_ORACLE },
        ownerRequired: owner,
        ownerBalance: `${formatEther(ownerBalance)} ${net.nativeSymbol}`,
        currentOracleOnChain: currentOracle,
        proposedOracle: KMS_ORACLE,
        oracleBalanceKMS: `${formatEther(oracleBalance)} ${net.nativeSymbol}`,
        relayerBalanceKMS: `${formatEther(relayerBalance)} ${net.nativeSymbol}`,
        contractPaused: paused,
        gasEstimateUnits: gasEstimate.toString(),
        gasPriceWei: gasPrice.toString(),
        estimatedTxCost: `${gasCostNative} ${net.nativeSymbol}`,
        actionImpact: targetName === "Registry"
          ? `Transfere autorização de execução de slashing, strikes e advertências na ${net.name} para o AWS KMS Staging Oracle.`
          : `Autoriza o AWS KMS Staging Oracle a assinar atestações de estado mirror cross-chain verificadas na ${net.name}.`
      });
    }
  }

  // Solana
  const solConnection = new Connection(env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const solRelayerPubkey = new PublicKey(KMS_SOLANA_RELAYER);
  const solRelayerBalance = await solConnection.getBalance(solRelayerPubkey);
  const solAuthorityPubkey = new PublicKey("11111111111111111111111111111111111111111111");
  const solAuthorityBalance = await solConnection.getBalance(solAuthorityPubkey);

  const solanaReport = {
    network: "Solana Devnet",
    genesisHash: await solConnection.getGenesisHash(),
    programId: "79zeqyK3mX58J89r2P99Q9w8J4j6Z2Qj5zS8m4N3Hj4E",
    registryConfigPda: "11111111111111111111111111111111111111111111",
    authority: solAuthorityPubkey.toBase58(),
    authorityBalance: `${(solAuthorityBalance / 1e9).toString()} SOL`,
    currentAttestationSigner: "0x0000000000000000000000000000000000000000",
    relayerKmsPubkey: KMS_SOLANA_RELAYER,
    relayerKmsBalance: `${(solRelayerBalance / 1e9).toString()} SOL`,
    analysis: "Solana Registry Config v2 não expõe instrução para rotacionar attestation_signer (imutável no PDA de configuração). O attestation_signer atual é 0x0000000000000000000000000000000000000000 (correspondente à chave local/deployer). O relayWorker Solana utiliza o signer KMS Ed25519 como fee payer / submitter após financiamento com devnet SOL."
  };

  return {
    status: "PROPOSAL_ONLY_NOT_SENT",
    generatedAt: new Date().toISOString(),
    oracleKmsAddress: KMS_ORACLE,
    relayerEvmKmsAddress: KMS_EVM_RELAYER,
    relayerSolanaKmsPubkey: KMS_SOLANA_RELAYER,
    contractOwnerRequired: proposals[0].ownerRequired,
    proposals,
    solana: solanaReport,
    fundingRequirements: {
      oracleKms: {
        address: KMS_ORACLE,
        targetBalances: {
          "Base Sepolia": "0.005 ETH",
          "Arbitrum Sepolia": "0.005 ETH",
          "Polygon Amoy": "1.0 POL"
        }
      },
      relayerEvmKms: {
        address: KMS_EVM_RELAYER,
        targetBalances: {
          "Base Sepolia": "0.005 ETH",
          "Arbitrum Sepolia": "0.005 ETH",
          "Polygon Amoy": "1.0 POL"
        }
      },
      relayerSolanaKms: {
        pubkey: KMS_SOLANA_RELAYER,
        targetBalances: {
          "Solana Devnet": "0.5 SOL"
        }
      }
    }
  };
}

async function main() {
  const report = await generateSignerAlignmentReport();
  const outPath = resolve(root, "docs/aws-cloud-bootstrap/STAGING-SIGNER-ALIGNMENT-PROPOSAL.json");
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(`[RET-011] Proposal generated and saved to ${outPath}`);
  console.log(`[RET-011] Status: ${report.status}`);
  console.log(`[RET-011] Total EVM proposals: ${report.proposals.length}`);
  console.log(`[RET-011] Solana Program: ${report.solana.programId}`);
}

main().catch(console.error);
