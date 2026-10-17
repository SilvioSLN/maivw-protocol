import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  hexToBytes,
  http,
  keccak256,
  padHex,
  stringToHex,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { arbitrumSepolia, baseSepolia, polygonAmoy, type Chain } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createAttestationSigner } from "../src/multichain/AttestationSigner.js";
import {
  AttestationAction,
  AttestationKind,
  evmAddressToRegistryBytes,
  hashNetworkId,
  type AttestationV1,
} from "../src/multichain/AttestationCodec.js";
import {
  decodeSolanaDomainRecord,
  EvmFinalizedStateReader,
  SolanaFinalizedStateReader,
  type CanonicalDomainState,
} from "../src/multichain/FinalizedStateReader.js";
import { hashMirrorStateV2 } from "../src/multichain/MirrorPayloadCodec.js";
import { buildEvmMirrorTransaction, buildSolanaMirrorTransaction } from "../src/multichain/MirrorTransactionBuilders.js";
import {
  hashRegistrationPayloadV1,
  RegistrationKeyAlgorithm,
  RegistrationProviderTier,
} from "../src/multichain/RegistrationPayloadCodec.js";
import { buildSolanaOriginRegistrationTransaction } from "../src/multichain/SolanaOriginRegistrationBuilder.js";
import { DomainStateChangedDecoder } from "../src/multichain/SolanaObserver.js";

type Artifact = { abi: Abi };
type EvmDeployment = { chainId: number; proxy: Address; legacyRegistry: Address };
type DeploymentManifest = { deployments: Record<string, EvmDeployment> };
type PublicStep = { network: string; direction: string; operation: string; transaction: string; blockOrSlot: string; gasUsed?: string; latencyMs: number };

const gatewayRoot = resolve(import.meta.dirname, "..");
const protocolRoot = resolve(gatewayRoot, "..");
const solanaDeployment = JSON.parse(readFileSync(resolve(protocolRoot, "solana/deployments/devnet.json"), "utf8"));
const evmDeployments = JSON.parse(readFileSync(resolve(protocolRoot, "contracts/deployments/testnets.json"), "utf8")) as DeploymentManifest;
const legacyArtifact = JSON.parse(readFileSync(resolve(protocolRoot, "contracts/out/MAIVWRegistry.sol/MAIVWRegistry.json"), "utf8")) as Artifact;
const mirrorArtifact = JSON.parse(readFileSync(resolve(protocolRoot, "contracts/out/MAIVWMirrorRegistryV2.sol/MAIVWMirrorRegistryV2.json"), "utf8")) as Artifact;

const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const chains: Record<string, { chain: Chain; rpcEnv: string }> = {
  baseSepolia: { chain: baseSepolia, rpcEnv: "BASE_RPC_URL" },
  arbitrumSepolia: { chain: arbitrumSepolia, rpcEnv: "ARBITRUM_RPC_URL" },
  polygonAmoy: { chain: polygonAmoy, rpcEnv: "POLYGON_RPC_URL" },
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function keypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

function instruction(value: { programId: string; keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>; dataBase64: string }): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(value.programId),
    keys: value.keys.map((key) => ({ ...key, pubkey: new PublicKey(key.pubkey) })),
    data: Buffer.from(value.dataBase64, "base64"),
  });
}

function withComputeBudget(instructions: TransactionInstruction[], units: number): TransactionInstruction[] {
  if (instructions.length !== 2) throw new Error("expected secp256k1 and MAIVW instruction pair");
  const verification = new TransactionInstruction({
    programId: instructions[0].programId,
    keys: instructions[0].keys,
    data: Buffer.from(instructions[0].data),
  });
  verification.data[3] = 1;
  verification.data[6] = 1;
  verification.data[11] = 2;
  return [ComputeBudgetProgram.setComputeUnitLimit({ units }), verification, instructions[1]];
}

async function finalizedSolanaTransaction(connection: Connection, signature: string) {
  await waitForSignature(connection, signature, "finalized");
  const transaction = await connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  if (!transaction?.meta || transaction.meta.err) throw new Error(`Solana transaction not finalized successfully: ${signature}`);
  return transaction;
}

async function waitForSignature(
  connection: Connection,
  signature: string,
  commitment: "confirmed" | "finalized",
  timeoutMs = 180_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new Error(`Solana transaction failed: ${signature}: ${JSON.stringify(status.err)}`);
    if (status && (status.confirmationStatus === "finalized"
      || (commitment === "confirmed" && status.confirmationStatus === "confirmed"))) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Solana ${commitment} confirmation timed out: ${signature}`);
}

async function sendLegacyHttp(
  connection: Connection,
  transaction: Transaction,
  signer: Keypair,
): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = transaction.feePayer ?? signer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(signer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    maxRetries: 10, skipPreflight: false,
  });
  await waitForSignature(connection, signature, "confirmed");
  return signature;
}

async function sendSolana(connection: Connection, transaction: Transaction, signer: Keypair): Promise<{ signature: string; slot: bigint; latencyMs: number; units: number | null }> {
  const started = Date.now();
  const signature = await sendLegacyHttp(connection, transaction, signer);
  const finalized = await finalizedSolanaTransaction(connection, signature);
  return {
    signature,
    slot: BigInt(finalized.slot),
    latencyMs: Date.now() - started,
    units: finalized.meta?.computeUnitsConsumed ?? null,
  };
}

async function sendSolanaWithEphemeralLookup(
  connection: Connection,
  instructions: TransactionInstruction[],
  signer: Keypair,
): Promise<{ signature: string; slot: bigint; latencyMs: number; units: number | null; serializedBytes: number }> {
  const recentSlot = await connection.getSlot("finalized");
  const [createLookup, lookupAddress] = AddressLookupTableProgram.createLookupTable({
    authority: signer.publicKey, payer: signer.publicKey, recentSlot,
  });
  await sendLegacyHttp(connection, new Transaction().add(createLookup), signer);
  const addresses = [...new Map(instructions.flatMap((item) => [
    item.programId,
    ...item.keys.filter((key) => !key.isSigner).map((key) => key.pubkey),
  ]).map((address) => [address.toBase58(), address])).values()];
  const extendLookup = AddressLookupTableProgram.extendLookupTable({
    payer: signer.publicKey, authority: signer.publicKey, lookupTable: lookupAddress, addresses,
  });
  const extendSignature = await sendLegacyHttp(connection, new Transaction().add(extendLookup), signer);
  const extendTransaction = await connection.getTransaction(extendSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const extensionSlot = extendTransaction?.slot ?? recentSlot;
  while (await connection.getSlot("confirmed") <= extensionSlot) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const lookup = (await connection.getAddressLookupTable(lookupAddress, { commitment: "confirmed" })).value;
  if (!lookup) throw new Error("ephemeral address lookup table was not found");
  const latest = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: signer.publicKey, recentBlockhash: latest.blockhash, instructions,
  }).compileToV0Message([lookup]);
  const transaction = new VersionedTransaction(message);
  transaction.sign([signer]);
  const serializedBytes = transaction.serialize().length;
  if (serializedBytes > 1_232) throw new Error(`versioned Solana transaction too large: ${serializedBytes}`);
  const started = Date.now();
  const signature = await connection.sendTransaction(transaction, { maxRetries: 10, skipPreflight: false });
  await waitForSignature(connection, signature, "confirmed");
  const finalized = await finalizedSolanaTransaction(connection, signature);
  return {
    signature,
    slot: BigInt(finalized.slot),
    latencyMs: Date.now() - started,
    units: finalized.meta?.computeUnitsConsumed ?? null,
    serializedBytes,
  };
}

async function main(): Promise<void> {
  const evmPrivateKey = (required("DEPLOYER_PRIVATE_KEY").startsWith("0x")
    ? required("DEPLOYER_PRIVATE_KEY") : `0x${required("DEPLOYER_PRIVATE_KEY")}`) as Hex;
  const oraclePrivateKey = (required("ORACLE_PRIVATE_KEY").startsWith("0x")
    ? required("ORACLE_PRIVATE_KEY") : `0x${required("ORACLE_PRIVATE_KEY")}`) as Hex;
  const evmAccount = privateKeyToAccount(evmPrivateKey);
  const oracle = await createAttestationSigner({
    ORACLE_SIGNER_TYPE: "local", ORACLE_PRIVATE_KEY: oraclePrivateKey,
    GCP_KMS_KEY_VERSION: undefined, GCP_KMS_CREDENTIALS_BASE64: undefined,
  });
  const relayer = keypair(required("SOLANA_RELAYER_KEYPAIR_PATH"));
  const connection = new Connection(required("SOLANA_RPC_URL"), "confirmed");
  const programId = new PublicKey(solanaDeployment.programId);
  const mint = new PublicKey(solanaDeployment.asset.mint);
  const solanaNetworkHash = hashNetworkId(solanaDeployment.networkId);
  const solanaRegistry = toHex(programId.toBytes());
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const steps: PublicStep[] = [];
  const computeUnits: Record<string, number | null> = {};

  const solanaDomain = `s-${runId}.test`;
  const solanaDomainHash = keccak256(stringToHex(solanaDomain));
  const endpoint = "https://m.maivw.test/i";
  const publicKey = toHex(relayer.publicKey.toBytes());
  const nonce = toHex(randomBytes(32));
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 3_600);
  const payloadHash = hashRegistrationPayloadV1({
    domainHash: solanaDomainHash,
    registrant: publicKey,
    operationalKeyAlgorithm: RegistrationKeyAlgorithm.ED25519,
    operationalKey: publicKey,
    adminKeyAlgorithm: RegistrationKeyAlgorithm.ED25519,
    adminKey: publicKey,
    endpointHash: keccak256(stringToHex(endpoint)),
    tlsFingerprint: ZERO32,
    isProvider: false,
    providerTier: RegistrationProviderTier.NONE,
    payment: BigInt(solanaDeployment.economics.standardFee),
    mint: toHex(mint.toBytes()),
  });
  const originClaim: AttestationV1 = {
    kind: AttestationKind.ORIGIN_CLAIM,
    action: AttestationAction.REGISTER_ORIGIN,
    domainHash: solanaDomainHash,
    originNetworkHash: solanaNetworkHash,
    originRegistry: solanaRegistry,
    destinationNetworkHash: solanaNetworkHash,
    destinationRegistry: solanaRegistry,
    globalDomainEpoch: 0n,
    originSequence: 0n,
    nonce,
    deadline,
    payloadHash,
    evidenceHash: keccak256(stringToHex(`sm080:dns:${runId}`)),
  };
  const signedClaim = await oracle.signAttestation(originClaim, { purpose: "ORIGIN_CLAIM", operationId: `sm080:${runId}:origin` });
  const draft = await buildSolanaOriginRegistrationTransaction({
    programId: programId.toBase58(),
    registrant: relayer.publicKey.toBase58(),
    registrantTokenAccount: solanaDeployment.asset.deployerTokenAccount,
    mint: mint.toBase58(),
    domain: solanaDomain,
    domainHash: solanaDomainHash,
    endpoint,
    operationalKey: publicKey,
    adminKey: publicKey,
    tlsFingerprint: ZERO32,
    claim: {
      id: randomUUID(), reservationId: randomUUID(), domainHash: solanaDomainHash, codecVersion: 1,
      encoded: signedClaim.encoded, digest: signedClaim.digest, signedBytesHash: signedClaim.digest,
      signature: signedClaim.signature, signerKeyId: signedClaim.keyId, signerKeyVersion: signedClaim.keyVersion,
      nonce, deadline: new Date(Number(deadline) * 1_000), payloadHash, evidenceHash: originClaim.evidenceHash,
      idempotencyKeyHash: ZERO32, requestHash: ZERO32, status: "ISSUED", submittedAt: null,
      consumedAt: null, onChainTxFamily: null, onChainTxId: null, createdAt: new Date(), updatedAt: new Date(),
    },
  });
  const registration = await sendSolanaWithEphemeralLookup(
    connection,
    withComputeBudget(draft.instructions.map(instruction), 450_000),
    relayer,
  );
  steps.push({ network: "solanaDevnet", direction: "origin", operation: "register", transaction: registration.signature, blockOrSlot: registration.slot.toString(), latencyMs: registration.latencyMs });
  computeUnits.solanaOriginRegistration = registration.units;
  computeUnits.solanaOriginRegistrationBytes = registration.serializedBytes;

  const decoder = new DomainStateChangedDecoder();
  const registrationTransaction = await finalizedSolanaTransaction(connection, registration.signature);
  const event = decoder.decode(registrationTransaction.meta?.logMessages ?? [], programId.toBase58())
    .find((item) => item.domainHash?.toLowerCase() === solanaDomainHash.toLowerCase());
  if (!event) throw new Error("Solana registration did not emit DomainStateChanged");
  const eventPayload = event.payload as { globalDomainEpoch: bigint; originSequence: bigint };
  const solanaReader = new SolanaFinalizedStateReader({
    deriveDomainRecordAddress: (hash: Hex, id: string) => PublicKey.findProgramAddressSync(
      [Buffer.from("domain"), Buffer.from(hexToBytes(hash))], new PublicKey(id),
    )[0].toBase58(),
    getAccountInfo: async ({ address, commitment, minContextSlot }) => {
      const account = await connection.getAccountInfoAndContext(new PublicKey(address), { commitment, minContextSlot: Number(minContextSlot) });
      return account.value ? { contextSlot: BigInt(account.context.slot), owner: account.value.owner.toBase58(), data: account.value.data } : null;
    },
  }, programId.toBase58());
  const solanaState = await solanaReader.read({
    domain: solanaDomain, domainHash: solanaDomainHash, slot: registration.slot,
    signature: registration.signature, globalDomainEpoch: eventPayload.globalDomainEpoch,
    originSequence: eventPayload.originSequence,
  });

  for (const [networkKey, deployment] of Object.entries(evmDeployments.deployments)) {
    const network = chains[networkKey];
    if (!network) throw new Error(`unsupported deployment network: ${networkKey}`);
    const rpcUrl = required(network.rpcEnv);
    const publicClient = createPublicClient({ chain: network.chain, transport: http(rpcUrl) });
    const wallet = createWalletClient({ account: evmAccount, chain: network.chain, transport: http(rpcUrl) });
    const destinationHash = hashNetworkId(`evm:${deployment.chainId}`);
    const attestation: AttestationV1 = {
      kind: AttestationKind.STATE_ATTESTATION,
      action: AttestationAction.REGISTER_MIRROR,
      domainHash: solanaState.domainHash,
      originNetworkHash: solanaState.originNetworkHash,
      originRegistry: solanaState.originRegistry,
      destinationNetworkHash: destinationHash,
      destinationRegistry: evmAddressToRegistryBytes(deployment.proxy),
      globalDomainEpoch: solanaState.globalDomainEpoch,
      originSequence: solanaState.originSequence,
      nonce: toHex(randomBytes(32)),
      deadline: BigInt(Math.floor(Date.now() / 1_000) + 3_600),
      payloadHash: hashMirrorStateV2(solanaState),
      evidenceHash: solanaState.originTransaction,
    };
    const signed = await oracle.signAttestation(attestation, { purpose: "STATE_ATTESTATION", operationId: `sm080:${runId}:sol-to-${networkKey}` });
    const built = await buildEvmMirrorTransaction({
      operation: "REGISTER", state: solanaState, destinationNetworkHash: destinationHash,
      mirrorRegistry: deployment.proxy, attestation, signature: signed.signature,
      expectedSigner: signed.signerAddress,
    });
    const started = Date.now();
    const hash = await wallet.sendTransaction({ to: built.to, data: built.data, value: built.value });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
    if (receipt.status !== "success") throw new Error(`${networkKey}: Solana-origin mirror failed`);
    const version = await publicClient.readContract({ address: deployment.proxy, abi: mirrorArtifact.abi, functionName: "getMirrorVersion", args: [solanaDomain] }) as any;
    if (!version.exists || version.originNetworkHash.toLowerCase() !== solanaNetworkHash.toLowerCase()) {
      throw new Error(`${networkKey}: Solana-origin mirror verification failed`);
    }
    steps.push({ network: networkKey, direction: "solana-to-evm", operation: "registerMirrorV2", transaction: hash, blockOrSlot: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), latencyMs: Date.now() - started });

    const evmDomain = `sm080-${networkKey.toLowerCase()}-${runId}.maivw.test`;
    const evmDomainHash = keccak256(stringToHex(evmDomain));
    const evmDeadline = BigInt(Math.floor(Date.now() / 1_000) + 3_600);
    const nonceValue = await publicClient.readContract({ address: deployment.legacyRegistry, abi: legacyArtifact.abi, functionName: "domainNonces", args: [evmDomainHash] }) as bigint;
    const proof = await evmAccount.signTypedData({
      domain: { name: "MAIVWRegistry", version: "2", chainId: deployment.chainId, verifyingContract: deployment.legacyRegistry },
      types: { Register: [
        { name: "domainHash", type: "bytes32" }, { name: "publicKey", type: "address" },
        { name: "adminKey", type: "address" }, { name: "registrant", type: "address" },
        { name: "isProvider", type: "bool" }, { name: "tier", type: "uint8" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
      ] },
      primaryType: "Register",
      message: { domainHash: evmDomainHash, publicKey: evmAccount.address, adminKey: evmAccount.address, registrant: evmAccount.address, isProvider: false, tier: 0, nonce: nonceValue, deadline: evmDeadline },
    });
    const standardFee = await publicClient.readContract({ address: deployment.legacyRegistry, abi: legacyArtifact.abi, functionName: "standardFee" }) as bigint;
    const evmStarted = Date.now();
    const originTx = await wallet.writeContract({
      address: deployment.legacyRegistry,
      abi: legacyArtifact.abi,
      functionName: "registerCompany",
      args: [evmDomain, `https://${evmDomain}/inbox`, evmAccount.address, evmAccount.address, false, evmDeadline, proof],
      value: standardFee,
    });
    const originReceipt = await publicClient.waitForTransactionReceipt({ hash: originTx, confirmations: 2 });
    if (originReceipt.status !== "success") throw new Error(`${networkKey}: EVM origin registration failed`);
    const canonicalReceipt = await publicClient.getTransactionReceipt({ hash: originTx });
    const canonicalBlock = await publicClient.getBlock({ blockNumber: canonicalReceipt.blockNumber });
    if (!canonicalBlock.hash || canonicalReceipt.blockHash.toLowerCase() !== canonicalBlock.hash.toLowerCase()) {
      throw new Error(`${networkKey}: EVM origin transaction was reorganized before checkpointing`);
    }
    steps.push({ network: networkKey, direction: "origin", operation: "registerCompany", transaction: originTx, blockOrSlot: originReceipt.blockNumber.toString(), gasUsed: originReceipt.gasUsed.toString(), latencyMs: Date.now() - evmStarted });
    const evmReader = new EvmFinalizedStateReader(publicClient as any, {
      networkHash: destinationHash,
      registryAddress: deployment.legacyRegistry,
      registryId: evmAddressToRegistryBytes(deployment.legacyRegistry),
      schemaVersion: 2,
      tlsFingerprintMode: "OPTIONAL_ZERO",
    });
    const evmState = await evmReader.read({
      domain: evmDomain, domainHash: evmDomainHash, blockNumber: canonicalBlock.number,
      blockHash: canonicalBlock.hash, transactionHash: originTx,
      globalDomainEpoch: 0n, originSequence: 0n,
    });
    const toSolana: AttestationV1 = {
      kind: AttestationKind.STATE_ATTESTATION,
      action: AttestationAction.REGISTER_MIRROR,
      domainHash: evmState.domainHash,
      originNetworkHash: evmState.originNetworkHash,
      originRegistry: evmState.originRegistry,
      destinationNetworkHash: solanaNetworkHash,
      destinationRegistry: solanaRegistry,
      globalDomainEpoch: evmState.globalDomainEpoch,
      originSequence: evmState.originSequence,
      nonce: toHex(randomBytes(32)),
      deadline: BigInt(Math.floor(Date.now() / 1_000) + 3_600),
      payloadHash: hashMirrorStateV2(evmState),
      evidenceHash: evmState.originTransaction,
    };
    const signedToSolana = await oracle.signAttestation(toSolana, { purpose: "STATE_ATTESTATION", operationId: `sm080:${runId}:${networkKey}-to-sol` });
    const solanaMirror = await buildSolanaMirrorTransaction({
      operation: "REGISTER", state: evmState, destinationNetworkHash: solanaNetworkHash,
      programId: programId.toBase58(), relayer: relayer.publicKey.toBase58(),
      attestation: toSolana, signature: signedToSolana.signature,
      expectedSigner: signedToSolana.signerAddress,
    });
    const mirrorResult = await sendSolana(connection, solanaMirror.transaction, relayer);
    const mirrorAccount = await connection.getAccountInfo(new PublicKey(solanaMirror.domainRecordAddress), "finalized");
    if (!mirrorAccount) throw new Error(`${networkKey}: Solana mirror account missing`);
    const decodedMirror = decodeSolanaDomainRecord(mirrorAccount.data);
    if (decodedMirror.recordKind !== "MIRROR" || decodedMirror.originNetworkHash.toLowerCase() !== destinationHash.toLowerCase()) {
      throw new Error(`${networkKey}: EVM-origin Solana mirror verification failed`);
    }
    computeUnits[`${networkKey}ToSolana`] = mirrorResult.units;
    steps.push({ network: "solanaDevnet", direction: "evm-to-solana", operation: "registerMirror", transaction: mirrorResult.signature, blockOrSlot: mirrorResult.slot.toString(), latencyMs: mirrorResult.latencyMs });
  }

  const evidence = {
    schemaVersion: 1,
    task: "SM-080",
    runId,
    executedAt: new Date().toISOString(),
    status: Object.keys(evmDeployments.deployments).length === 3 ? "PASS" : "PARTIAL",
    expectedNetworks: ["solanaDevnet", "baseSepolia", "arbitrumSepolia", "polygonAmoy"],
    testedEvmNetworks: Object.keys(evmDeployments.deployments),
    domains: { solanaOrigin: solanaDomain },
    computeUnits,
    steps,
  };
  const evidencePath = resolve(protocolRoot, `evidence/sm-080/${runId}.json`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  const temporary = `${evidencePath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
  renameSync(temporary, evidencePath);
  process.stdout.write(`${JSON.stringify({ evidencePath, status: evidence.status, steps: steps.length })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
