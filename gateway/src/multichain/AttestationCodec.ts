import {
  concatHex,
  keccak256,
  numberToHex,
  padHex,
  size,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

export const ATTESTATION_MAGIC = "0x4d41495657415454" as const; // "MAIVWATT"
export const ATTESTATION_VERSION = 1 as const;
export const ATTESTATION_V1_SIZE = 292 as const;

export enum AttestationKind {
  ORIGIN_CLAIM = 1,
  STATE_ATTESTATION = 2,
}

export enum AttestationAction {
  REGISTER_ORIGIN = 1,
  REGISTER_MIRROR = 2,
  SYNC_MIRROR = 3,
  REVOKE_MIRROR = 4,
}

export interface AttestationV1 {
  kind: AttestationKind;
  action: AttestationAction;
  domainHash: Hex;
  originNetworkHash: Hex;
  originRegistry: Hex;
  destinationNetworkHash: Hex;
  destinationRegistry: Hex;
  globalDomainEpoch: bigint;
  originSequence: bigint;
  nonce: Hex;
  deadline: bigint;
  payloadHash: Hex;
  evidenceHash: Hex;
}

const MAX_U64 = (1n << 64n) - 1n;
const NETWORK_ID_PATTERN = /^(evm:[1-9][0-9]*|solana:[1-9A-HJ-NP-Za-km-z]+)$/;

function assertBytes32(name: string, value: Hex): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be exactly 32 bytes`);
  }
}

function assertU64(name: string, value: bigint): void {
  if (value < 0n || value > MAX_U64) {
    throw new Error(`${name} must fit an unsigned 64-bit integer`);
  }
}

function u8(value: number): Hex {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("u8 value out of range");
  }
  return numberToHex(value, { size: 1 });
}

function u64(value: bigint): Hex {
  return numberToHex(value, { size: 8 });
}

/**
 * Produces the fixed-width V1 envelope shared by TypeScript, Rust and Solidity.
 * Integer fields use unsigned big-endian encoding. Dynamic data is committed
 * through payloadHash/evidenceHash and never concatenated directly.
 */
export function encodeAttestationV1(input: AttestationV1): Hex {
  assertBytes32("domainHash", input.domainHash);
  assertBytes32("originNetworkHash", input.originNetworkHash);
  assertBytes32("originRegistry", input.originRegistry);
  assertBytes32("destinationNetworkHash", input.destinationNetworkHash);
  assertBytes32("destinationRegistry", input.destinationRegistry);
  assertBytes32("nonce", input.nonce);
  assertBytes32("payloadHash", input.payloadHash);
  assertBytes32("evidenceHash", input.evidenceHash);
  assertU64("globalDomainEpoch", input.globalDomainEpoch);
  assertU64("originSequence", input.originSequence);
  assertU64("deadline", input.deadline);

  const encoded = concatHex([
    ATTESTATION_MAGIC,
    u8(ATTESTATION_VERSION),
    u8(input.kind),
    u8(input.action),
    u8(0), // reserved; must remain zero in V1
    input.domainHash,
    input.originNetworkHash,
    input.originRegistry,
    input.destinationNetworkHash,
    input.destinationRegistry,
    u64(input.globalDomainEpoch),
    u64(input.originSequence),
    input.nonce,
    u64(input.deadline),
    input.payloadHash,
    input.evidenceHash,
  ]);

  if (size(encoded) !== ATTESTATION_V1_SIZE) {
    throw new Error(`invalid V1 envelope size: ${size(encoded)}`);
  }
  return encoded;
}

export function hashAttestationV1(input: AttestationV1): Hex {
  return keccak256(encodeAttestationV1(input));
}

export function hashNetworkId(networkId: string): Hex {
  if (!NETWORK_ID_PATTERN.test(networkId)) {
    throw new Error(`invalid canonical network id: ${networkId}`);
  }
  return keccak256(stringToHex(networkId));
}

export function evmAddressToRegistryBytes(address: Address): Hex {
  return padHex(address, { size: 32 });
}

export function assertSolanaRegistryBytes(value: Hex): Hex {
  assertBytes32("solanaRegistry", value);
  return value;
}

