import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  toFunctionSelector,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { arbitrumSepolia, baseSepolia, polygonAmoy } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

type Artifact = { abi: Abi; bytecode: { object: Hex } };

const gatewayRoot = resolve(import.meta.dirname, "..");
const protocolRoot = resolve(gatewayRoot, "..");
const implementationArtifact = JSON.parse(readFileSync(resolve(
  protocolRoot, "contracts/out/MAIVWMirrorRegistryV2.sol/MAIVWMirrorRegistryV2.json",
), "utf8")) as Artifact;
const proxyArtifact = JSON.parse(readFileSync(resolve(
  protocolRoot, "contracts/out/ERC1967Proxy.sol/ERC1967Proxy.json",
), "utf8")) as Artifact;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const privateKey = (required("DEPLOYER_PRIVATE_KEY").startsWith("0x")
  ? required("DEPLOYER_PRIVATE_KEY")
  : `0x${required("DEPLOYER_PRIVATE_KEY")}`) as Hex;
const account = privateKeyToAccount(privateKey);
const outputPath = resolve(process.env.EVM_MIRROR_DEPLOYMENTS_FILE
  ?? resolve(protocolRoot, "contracts/deployments/testnets.json"));
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const DOMAIN_NONCES_SELECTOR = toFunctionSelector("domainNonces(bytes32)").slice(2).toLowerCase();
const LEGACY_REGISTER_SELECTOR = toFunctionSelector("registerCompany(string,string,address,bool,bytes)").slice(2).toLowerCase();

const networks = [
  { key: "baseSepolia", chain: baseSepolia, rpc: "BASE_RPC_URL", legacy: "BASE_REGISTRY_ADDRESS" },
  { key: "arbitrumSepolia", chain: arbitrumSepolia, rpc: "ARBITRUM_RPC_URL", legacy: "ARBITRUM_REGISTRY_ADDRESS" },
  { key: "polygonAmoy", chain: polygonAmoy, rpc: "POLYGON_RPC_URL", legacy: "POLYGON_REGISTRY_ADDRESS" },
] as const;

type DeploymentManifest = {
  schemaVersion: number;
  environment: string;
  deployedAt: string;
  deployer: Address;
  deployments: Record<string, any>;
};

function save(manifest: DeploymentManifest): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  renameSync(temporary, outputPath);
}

async function detectLegacyRegistrySchema(
  publicClient: ReturnType<typeof createPublicClient>,
  legacyRegistry: Address,
): Promise<"EIP712_V2" | "PERSONAL_SIGN_V1"> {
  const code = (await publicClient.getCode({ address: legacyRegistry }))?.toLowerCase();
  if (!code) throw new Error(`legacy registry has no bytecode: ${legacyRegistry}`);
  if (code.includes(DOMAIN_NONCES_SELECTOR)) return "EIP712_V2";
  if (code.includes(LEGACY_REGISTER_SELECTOR)) return "PERSONAL_SIGN_V1";
  throw new Error(`unsupported legacy registry ABI: ${legacyRegistry}`);
}

async function main(): Promise<void> {
  const manifest: DeploymentManifest = existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, "utf8")) as DeploymentManifest
    : {
        schemaVersion: 1,
        environment: "testnets",
        deployedAt: new Date().toISOString(),
        deployer: account.address,
        deployments: {},
      };
  if (manifest.deployer.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("deployment manifest belongs to a different deployer");
  }
  for (const network of networks) {
    const rpcUrl = required(network.rpc);
    const legacyRegistry = getAddress(required(network.legacy));
    const publicClient = createPublicClient({ chain: network.chain, transport: http(rpcUrl) });
    const wallet = createWalletClient({ account, chain: network.chain, transport: http(rpcUrl) });
    const chainId = await publicClient.getChainId();
    if (chainId !== network.chain.id) throw new Error(`${network.key}: unexpected chain id ${chainId}`);
    const legacyRegistrySchema = await detectLegacyRegistrySchema(publicClient, legacyRegistry);

    const existing = manifest.deployments[network.key];
    if (existing?.proxy) {
      const proxy = getAddress(existing.proxy);
      const implementationSlot = await publicClient.getStorageAt({ address: proxy, slot: IMPLEMENTATION_SLOT });
      const implementation = implementationSlot
        ? getAddress(`0x${implementationSlot.slice(-40)}`)
        : undefined;
      const [proxyCode, implementationCode, owner, guardian, oracleNode, configuredLegacy] = await Promise.all([
        publicClient.getCode({ address: proxy }),
        implementation ? publicClient.getCode({ address: implementation }) : Promise.resolve(undefined),
        publicClient.readContract({ address: proxy, abi: implementationArtifact.abi, functionName: "owner" }),
        publicClient.readContract({ address: proxy, abi: implementationArtifact.abi, functionName: "guardian" }),
        publicClient.readContract({ address: proxy, abi: implementationArtifact.abi, functionName: "oracleNode" }),
        publicClient.readContract({ address: proxy, abi: implementationArtifact.abi, functionName: "legacyRegistry" }),
      ]) as [Hex | undefined, Hex | undefined, Address, Address, Address, Address];
      const expected = account.address.toLowerCase();
      if (!proxyCode || !implementationCode || !implementation
        || owner.toLowerCase() !== expected || guardian.toLowerCase() !== expected
        || oracleNode.toLowerCase() !== expected || configuredLegacy.toLowerCase() !== legacyRegistry.toLowerCase()) {
        throw new Error(`${network.key}: existing deployment verification failed`);
      }
      manifest.deployments[network.key] = {
        ...existing, chainId, proxy, implementation, legacyRegistry, legacyRegistrySchema,
        owner, guardian, oracleNode,
      };
      save(manifest);
      process.stderr.write(`${network.key}: existing deployment verified ${proxy}\n`);
      continue;
    }

    const implementationTx = await wallet.deployContract({
      abi: implementationArtifact.abi,
      bytecode: implementationArtifact.bytecode.object,
      ...(network.key === "polygonAmoy" ? { gas: 7_000_000n } : {}),
    });
    const implementationReceipt = await publicClient.waitForTransactionReceipt({
      hash: implementationTx, confirmations: 2,
    });
    if (implementationReceipt.status !== "success" || !implementationReceipt.contractAddress) {
      throw new Error(`${network.key}: implementation deployment failed`);
    }
    const implementation = implementationReceipt.contractAddress;
    const initData = encodeFunctionData({
      abi: implementationArtifact.abi,
      functionName: "initialize",
      args: [account.address, account.address, account.address, legacyRegistry],
    });
    const proxyTx = await wallet.deployContract({
      abi: proxyArtifact.abi,
      bytecode: proxyArtifact.bytecode.object,
      args: [implementation, initData],
      ...(network.key === "polygonAmoy" ? { gas: 1_000_000n } : {}),
    });
    const proxyReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyTx, confirmations: 2 });
    if (proxyReceipt.status !== "success" || !proxyReceipt.contractAddress) {
      throw new Error(`${network.key}: proxy deployment failed`);
    }
    const proxy = proxyReceipt.contractAddress;
    const [owner, guardian, oracleNode, configuredLegacy] = await Promise.all([
      publicClient.readContract({ address: proxy, abi: implementationArtifact.abi, functionName: "owner" }),
      publicClient.readContract({ address: proxy, abi: implementationArtifact.abi, functionName: "guardian" }),
      publicClient.readContract({ address: proxy, abi: implementationArtifact.abi, functionName: "oracleNode" }),
      publicClient.readContract({ address: proxy, abi: implementationArtifact.abi, functionName: "legacyRegistry" }),
    ]) as Address[];
    const expected = account.address.toLowerCase();
    if (owner.toLowerCase() !== expected || guardian.toLowerCase() !== expected
      || oracleNode.toLowerCase() !== expected || configuredLegacy.toLowerCase() !== legacyRegistry.toLowerCase()) {
      throw new Error(`${network.key}: deployed proxy configuration mismatch`);
    }
    manifest.deployments[network.key] = {
      chainId,
      implementation,
      proxy,
      legacyRegistry,
      legacyRegistrySchema,
      owner,
      guardian,
      oracleNode,
      transactions: { implementation: implementationTx, proxy: proxyTx },
      blocks: {
        implementation: implementationReceipt.blockNumber.toString(),
        proxy: proxyReceipt.blockNumber.toString(),
      },
    };
    save(manifest);
    process.stderr.write(`${network.key}: deployed and verified ${proxy}\n`);
  }
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
