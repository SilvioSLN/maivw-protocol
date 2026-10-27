import { Connection, PublicKey } from "@solana/web3.js";
import { createPublicClient, createWalletClient, defineChain, http, hexToBytes, keccak256, toHex, parseTransaction, type Account, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PrismaClient } from "@prisma/client";
import type { EnvConfig } from "../config.js";
import type { LedgerService } from "../services/LedgerService.js";
import { createAwsKmsAccount, createAwsKmsSolanaSigner } from "../services/AwsKmsAccount.js";
import { SignerFactory } from "../signer/SignerFactory.js";
import { createAttestationSigner } from "../multichain/AttestationSigner.js";
import { hashNetworkId } from "../multichain/AttestationCodec.js";
import { EvmFinalizedStateReader, SolanaFinalizedStateReader } from "../multichain/FinalizedStateReader.js";
import { hashMirrorStateV2 } from "../multichain/MirrorPayloadCodec.js";
import { RelayFanoutService, type FanoutDestination, type PreparedRelayTransactionSigner, type FanoutAttestationSigner } from "../multichain/RelayFanout.js";
import { PrismaRelayJobRepository, MultichainRelayJobService } from "../multichain/MultichainRelayJob.js";
import { createPrismaRelaySubmissionCoordinator, type RelayBroadcastAdapter } from "../multichain/RelaySubmission.js";
import { PrismaRelayCircuitBreakerRepository, RelayCircuitBreakerService, RelayCircuitSubmissionGate } from "../multichain/RelayCircuitBreaker.js";
import { OperationStateError } from "./durableOperations.js";

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`), text = "";
  while (n) { text = alphabet[Number(n % 58n)] + text; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; text = "1" + text; }
  return text;
}

/** Uses only durable relay jobs, finalized origin readers and existing submission/fanout coordinators. */
export async function createRuntimeRelayWorker(config: EnvConfig, db: PrismaClient, ledger: LedgerService,
  adapters: { evmClientFactory?: (network: import("../multichain/NetworkModel.js").EvmNetworkDefinition) => any;
    transactionSigner?: PreparedRelayTransactionSigner; attestor?: FanoutAttestationSigner } = {}) {
  if (!config.MULTICHAIN_RELAY_ENABLED) throw new Error("Relay consumer requires MULTICHAIN_RELAY_ENABLED");
  const repository = new PrismaRelayJobRepository(db);
  const jobs = new MultichainRelayJobService(repository);
  const circuits = new RelayCircuitBreakerService(new PrismaRelayCircuitBreakerRepository(db));
  const gate = new RelayCircuitSubmissionGate(circuits, { resolve: async destinationId => {
    const destination = await db.multichainRelayDestination.findUnique({ where: { id: destinationId }, include: { job: true } });
    return destination ? { domainHash: destination.job.domainHash, networkId: destination.destinationNetworkId, registryId: destination.destinationRegistryId } : null;
  } });
  const submissions = createPrismaRelaySubmissionCoordinator(db, repository, undefined, gate);
  const attestor = adapters.attestor ?? await createAttestationSigner(config);
  const networks = new Map(ledger.listAdapters().map(adapter => [String(adapter.networkId), adapter.network]));
  const evmClients = new Map<string, any>();
  const solClients = new Map<string, Connection>();
  let evmAccount: Account | undefined;
  const getEvmAccount = async () => {
    if (evmAccount) return evmAccount;
    if (config.RELAYER_EVM_KMS_KEY_ID) evmAccount = await createAwsKmsAccount({ keyId: config.RELAYER_EVM_KMS_KEY_ID, region: config.SES_REGION, role: "relayer" });
    else if (config.RELAYER_EVM_PRIVATE_KEY && !config.IS_CLOUD) evmAccount = privateKeyToAccount(config.RELAYER_EVM_PRIVATE_KEY as Hex);
    else throw new Error("An explicit relayer EVM signer is required; oracle/deployer fallback refused");
    return evmAccount;
  };
  let solSigner: ReturnType<typeof createAwsKmsSolanaSigner> | ReturnType<typeof SignerFactory.createSolanaRelayerSigner>;
  const getSolSigner = () => {
    if (!solSigner) solSigner = config.SOLANA_RELAYER_SIGNER_TYPE === "aws-kms"
      ? createAwsKmsSolanaSigner({ keyId: config.SOLANA_RELAYER_KMS_KEY_ID!, region: config.SES_REGION })
      : SignerFactory.createSolanaRelayerSigner(config);
    if (!solSigner || (config.IS_CLOUD && config.SOLANA_RELAYER_SIGNER_TYPE !== "aws-kms")) throw new Error("Explicit approved Solana signer required");
    return solSigner;
  };
  async function client(id: string) {
    const network = networks.get(id); if (!network) throw new Error("Relay network not configured");
    if (network.family === "EVM") {
      let c = evmClients.get(id);
      if (!c) { c = adapters.evmClientFactory ? adapters.evmClientFactory(network) : createPublicClient({ transport: http(network.rpcUrl) }); evmClients.set(id, c); }
      if (await c.getChainId() !== network.chainId) throw new Error("Relay chain mismatch");
      return { network, evm: c, solana: undefined };
    }
    let c = solClients.get(id); if (!c) { c = new Connection(network.rpcUrl, "finalized"); solClients.set(id, c); }
    if (await c.getGenesisHash() !== network.genesisHash) throw new Error("Relay genesis mismatch");
    return { network, evm: undefined, solana: c };
  }
  const broadcaster = (id: string): RelayBroadcastAdapter => ({
    broadcast: async ({ signedPayload: payload }) => {
      const c = await client(id);
      const transactionId = c.network.family === "EVM"
        ? await c.evm.sendRawTransaction({ serializedTransaction: payload as Hex })
        : await c.solana!.sendRawTransaction(Buffer.from(hexToBytes(payload as Hex)), { skipPreflight: false, maxRetries: 0 });
      return { transactionId };
    },
    checkFinality: async transactionId => {
      const c = await client(id);
      if (c.network.family === "EVM") {
        let receipt;
        try { receipt = await c.evm.getTransactionReceipt({ hash: transactionId as Hex }); }
        catch (error) { if ((error as Error).name === "TransactionReceiptNotFoundError") return { status: "PENDING" }; throw error; }
        if (receipt.status !== "success") return { status: "REVERTED", reason: "Receipt reverted" };
        const canonical = await c.evm.getBlock({ blockNumber: receipt.blockNumber });
        if (canonical.hash !== receipt.blockHash) return { status: "REVERTED", reason: "Receipt orphaned" };
        const head = await c.evm.getBlockNumber();
        if (head < receipt.blockNumber + BigInt(c.network.finality.confirmations)) return { status: "PENDING" };
        return { status: "FINALIZED", reference: `${receipt.blockNumber}:${receipt.blockHash}` };
      }
      const status = (await c.solana!.getSignatureStatuses([transactionId], { searchTransactionHistory: true })).value[0];
      if (!status) return { status: "PENDING" };
      if (status.err) return { status: "REVERTED", reason: "Solana transaction failed" };
      return status.confirmationStatus === "finalized" ? { status: "FINALIZED", reference: String(status.slot) } : { status: "PENDING" };
    },
  });
  const transactionSigner: PreparedRelayTransactionSigner = { sign: async input => {
    const c = await client(input.networkId);
    if (input.family === "EVM") {
      if (c.network.family !== "EVM") throw new Error("Signer family mismatch");
      const account = await getEvmAccount();
      const chain = defineChain({ id: c.network.chainId, name: c.network.name, nativeCurrency: { name: c.network.asset.symbol, symbol: c.network.asset.symbol, decimals: c.network.asset.decimals }, rpcUrls: { default: { http: [c.network.rpcUrl] } } });
      const wallet = createWalletClient({ account, chain, transport: http(c.network.rpcUrl) });
      const pendingNonce = await c.evm.getTransactionCount({ address: account.address, blockTag: "pending" });
      const unresolved = await db.multichainRelaySubmission.findMany({ where: {
        status: { in: ["PREPARED", "BROADCAST"] }, destination: { destinationNetworkId: input.networkId },
      }, select: { signedPayload: true } });
      for (const previous of unresolved) {
        const tx = parseTransaction(previous.signedPayload as Hex);
        if (tx.nonce !== undefined && tx.nonce >= pendingNonce) throw new Error("Unresolved relay nonce; reconcile previous submission before signing a new operation");
      }
      const prepared = await wallet.prepareTransactionRequest({ account, to: input.transaction.to, data: input.transaction.data, value: 0n });
      const signedPayload = await wallet.signTransaction(prepared as any);
      return { signedPayload, transactionId: keccak256(signedPayload) };
    }
    if (c.network.family !== "SOLANA") throw new Error("Signer family mismatch");
    const signer = getSolSigner(), address = await signer.getAddress();
    if (address !== config.SOLANA_RELAYER_PUBLIC_KEY) throw new Error("Solana signer public key mismatch");
    const tx = input.transaction.transaction;
    tx.feePayer = new PublicKey(address);
    tx.recentBlockhash = (await c.solana!.getLatestBlockhash("finalized")).blockhash;
    const signature = await signer.signMessage(tx.serializeMessage(), { purpose: "relay", operationId: input.transaction.attestationDigest });
    tx.addSignature(new PublicKey(address), Buffer.from(signature, "base64"));
    const bytes = tx.serialize();
    return { signedPayload: toHex(bytes), transactionId: base58(tx.signature!) };
  } };
  const fanout = new RelayFanoutService(jobs, submissions, attestor, adapters.transactionSigner ?? transactionSigner, gate);
  return { async run(jobId: string) {
    const job = await db.multichainRelayJob.findUnique({ where: { id: jobId } });
    if (!job || ["ORPHANED", "COMPENSATION_REQUIRED", "RECONCILE"].includes(job.status)) throw new Error("Relay job requires reconciliation");
    if (job.status === "CONFIRMED") return { status: "CONFIRMED", jobId: job.id };
    const origin = await db.originRecord.findUnique({ where: { domainHash: job.domainHash } });
    if (!origin || origin.originNetworkId !== job.originNetworkId || origin.globalDomainEpoch !== job.globalDomainEpoch || origin.originSequence !== job.originSequence) throw new Error("Origin/job mismatch");
    const source = await client(job.originNetworkId);
    if (source.network.registryId.toLowerCase() !== job.originRegistryId.toLowerCase()) throw new Error("Origin registry mismatch");
    let state;
    if (source.network.family === "EVM") {
      const receipt = await source.evm.getTransactionReceipt({ hash: job.sourceTransactionId as Hex });
      const head = await source.evm.getBlockNumber();
      if (receipt.status !== "success" || head < receipt.blockNumber + BigInt(source.network.finality.confirmations)) throw new Error("Origin not finalized");
      state = await new EvmFinalizedStateReader(source.evm, { networkHash: hashNetworkId(job.originNetworkId), registryAddress: source.network.registryAddress, registryId: source.network.registryId, schemaVersion: source.network.registryVersion,
        registryProfileMode: config.EVM_ORIGIN_PROFILE_MODE,
      }).read({ domain: origin.domain, domainHash: job.domainHash as Hex, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, transactionHash: job.sourceTransactionId as Hex, globalDomainEpoch: job.globalDomainEpoch, originSequence: job.originSequence });
    } else {
      const status = (await source.solana!.getSignatureStatuses([job.sourceTransactionId], { searchTransactionHistory: true })).value[0];
      if (!status || status.err || status.confirmationStatus !== "finalized") throw new Error("Origin not finalized");
      state = await new SolanaFinalizedStateReader({
        deriveDomainRecordAddress: (hash, programId) => PublicKey.findProgramAddressSync([Buffer.from("domain"), Buffer.from(hexToBytes(hash))], new PublicKey(programId))[0].toBase58(),
        getAccountInfo: async ({ address, commitment, minContextSlot }) => {
          const result = await source.solana!.getAccountInfoAndContext(new PublicKey(address), { commitment, minContextSlot: Number(minContextSlot) });
          return result.value ? { contextSlot: BigInt(result.context.slot), owner: result.value.owner.toBase58(), data: result.value.data } : null;
        },
      }, source.network.programId).read({ domain: origin.domain, domainHash: job.domainHash as Hex, slot: BigInt(status.slot), signature: job.sourceTransactionId, globalDomainEpoch: job.globalDomainEpoch, originSequence: job.originSequence });
    }
    if (state.recordKind !== "ORIGIN") throw new Error("Source is not an origin record");
    await jobs.finalize(job.id, hashMirrorStateV2(state), new Date());
    const destinations: FanoutDestination[] = [];
    for (const row of await repository.listDestinations(job.id)) {
      const network = networks.get(row.destinationNetworkId);
      if (!network || network.registryId.toLowerCase() !== row.destinationRegistryId.toLowerCase()) throw new Error("Destination not configured");
      const common = { destinationId: row.id, networkId: String(network.networkId), networkHash: hashNetworkId(network.networkId), adapter: broadcaster(network.networkId) };
      destinations.push(network.family === "EVM" ? { ...common, family: "EVM", mirrorRegistry: network.registryAddress }
        : { ...common, family: "SOLANA", programId: network.programId, relayer: await getSolSigner().getAddress() });
    }
    const results = await fanout.execute({ jobId: job.id, operation: job.operation, state, attestationDeadline: BigInt(Math.floor(Date.now() / 1000) + 600), destinations, workerId: randomWorkerId(job.id) });
    let allConfirmed = results.every(result => result.status !== "FAILED");
    for (const destination of destinations) {
      const submission = await submissions.getByDestination(destination.destinationId);
      if (!submission || submission.status === "PREPARED") { allConfirmed = false; continue; }
      try {
        const result = await submissions.confirm(submission.id, destination.adapter);
        if (!result.confirmed) allConfirmed = false;
      } catch (error) {
        allConfirmed = false;
        if ((error as { code?: string }).code === "SUBMISSION_FINALITY_FAILED") await jobs.advanceDestination({
          destinationId: destination.destinationId, toStatus: "RECONCILE", reference: "transaction-finality-failed",
        });
      }
    }
    if (!allConfirmed) throw new OperationStateError("RELAY_AWAITING_CONFIRMATION_OR_RECONCILIATION");
    return { status: "CONFIRMED", jobId: job.id };
  } };
}
function randomWorkerId(jobId: string) { return `runtime-${process.pid}-${jobId}`; }
