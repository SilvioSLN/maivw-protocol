import {
  keccak256,
  padHex,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

const DOMAIN_RECORD_DISCRIMINATOR = Buffer.from([130, 61, 36, 125, 56, 48, 189, 247]);
const ZERO32 = `0x${"0".repeat(64)}` as Hex;

export type CanonicalNetworkFamily = "EVM" | "SOLANA";
export type CanonicalRecordKind = "ORIGIN" | "MIRROR";
export type CanonicalDomainStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

export interface CanonicalKeyDescriptor {
  algorithm: number;
  value: Hex;
}

export interface CanonicalDomainState {
  domain: string;
  domainHash: Hex;
  recordKind: CanonicalRecordKind;
  originFamily: CanonicalNetworkFamily;
  originNetworkHash: Hex;
  originRegistry: Hex;
  operationalKey: CanonicalKeyDescriptor;
  adminKey: CanonicalKeyDescriptor;
  endpoint: string;
  tlsFingerprint: Hex;
  status: CanonicalDomainStatus;
  globalDomainEpoch: bigint;
  originSequence: bigint;
  isProvider: boolean;
  providerTier: number;
  strikes: number;
  registrationTime: bigint;
  updatedAt: bigint;
  attestedStake: bigint;
  attestedDailyLimit: bigint;
  originTransactionFamily: CanonicalNetworkFamily;
  originTransaction: Hex;
  schemaVersion: number;
}

export class FinalizedStateError extends Error {
  constructor(
    readonly code: "FINALIZED_REFERENCE_MISMATCH" | "FINALIZED_STATE_INVALID" | "FINALIZED_STATE_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "FinalizedStateError";
  }
}

function stateFail(code: FinalizedStateError["code"], message: string): never {
  throw new FinalizedStateError(code, message);
}

function canonicalDomain(domain: string): string {
  const value = domain.trim().toLowerCase();
  if (!value || value !== domain || value.length > 253 || value.includes(" ")) {
    stateFail("FINALIZED_STATE_INVALID", "domínio não canônico");
  }
  return value;
}

function domainHash(domain: string): Hex {
  return keccak256(stringToHex(canonicalDomain(domain)));
}

function statusFromEvm(value: number): CanonicalDomainStatus {
  if (value === 1) return "ACTIVE";
  if (value === 2) return "SUSPENDED";
  if (value === 3 || value === 4) return "REVOKED";
  stateFail("FINALIZED_STATE_NOT_FOUND", "domínio EVM não registrado");
}

const EVM_STATE_ABI = [
  {
    name: "getCompanyProfile", type: "function", stateMutability: "view",
    inputs: [{ name: "domain", type: "string" }],
    outputs: [{ name: "profile", type: "tuple", components: [
      { name: "domain", type: "string" }, { name: "endpointUrl", type: "string" },
      { name: "publicKey", type: "address" }, { name: "adminKey", type: "address" },
      { name: "registrationTime", type: "uint64" }, { name: "strikeCount", type: "uint32" },
      { name: "epoch", type: "uint32" }, { name: "isProvider", type: "bool" },
      { name: "status", type: "uint8" },
    ] }],
  },
  { name: "getDomainTlsFingerprint", type: "function", stateMutability: "view", inputs: [{ name: "domain", type: "string" }], outputs: [{ type: "bytes32" }] },
  { name: "getProviderInfo", type: "function", stateMutability: "view", inputs: [{ name: "domain", type: "string" }], outputs: [
    { name: "isProvider", type: "bool" }, { name: "tier", type: "uint8" },
    { name: "dailyLimit", type: "uint256" }, { name: "stakeBalance", type: "uint256" },
    { name: "strikeCount", type: "uint32" }, { name: "isSuspended", type: "bool" },
  ] },
] as const;

export interface EvmFinalizedCheckpoint {
  domain: string;
  domainHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  globalDomainEpoch: bigint;
  originSequence: bigint;
}

export interface EvmStateReaderClient {
  getBlock(input: { blockNumber: bigint }): Promise<{ number: bigint | null; hash: Hex | null }>;
  readContract(input: {
    address: Address;
    abi: typeof EVM_STATE_ABI;
    functionName: string;
    args: readonly unknown[];
    blockNumber: bigint;
  }): Promise<unknown>;
}

export interface EvmFinalizedStateReaderConfig {
  networkHash: Hex;
  registryAddress: Address;
  registryId: Hex;
  schemaVersion: number;
}

export class EvmFinalizedStateReader {
  constructor(
    private readonly client: EvmStateReaderClient,
    private readonly config: EvmFinalizedStateReaderConfig,
  ) {}

  async read(checkpoint: EvmFinalizedCheckpoint): Promise<CanonicalDomainState> {
    const expectedHash = domainHash(checkpoint.domain);
    if (expectedHash.toLowerCase() !== checkpoint.domainHash.toLowerCase()) {
      stateFail("FINALIZED_REFERENCE_MISMATCH", "domainHash do checkpoint não corresponde ao domínio");
    }
    const block = await this.client.getBlock({ blockNumber: checkpoint.blockNumber });
    if (block.number !== checkpoint.blockNumber || block.hash?.toLowerCase() !== checkpoint.blockHash.toLowerCase()) {
      stateFail("FINALIZED_REFERENCE_MISMATCH", "hash do bloco EVM finalizado divergiu");
    }
    const read = (functionName: string, args: readonly unknown[]) => this.client.readContract({
      address: this.config.registryAddress,
      abi: EVM_STATE_ABI,
      functionName,
      args,
      blockNumber: checkpoint.blockNumber,
    });
    if (this.config.registryId.toLowerCase() !== padHex(this.config.registryAddress, { size: 32 }).toLowerCase()) {
      stateFail("FINALIZED_STATE_INVALID", "registryId EVM não corresponde ao contrato");
    }
    const [rawProfile, tls, rawProviderInfo] = await Promise.all([
      read("getCompanyProfile", [checkpoint.domain]),
      read("getDomainTlsFingerprint", [checkpoint.domain]),
      read("getProviderInfo", [checkpoint.domain]),
    ]);
    const profile = rawProfile as {
      domain: string; endpointUrl: string; publicKey: Address; adminKey: Address;
      registrationTime: bigint; strikeCount: number; epoch: number; isProvider: boolean; status: number;
    };
    if (profile.domain !== checkpoint.domain || BigInt(profile.epoch) !== checkpoint.globalDomainEpoch) {
      stateFail("FINALIZED_REFERENCE_MISMATCH", "perfil EVM não corresponde ao evento finalizado");
    }
    const providerInfo = rawProviderInfo as readonly [boolean, number, bigint, bigint, number, boolean];
    if (providerInfo[0] !== profile.isProvider || providerInfo[4] !== profile.strikeCount) {
      stateFail("FINALIZED_REFERENCE_MISMATCH", "visões EVM do provider são inconsistentes");
    }
    return validateCanonicalState({
      domain: checkpoint.domain,
      domainHash: expectedHash,
      recordKind: "ORIGIN",
      originFamily: "EVM",
      originNetworkHash: this.config.networkHash,
      originRegistry: this.config.registryId,
      operationalKey: { algorithm: 1, value: padHex(profile.publicKey, { size: 32 }) },
      adminKey: { algorithm: 1, value: padHex(profile.adminKey, { size: 32 }) },
      endpoint: profile.endpointUrl,
      tlsFingerprint: tls as Hex,
      status: statusFromEvm(profile.status),
      globalDomainEpoch: checkpoint.globalDomainEpoch,
      originSequence: checkpoint.originSequence,
      isProvider: profile.isProvider,
      providerTier: profile.isProvider ? Number(providerInfo[1]) : 0,
      strikes: profile.strikeCount,
      registrationTime: profile.registrationTime,
      updatedAt: 0n,
      attestedStake: providerInfo[3],
      attestedDailyLimit: profile.isProvider ? providerInfo[2] : 0n,
      originTransactionFamily: "EVM",
      originTransaction: checkpoint.transactionHash,
      schemaVersion: this.config.schemaVersion,
    });
  }
}

export interface SolanaFinalizedCheckpoint {
  domain: string;
  domainHash: Hex;
  slot: bigint;
  signature: string;
  globalDomainEpoch: bigint;
  originSequence: bigint;
}

export interface SolanaAccountInfo {
  contextSlot: bigint;
  owner: string;
  data: Uint8Array;
}

export interface SolanaStateReaderClient {
  deriveDomainRecordAddress(domainHash: Hex, programId: string): Promise<string> | string;
  getAccountInfo(input: {
    address: string;
    commitment: "finalized";
    minContextSlot: bigint;
  }): Promise<SolanaAccountInfo | null>;
}

export class SolanaFinalizedStateReader {
  constructor(
    private readonly client: SolanaStateReaderClient,
    private readonly programId: string,
  ) {}

  async read(checkpoint: SolanaFinalizedCheckpoint): Promise<CanonicalDomainState> {
    const expectedHash = domainHash(checkpoint.domain);
    if (expectedHash.toLowerCase() !== checkpoint.domainHash.toLowerCase()) {
      stateFail("FINALIZED_REFERENCE_MISMATCH", "domainHash do checkpoint não corresponde ao domínio");
    }
    const address = await this.client.deriveDomainRecordAddress(expectedHash, this.programId);
    const account = await this.client.getAccountInfo({
      address,
      commitment: "finalized",
      minContextSlot: checkpoint.slot,
    });
    if (!account) stateFail("FINALIZED_STATE_NOT_FOUND", "DomainRecord Solana não encontrado");
    if (account.owner !== this.programId || account.contextSlot < checkpoint.slot) {
      stateFail("FINALIZED_REFERENCE_MISMATCH", "owner ou slot da conta Solana divergiu");
    }
    const state = decodeSolanaDomainRecord(account.data);
    if (state.domain !== checkpoint.domain
      || state.domainHash.toLowerCase() !== checkpoint.domainHash.toLowerCase()
      || state.globalDomainEpoch !== checkpoint.globalDomainEpoch
      || state.originSequence !== checkpoint.originSequence) {
      stateFail("FINALIZED_REFERENCE_MISMATCH", "DomainRecord diverge do evento finalizado");
    }
    return validateCanonicalState(state);
  }
}

class BorshCursor {
  offset = 0;
  constructor(readonly data: Buffer) {}
  take(length: number): Buffer {
    if (length < 0 || this.offset + length > this.data.length) stateFail("FINALIZED_STATE_INVALID", "conta Solana truncada");
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  u8() { return this.take(1)[0]; }
  u16() { return this.take(2).readUInt16LE(); }
  u32() { return this.take(4).readUInt32LE(); }
  u64() { return this.take(8).readBigUInt64LE(); }
  i64() { return this.take(8).readBigInt64LE(); }
  bytes32() { return `0x${this.take(32).toString("hex")}` as Hex; }
  string() {
    const length = this.u32();
    if (length > 512) stateFail("FINALIZED_STATE_INVALID", "string Solana excede o limite");
    return this.take(length).toString("utf8");
  }
}

export function decodeSolanaDomainRecord(input: Uint8Array): CanonicalDomainState {
  const cursor = new BorshCursor(Buffer.from(input));
  if (!cursor.take(8).equals(DOMAIN_RECORD_DISCRIMINATOR)) {
    stateFail("FINALIZED_STATE_INVALID", "discriminador DomainRecord inválido");
  }
  const schemaVersion = cursor.u16();
  cursor.u8(); // bump
  const kind = cursor.u8();
  const storedDomainHash = cursor.bytes32();
  const domain = cursor.string();
  const originFamily = cursor.u8();
  const originNetworkHash = cursor.bytes32();
  const originRegistry = cursor.bytes32();
  const operationalKey = { algorithm: cursor.u8(), value: cursor.bytes32() };
  const adminKey = { algorithm: cursor.u8(), value: cursor.bytes32() };
  const endpoint = cursor.string();
  const tlsFingerprint = cursor.bytes32();
  const status = cursor.u8();
  const globalDomainEpoch = cursor.u64();
  const originSequence = cursor.u64();
  const provider = cursor.bytes32();
  const providerTier = cursor.u8();
  const strikes = cursor.u32();
  const registrationTime = cursor.i64();
  const updatedAt = cursor.i64();
  const attestedStake = cursor.u64();
  const attestedDailyLimit = cursor.u64();
  cursor.u64(); // originalRegistrationAmount
  cursor.u64(); // currentStake
  const transactionFamily = cursor.u8();
  const originTransaction = cursor.bytes32();
  cursor.u64(); // lastMigratedSlot
  const reserved = cursor.take(32);
  if (schemaVersion !== 2 || cursor.offset !== cursor.data.length || reserved.some((value) => value !== 0)
    || storedDomainHash.toLowerCase() !== domainHash(domain).toLowerCase()) {
    stateFail("FINALIZED_STATE_INVALID", "layout ou hash do DomainRecord inválido");
  }
  const statusValue: CanonicalDomainStatus = status === 0 ? "ACTIVE" : status === 1 ? "SUSPENDED" : status === 2
    ? "REVOKED" : stateFail("FINALIZED_STATE_INVALID", "status Solana inválido");
  return {
    domain,
    domainHash: storedDomainHash,
    recordKind: kind === 0 ? "ORIGIN" : kind === 1 ? "MIRROR" : stateFail("FINALIZED_STATE_INVALID", "kind inválido"),
    originFamily: originFamily === 0 ? "EVM" : originFamily === 1 ? "SOLANA" : stateFail("FINALIZED_STATE_INVALID", "família inválida"),
    originNetworkHash,
    originRegistry,
    operationalKey,
    adminKey,
    endpoint,
    tlsFingerprint,
    status: statusValue,
    globalDomainEpoch,
    originSequence,
    isProvider: providerTier !== 0 || provider !== ZERO32,
    providerTier,
    strikes,
    registrationTime,
    updatedAt,
    attestedStake,
    attestedDailyLimit,
    originTransactionFamily: transactionFamily === 0 ? "EVM" : transactionFamily === 1
      ? "SOLANA" : stateFail("FINALIZED_STATE_INVALID", "família da transação inválida"),
    originTransaction,
    schemaVersion,
  };
}

function validateCanonicalState(state: CanonicalDomainState): CanonicalDomainState {
  const bytes32 = /^0x[0-9a-fA-F]{64}$/;
  if (!bytes32.test(state.domainHash) || !bytes32.test(state.originNetworkHash)
    || !bytes32.test(state.originRegistry) || !bytes32.test(state.operationalKey.value)
    || !bytes32.test(state.adminKey.value) || !bytes32.test(state.tlsFingerprint)
    || !bytes32.test(state.originTransaction) || !state.endpoint
    || state.operationalKey.algorithm < 1 || state.operationalKey.algorithm > 3
    || state.adminKey.algorithm < 1 || state.adminKey.algorithm > 3
    || state.globalDomainEpoch < 0n || state.originSequence < 0n
    || state.registrationTime < 0n || state.attestedStake < 0n || state.attestedDailyLimit < 0n
    || state.providerTier < 0 || state.providerTier > 3
    || state.isProvider === (state.providerTier === 0)) {
    stateFail("FINALIZED_STATE_INVALID", "estado canônico contém campos inválidos");
  }
  return state;
}
