/**
 * protocol/gateway/scripts/generate-signer-alignment-proposal.ts
 *
 * Auditoria on-chain, geração de proposta de autorização de signers KMS e relatório de saldos.
 * Não envia transações on-chain. Não exporta chaves do KMS.
 * Todos os endereços de contratos e signers devem ser fornecidos pelo ambiente local do operador
 * (.env.testnet / variáveis de ambiente / manifestos locais não versionados em deployments/).
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbi, encodeFunctionData, formatEther, isAddress } from "viem";
import { baseSepolia, arbitrumSepolia, polygonAmoy } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";

function findProjectRoot(): string {
  let curr = process.cwd();
  while (curr !== "/") {
    if (existsSync(resolve(curr, "protocol/.env.testnet")) || existsSync(resolve(curr, ".env.testnet"))) {
      return curr;
    }
    curr = resolve(curr, "..");
  }
  return process.cwd();
}

const root = findProjectRoot();
const protocolRoot = existsSync(resolve(root, "protocol")) ? resolve(root, "protocol") : root;

const ABI = parseAbi([
  "function owner() view returns (address)",
  "function oracleNode() view returns (address)",
  "function paused() view returns (bool)",
  "function setOracleNode(address _newOracle) external",
]);

async function loadEnvTestnet(): Promise<Record<string, string>> {
  const envPath = resolve(protocolRoot, ".env.testnet");
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

async function loadOptionalJson(filePath: string): Promise<any> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function requireEvmAddress(value: string | undefined, label: string): `0x${string}` {
  const trimmed = value?.trim() || "";
  if (!isAddress(trimmed)) {
    throw new Error(`${label} deve ser configurado no ambiente local (.env.testnet ou deployments/testnets.json)`);
  }
  return trimmed as `0x${string}`;
}

function requireSolanaPubkey(value: string | undefined, label: string): PublicKey {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    throw new Error(`${label} deve ser configurado no ambiente local (.env.testnet ou deployments/devnet.json)`);
  }
  return new PublicKey(trimmed);
}

export async function generateSignerAlignmentReport() {
  const env = await loadEnvTestnet();
  const evmManifest = await loadOptionalJson(resolve(protocolRoot, "contracts/deployments/testnets.json"));
  const solanaManifest = await loadOptionalJson(resolve(protocolRoot, "solana/deployments/devnet.json"));

  const kmsOracle = requireEvmAddress(env.KMS_ORACLE_ADDRESS, "KMS_ORACLE_ADDRESS");
  const kmsEvmRelayer = requireEvmAddress(env.KMS_EVM_RELAYER_ADDRESS, "KMS_EVM_RELAYER_ADDRESS");
  const kmsSolanaRelayer = requireSolanaPubkey(
    env.KMS_SOLANA_RELAYER_PUBKEY || env.SOLANA_RELAYER_PUBLIC_KEY,
    "KMS_SOLANA_RELAYER_PUBKEY / SOLANA_RELAYER_PUBLIC_KEY",
  );

  const NETWORKS = [
    {
      name: "Base Sepolia",
      chain: baseSepolia,
      rpc: env.BASE_RPC_URL || env.RPC_URL || "https://sepolia.base.org",
      registry: requireEvmAddress(
        env.BASE_REGISTRY_ADDRESS || env.REGISTRY_CONTRACT_ADDRESS || evmManifest?.deployments?.baseSepolia?.legacyRegistry,
        "BASE_REGISTRY_ADDRESS",
      ),
      mirror: requireEvmAddress(
        env.BASE_MIRROR_REGISTRY_V2_ADDRESS || env.MIRROR_REGISTRY_V2_ADDRESS || evmManifest?.deployments?.baseSepolia?.proxy,
        "BASE_MIRROR_REGISTRY_V2_ADDRESS",
      ),
      nativeSymbol: "ETH",
    },
    {
      name: "Arbitrum Sepolia",
      chain: arbitrumSepolia,
      rpc: env.ARBITRUM_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      registry: requireEvmAddress(
        env.ARBITRUM_REGISTRY_ADDRESS || evmManifest?.deployments?.arbitrumSepolia?.legacyRegistry,
        "ARBITRUM_REGISTRY_ADDRESS",
      ),
      mirror: requireEvmAddress(
        env.ARBITRUM_MIRROR_REGISTRY_V2_ADDRESS || evmManifest?.deployments?.arbitrumSepolia?.proxy,
        "ARBITRUM_MIRROR_REGISTRY_V2_ADDRESS",
      ),
      nativeSymbol: "ETH",
    },
    {
      name: "Polygon Amoy",
      chain: polygonAmoy,
      rpc: env.POLYGON_RPC_URL || "https://rpc-amoy.polygon.technology",
      registry: requireEvmAddress(
        env.POLYGON_REGISTRY_ADDRESS || evmManifest?.deployments?.polygonAmoy?.legacyRegistry,
        "POLYGON_REGISTRY_ADDRESS",
      ),
      mirror: requireEvmAddress(
        env.POLYGON_MIRROR_REGISTRY_V2_ADDRESS || evmManifest?.deployments?.polygonAmoy?.proxy,
        "POLYGON_MIRROR_REGISTRY_V2_ADDRESS",
      ),
      nativeSymbol: "POL",
    },
  ];

  const calldata = encodeFunctionData({
    abi: ABI,
    functionName: "setOracleNode",
    args: [kmsOracle],
  });

  const proposals = [];

  for (const net of NETWORKS) {
    const client = createPublicClient({ chain: net.chain, transport: http(net.rpc) });
    const gasPrice = await client.getGasPrice();

    for (const [targetName, address] of [["Registry", net.registry], ["MirrorRegistryV2", net.mirror]] as const) {
      const owner = await client.readContract({ address, abi: ABI, functionName: "owner" });
      const currentOracle = await client.readContract({ address, abi: ABI, functionName: "oracleNode" });
      let paused = false;
      try {
        paused = await client.readContract({ address, abi: ABI, functionName: "paused" });
      } catch {}

      const gasEstimate = await client.estimateGas({
        account: owner,
        to: address,
        data: calldata,
      });
      const gasCostWei = gasEstimate * gasPrice;
      const gasCostNative = formatEther(gasCostWei);

      const ownerBalance = await client.getBalance({ address: owner });
      const oracleBalance = await client.getBalance({ address: kmsOracle });
      const relayerBalance = await client.getBalance({ address: kmsEvmRelayer });

      proposals.push({
        network: net.name,
        chainId: net.chain.id,
        contractName: targetName,
        contractAddress: address,
        function: "setOracleNode(address)",
        calldata,
        parameters: { _newOracle: kmsOracle },
        ownerRequired: owner,
        ownerBalance: `${formatEther(ownerBalance)} ${net.nativeSymbol}`,
        currentOracleOnChain: currentOracle,
        proposedOracle: kmsOracle,
        oracleBalanceKMS: `${formatEther(oracleBalance)} ${net.nativeSymbol}`,
        relayerBalanceKMS: `${formatEther(relayerBalance)} ${net.nativeSymbol}`,
        contractPaused: paused,
        gasEstimateUnits: gasEstimate.toString(),
        gasPriceWei: gasPrice.toString(),
        estimatedTxCost: `${gasCostNative} ${net.nativeSymbol}`,
        actionImpact: targetName === "Registry"
          ? `Transfere autorização de execução de slashing, strikes e advertências na ${net.name} para o signer KMS configurado.`
          : `Autoriza o signer KMS configurado a assinar atestações de estado mirror cross-chain verificadas na ${net.name}.`,
      });
    }
  }

  const solConnection = new Connection(env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const solProgramId = requireSolanaPubkey(env.SOLANA_PROGRAM_ID || solanaManifest?.programId, "SOLANA_PROGRAM_ID");
  const solAuthorityPubkey = requireSolanaPubkey(
    env.SOLANA_AUTHORITY_PUBLIC_KEY || solanaManifest?.roles?.authority,
    "SOLANA_AUTHORITY_PUBLIC_KEY",
  );
  const currentAttestationSigner = requireEvmAddress(
    env.SOLANA_ATTESTATION_SIGNER_ADDRESS || solanaManifest?.roles?.attestationSigner,
    "SOLANA_ATTESTATION_SIGNER_ADDRESS",
  );
  const [registryConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("registry-config")], solProgramId);
  const solRelayerBalance = await solConnection.getBalance(kmsSolanaRelayer);
  const solAuthorityBalance = await solConnection.getBalance(solAuthorityPubkey);

  const solanaReport = {
    network: "Solana Devnet",
    genesisHash: await solConnection.getGenesisHash(),
    programId: solProgramId.toBase58(),
    registryConfigPda: solanaManifest?.registryConfig || registryConfigPda.toBase58(),
    authority: solAuthorityPubkey.toBase58(),
    authorityBalance: `${(solAuthorityBalance / 1e9).toString()} SOL`,
    currentAttestationSigner,
    relayerKmsPubkey: kmsSolanaRelayer.toBase58(),
    relayerKmsBalance: `${(solRelayerBalance / 1e9).toString()} SOL`,
    analysis:
      "Solana Registry Config v2 mantém attestation_signer imutável no PDA de configuração. O relayWorker Solana utiliza o signer KMS Ed25519 como fee payer / submitter após financiamento na rede configurada.",
  };

  return {
    status: "PROPOSAL_ONLY_NOT_SENT",
    generatedAt: new Date().toISOString(),
    oracleKmsAddress: kmsOracle,
    relayerEvmKmsAddress: kmsEvmRelayer,
    relayerSolanaKmsPubkey: kmsSolanaRelayer.toBase58(),
    contractOwnerRequired: proposals[0].ownerRequired,
    proposals,
    solana: solanaReport,
    fundingRequirements: {
      oracleKms: {
        address: kmsOracle,
        targetBalances: {
          "Base Sepolia": "0.005 ETH",
          "Arbitrum Sepolia": "0.005 ETH",
          "Polygon Amoy": "1.0 POL",
        },
      },
      relayerEvmKms: {
        address: kmsEvmRelayer,
        targetBalances: {
          "Base Sepolia": "0.005 ETH",
          "Arbitrum Sepolia": "0.005 ETH",
          "Polygon Amoy": "1.0 POL",
        },
      },
      relayerSolanaKms: {
        pubkey: kmsSolanaRelayer.toBase58(),
        targetBalances: {
          "Solana Devnet": "0.5 SOL",
        },
      },
    },
  };
}

async function main() {
  const report = await generateSignerAlignmentReport();
  const outPath = resolve(
    process.env.SIGNER_ALIGNMENT_OUTPUT_PATH ||
      resolve(root, "docs/aws-cloud-bootstrap/STAGING-SIGNER-ALIGNMENT-PROPOSAL.json"),
  );
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(`[RET-011] Proposal generated and saved to ${outPath}`);
  console.log(`[RET-011] Status: ${report.status}`);
  console.log(`[RET-011] Total EVM proposals: ${report.proposals.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
