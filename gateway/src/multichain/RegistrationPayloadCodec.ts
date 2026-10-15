import {
  concatHex,
  keccak256,
  numberToHex,
  size,
  type Hex,
} from "viem";

export const REGISTRATION_PAYLOAD_MAGIC = "0x4d41495657524547" as const; // MAIVWREG
export const REGISTRATION_PAYLOAD_VERSION = 1 as const;
export const REGISTRATION_PAYLOAD_V1_SIZE = 245 as const;

export enum RegistrationKeyAlgorithm {
  SECP256K1 = 1,
  ED25519 = 2,
}

export enum RegistrationProviderTier {
  NONE = 0,
  BASIC = 1,
  TRUSTED = 2,
  INSTITUTIONAL = 3,
}

export interface RegistrationPayloadV1 {
  domainHash: Hex;
  registrant: Hex;
  operationalKeyAlgorithm: RegistrationKeyAlgorithm;
  operationalKey: Hex;
  adminKeyAlgorithm: RegistrationKeyAlgorithm;
  adminKey: Hex;
  endpointHash: Hex;
  tlsFingerprint: Hex;
  isProvider: boolean;
  providerTier: RegistrationProviderTier;
  payment: bigint;
  mint: Hex;
}

const MAX_U64 = (1n << 64n) - 1n;
const ZERO32 = `0x${"0".repeat(64)}`;

function assertBytes32(name: string, value: Hex, allowZero = false): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be exactly 32 bytes`);
  }
  if (!allowZero && value.toLowerCase() === ZERO32) {
    throw new Error(`${name} must not be zero`);
  }
}

function assertAlgorithm(name: string, value: RegistrationKeyAlgorithm): void {
  if (value !== RegistrationKeyAlgorithm.SECP256K1 && value !== RegistrationKeyAlgorithm.ED25519) {
    throw new Error(`${name} is not supported`);
  }
}

function u8(value: number): Hex {
  return numberToHex(value, { size: 1 });
}

function u64(value: bigint): Hex {
  return numberToHex(value, { size: 8 });
}

/** Fixed-width registration payload committed by OriginClaimV1.payloadHash. */
export function encodeRegistrationPayloadV1(input: RegistrationPayloadV1): Hex {
  assertBytes32("domainHash", input.domainHash);
  assertBytes32("registrant", input.registrant);
  assertAlgorithm("operationalKeyAlgorithm", input.operationalKeyAlgorithm);
  assertBytes32("operationalKey", input.operationalKey);
  assertAlgorithm("adminKeyAlgorithm", input.adminKeyAlgorithm);
  assertBytes32("adminKey", input.adminKey);
  assertBytes32("endpointHash", input.endpointHash);
  assertBytes32("tlsFingerprint", input.tlsFingerprint, true);
  assertBytes32("mint", input.mint);
  if (input.payment < 0n || input.payment > MAX_U64) throw new Error("payment must fit uint64");
  if (input.providerTier < RegistrationProviderTier.NONE
    || input.providerTier > RegistrationProviderTier.INSTITUTIONAL) {
    throw new Error("providerTier is invalid");
  }
  if (input.isProvider === (input.providerTier === RegistrationProviderTier.NONE)) {
    throw new Error("provider flag and tier are inconsistent");
  }

  const encoded = concatHex([
    REGISTRATION_PAYLOAD_MAGIC,
    u8(REGISTRATION_PAYLOAD_VERSION),
    input.domainHash,
    input.registrant,
    u8(input.operationalKeyAlgorithm),
    input.operationalKey,
    u8(input.adminKeyAlgorithm),
    input.adminKey,
    input.endpointHash,
    input.tlsFingerprint,
    u8(input.isProvider ? 1 : 0),
    u8(input.providerTier),
    u64(input.payment),
    input.mint,
  ]);
  if (size(encoded) !== REGISTRATION_PAYLOAD_V1_SIZE) {
    throw new Error(`invalid registration payload size: ${size(encoded)}`);
  }
  return encoded;
}

export function hashRegistrationPayloadV1(input: RegistrationPayloadV1): Hex {
  return keccak256(encodeRegistrationPayloadV1(input));
}
