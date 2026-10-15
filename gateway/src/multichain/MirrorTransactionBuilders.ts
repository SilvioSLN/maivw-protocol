import {
  PublicKey,
  Secp256k1Program,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  encodeFunctionData,
  hexToBytes,
  keccak256,
  padHex,
  recoverAddress,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  AttestationAction,
  AttestationKind,
  encodeAttestationV1,
  evmAddressToRegistryBytes,
  hashAttestationV1,
  type AttestationV1,
} from "./AttestationCodec.js";
import type { CanonicalDomainState } from "./FinalizedStateReader.js";
import { hashMirrorStateV2 } from "./MirrorPayloadCodec.js";

const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const MAX_U64 = (1n << 64n) - 1n;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const REGISTER_MIRROR_DISCRIMINATOR = Buffer.from([22, 136, 130, 144, 170, 118, 114, 220]);
const SYNC_MIRROR_DISCRIMINATOR = Buffer.from([147, 156, 93, 246, 2, 107, 220, 28]);
const REVOKE_MIRROR_DISCRIMINATOR = Buffer.from([105, 99, 35, 241, 103, 60, 119, 105]);

export type MirrorOperation = "REGISTER" | "SYNC" | "REVOKE";

const MIRROR_ABI = [
  ...["registerMirrorV2", "syncMirrorV2", "revokeMirrorV2"].map((name) => ({
    type: "function" as const,
    name,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "_domain", type: "string" },
      { name: "_state", type: "tuple", components: [
        { name: "publicKey", type: "tuple", components: [
          { name: "algorithm", type: "uint8" }, { name: "keyData", type: "bytes32" },
        ] },
        { name: "adminKey", type: "tuple", components: [
          { name: "algorithm", type: "uint8" }, { name: "keyData", type: "bytes32" },
        ] },
        { name: "endpointUrl", type: "string" }, { name: "tlsFingerprint", type: "bytes32" },
        { name: "status", type: "uint8" }, { name: "isProvider", type: "bool" },
        { name: "tier", type: "uint8" }, { name: "strikeCount", type: "uint32" },
        { name: "registrationTime", type: "uint64" }, { name: "attestedStake", type: "uint256" },
        { name: "dailyLimit", type: "uint256" },
      ] },
      { name: "_attestation", type: "tuple", components: [
        { name: "kind", type: "uint8" }, { name: "action", type: "uint8" },
        { name: "domainHash", type: "bytes32" }, { name: "originNetworkHash", type: "bytes32" },
        { name: "originRegistry", type: "bytes32" }, { name: "destinationNetworkHash", type: "bytes32" },
        { name: "destinationRegistry", type: "bytes32" }, { name: "globalDomainEpoch", type: "uint64" },
        { name: "originSequence", type: "uint64" }, { name: "nonce", type: "bytes32" },
        { name: "deadline", type: "uint64" }, { name: "payloadHash", type: "bytes32" },
        { name: "evidenceHash", type: "bytes32" },
      ] },
      { name: "_oracleSignature", type: "bytes" },
    ],
    outputs: [{ name: "applied", type: "bool" }],
  })),
] as const;

export interface SignedMirrorAttestation {
  attestation: AttestationV1;
  signature: Hex;
  expectedSigner: Address;
}

export interface EvmMirrorBuilderInput extends SignedMirrorAttestation {
  operation: MirrorOperation;
  state: CanonicalDomainState;
  destinationNetworkHash: Hex;
  mirrorRegistry: Address;
  now?: bigint;
}

export interface EvmMirrorTransaction {
  chainFamily: "EVM";
  operation: MirrorOperation;
  to: Address;
  data: Hex;
  value: 0n;
  payloadHash: Hex;
  attestationDigest: Hex;
}

function actionFor(operation: MirrorOperation): AttestationAction {
  if (operation === "REGISTER") return AttestationAction.REGISTER_MIRROR;
  if (operation === "SYNC") return AttestationAction.SYNC_MIRROR;
  return AttestationAction.REVOKE_MIRROR;
}

function evmStatus(state: CanonicalDomainState): number {
  if (state.status === "ACTIVE") return 1;
  if (state.status === "SUSPENDED") return 2;
  return 3;
}

function eqHex(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

async function validateBuildInput(
  input: SignedMirrorAttestation & {
    operation: MirrorOperation;
    state: CanonicalDomainState;
    destinationNetworkHash: Hex;
    destinationRegistry: Hex;
    now?: bigint;
  },
): Promise<{ payloadHash: Hex; digest: Hex; encoded: Hex }> {
  const { state, attestation } = input;
  const payloadHash = hashMirrorStateV2(state);
  const computedDomainHash = keccak256(stringToHex(state.domain));
  const expectedAction = actionFor(input.operation);
  if (state.recordKind !== "ORIGIN" || !eqHex(computedDomainHash, state.domainHash)) {
    throw new Error("only a canonical finalized origin state can be mirrored");
  }
  if (state.originTransactionFamily !== state.originFamily || eqHex(state.originTransaction, ZERO32)
    || (eqHex(state.originNetworkHash, input.destinationNetworkHash)
      && eqHex(state.originRegistry, input.destinationRegistry))) {
    throw new Error("mirror origin evidence or destination is invalid");
  }
  if (input.operation === "REVOKE" ? state.status !== "REVOKED" : state.status === "REVOKED") {
    throw new Error("mirror operation does not match the finalized state status");
  }
  if (attestation.kind !== AttestationKind.STATE_ATTESTATION || attestation.action !== expectedAction
    || !eqHex(attestation.domainHash, state.domainHash)
    || !eqHex(attestation.originNetworkHash, state.originNetworkHash)
    || !eqHex(attestation.originRegistry, state.originRegistry)
    || !eqHex(attestation.destinationNetworkHash, input.destinationNetworkHash)
    || !eqHex(attestation.destinationRegistry, input.destinationRegistry)
    || attestation.globalDomainEpoch !== state.globalDomainEpoch
    || attestation.originSequence !== state.originSequence
    || !eqHex(attestation.payloadHash, payloadHash)
    || !eqHex(attestation.evidenceHash, state.originTransaction)
    || eqHex(attestation.nonce, ZERO32)
    || (input.now ?? BigInt(Math.floor(Date.now() / 1_000))) > attestation.deadline) {
    throw new Error("state attestation does not bind the requested mirror transaction");
  }
  if (!SIGNATURE.test(input.signature)) throw new Error("oracle signature must be recoverable secp256k1");
  const encoded = encodeAttestationV1(attestation);
  const digest = hashAttestationV1(attestation);
  const recovered = await recoverAddress({ hash: digest, signature: input.signature });
  if (recovered.toLowerCase() !== input.expectedSigner.toLowerCase()) {
    throw new Error("oracle signature does not match the configured destination signer");
  }
  return { payloadHash, digest, encoded };
}

/** Builds an unsigned EVM call after checking every field the destination contract will bind. */
export async function buildEvmMirrorTransaction(input: EvmMirrorBuilderInput): Promise<EvmMirrorTransaction> {
  const destinationRegistry = evmAddressToRegistryBytes(input.mirrorRegistry);
  const verified = await validateBuildInput({ ...input, destinationRegistry });
  const functionName = input.operation === "REGISTER" ? "registerMirrorV2"
    : input.operation === "SYNC" ? "syncMirrorV2" : "revokeMirrorV2";
  const state = {
    publicKey: { algorithm: input.state.operationalKey.algorithm, keyData: input.state.operationalKey.value },
    adminKey: { algorithm: input.state.adminKey.algorithm, keyData: input.state.adminKey.value },
    endpointUrl: input.state.endpoint,
    tlsFingerprint: input.state.tlsFingerprint,
    status: evmStatus(input.state),
    isProvider: input.state.isProvider,
    tier: input.state.providerTier,
    strikeCount: input.state.strikes,
    registrationTime: input.state.registrationTime,
    attestedStake: input.state.attestedStake,
    dailyLimit: input.state.attestedDailyLimit,
  };
  return {
    chainFamily: "EVM",
    operation: input.operation,
    to: input.mirrorRegistry,
    data: encodeFunctionData({
      abi: MIRROR_ABI,
      functionName,
      args: [input.state.domain, state, input.attestation, input.signature],
    }),
    value: 0n,
    payloadHash: verified.payloadHash,
    attestationDigest: verified.digest,
  };
}

export interface SolanaMirrorBuilderInput extends SignedMirrorAttestation {
  operation: MirrorOperation;
  state: CanonicalDomainState;
  destinationNetworkHash: Hex;
  programId: string;
  relayer: string;
  now?: bigint;
}

export interface SolanaMirrorTransaction {
  chainFamily: "SOLANA";
  operation: MirrorOperation;
  transaction: Transaction;
  verificationInstruction: TransactionInstruction;
  programInstruction: TransactionInstruction;
  configAddress: string;
  domainRecordAddress: string;
  receiptAddress: string;
  payloadHash: Hex;
  attestationDigest: Hex;
}

function u32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
}

function u64(value: bigint): Buffer {
  if (value < 0n || value > MAX_U64) throw new Error("Solana mirror field exceeds u64");
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(value);
  return result;
}

function fixedHex(value: Hex, size: number): Buffer {
  const bytes = Buffer.from(hexToBytes(value));
  if (bytes.length !== size) throw new Error(`expected ${size} bytes`);
  return bytes;
}

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u32(bytes.length), bytes]);
}

function encodeSolanaMirrorArgs(state: CanonicalDomainState, nonce: Hex): Buffer {
  if (state.attestedStake > MAX_U64 || state.attestedDailyLimit > MAX_U64) {
    throw new Error("Solana destination cannot represent mirror economics above u64");
  }
  return Buffer.concat([
    fixedHex(state.domainHash, 32),
    fixedHex(nonce, 32),
    borshString(state.domain),
    Buffer.from([state.originFamily === "EVM" ? 0 : 1]),
    Buffer.from([state.operationalKey.algorithm]), fixedHex(state.operationalKey.value, 32),
    Buffer.from([state.adminKey.algorithm]), fixedHex(state.adminKey.value, 32),
    borshString(state.endpoint),
    fixedHex(state.tlsFingerprint, 32),
    Buffer.from([state.status === "ACTIVE" ? 0 : state.status === "SUSPENDED" ? 1 : 2]),
    Buffer.from([state.isProvider ? 1 : 0, state.providerTier]),
    u32(state.strikes),
    u64(state.registrationTime),
    u64(state.attestedStake),
    u64(state.attestedDailyLimit),
  ]);
}

function solanaDiscriminator(operation: MirrorOperation): Buffer {
  if (operation === "REGISTER") return REGISTER_MIRROR_DISCRIMINATOR;
  if (operation === "SYNC") return SYNC_MIRROR_DISCRIMINATOR;
  return REVOKE_MIRROR_DISCRIMINATOR;
}

/** Builds the ordered secp256k1 + Anchor instructions; the relayer still signs the returned transaction. */
export async function buildSolanaMirrorTransaction(
  input: SolanaMirrorBuilderInput,
): Promise<SolanaMirrorTransaction> {
  const programId = new PublicKey(input.programId);
  const relayer = new PublicKey(input.relayer);
  const destinationRegistry = toHex(programId.toBytes());
  const verified = await validateBuildInput({ ...input, destinationRegistry });
  const signature = Buffer.from(hexToBytes(input.signature));
  const rawRecoveryId = signature[64];
  const recoveryId = rawRecoveryId >= 27 ? rawRecoveryId - 27 : rawRecoveryId;
  if (recoveryId > 1) throw new Error("oracle signature recovery id must be 0 or 1");
  const verificationInstruction = Secp256k1Program.createInstructionWithEthAddress({
    ethAddress: input.expectedSigner,
    message: Buffer.from(hexToBytes(verified.encoded)),
    signature: signature.subarray(0, 64),
    recoveryId,
    instructionIndex: 0,
  });
  const domainHash = fixedHex(input.state.domainHash, 32);
  const nonce = fixedHex(input.attestation.nonce, 32);
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("registry-config")], programId);
  const [domainRecord] = PublicKey.findProgramAddressSync([Buffer.from("domain"), domainHash], programId);
  const [receipt] = PublicKey.findProgramAddressSync(
    [Buffer.from("mirror-attestation"), domainHash, nonce],
    programId,
  );
  const args = encodeSolanaMirrorArgs(input.state, input.attestation.nonce);
  const envelope = Buffer.from(hexToBytes(verified.encoded));
  const programInstruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: relayer, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: domainRecord, isSigner: false, isWritable: true },
      { pubkey: receipt, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([solanaDiscriminator(input.operation), args, u32(envelope.length), envelope]),
  });
  const transaction = new Transaction({ feePayer: relayer }).add(
    verificationInstruction,
    programInstruction,
  );
  return {
    chainFamily: "SOLANA",
    operation: input.operation,
    transaction,
    verificationInstruction,
    programInstruction,
    configAddress: config.toBase58(),
    domainRecordAddress: domainRecord.toBase58(),
    receiptAddress: receipt.toBase58(),
    payloadHash: verified.payloadHash,
    attestationDigest: verified.digest,
  };
}

export { MIRROR_ABI };
