import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
  type Hex,
} from "viem";
import type { CanonicalDomainState } from "./FinalizedStateReader.js";

export const MIRROR_STATE_V2_TYPE =
  "MirrorStateV2(uint8 publicKeyAlgorithm,bytes32 publicKeyData,uint8 adminKeyAlgorithm,bytes32 adminKeyData,bytes32 endpointHash,bytes32 tlsFingerprint,uint8 status,bool isProvider,uint8 tier,uint32 strikeCount,uint64 registrationTime,uint256 attestedStake,uint256 dailyLimit)";

const PAYLOAD_PARAMETERS = parseAbiParameters(
  "bytes32,uint8,bytes32,uint8,bytes32,bytes32,bytes32,uint8,bool,uint8,uint32,uint64,uint256,uint256",
);
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const MAX_U32 = 0xffff_ffff;
const MAX_U64 = (1n << 64n) - 1n;
const MAX_U256 = (1n << 256n) - 1n;

function payloadStatus(status: CanonicalDomainState["status"]): number {
  if (status === "ACTIVE") return 1;
  if (status === "SUSPENDED") return 2;
  return 3;
}

/** Validates the destination-independent state committed by MirrorStateV2. */
export function assertMirrorStateV2(state: CanonicalDomainState): void {
  if (!state.endpoint || new TextEncoder().encode(state.endpoint).length > 512) {
    throw new Error("mirror endpoint must contain 1..512 UTF-8 bytes");
  }
  for (const [name, value] of [
    ["domainHash", state.domainHash],
    ["operationalKey", state.operationalKey.value],
    ["adminKey", state.adminKey.value],
    ["tlsFingerprint", state.tlsFingerprint],
  ] as const) {
    if (!BYTES32.test(value)) throw new Error(`${name} must be exactly 32 bytes`);
  }
  if (state.operationalKey.algorithm < 1 || state.operationalKey.algorithm > 3
    || state.adminKey.algorithm < 1 || state.adminKey.algorithm > 3) {
    throw new Error("mirror key algorithm is invalid");
  }
  if (!Number.isInteger(state.providerTier) || state.providerTier < 0 || state.providerTier > 3
    || !Number.isInteger(state.strikes) || state.strikes < 0 || state.strikes > MAX_U32) {
    throw new Error("mirror tier or strike count is invalid");
  }
  if (state.isProvider
    ? state.providerTier === 0 || state.attestedDailyLimit === 0n
    : state.providerTier !== 0 || state.attestedDailyLimit !== 0n) {
    throw new Error("mirror provider economics are inconsistent");
  }
  if (state.registrationTime < 0n || state.registrationTime > MAX_U64
    || state.attestedStake < 0n || state.attestedStake > MAX_U256
    || state.attestedDailyLimit < 0n || state.attestedDailyLimit > MAX_U256) {
    throw new Error("mirror numeric field is out of range");
  }
}

/** Exact counterpart of Solidity/Rust hashMirrorStateV2. */
export function hashMirrorStateV2(state: CanonicalDomainState): Hex {
  assertMirrorStateV2(state);
  return keccak256(encodeAbiParameters(PAYLOAD_PARAMETERS, [
    keccak256(stringToHex(MIRROR_STATE_V2_TYPE)),
    state.operationalKey.algorithm,
    state.operationalKey.value,
    state.adminKey.algorithm,
    state.adminKey.value,
    keccak256(stringToHex(state.endpoint)),
    state.tlsFingerprint,
    payloadStatus(state.status),
    state.isProvider,
    state.providerTier,
    state.strikes,
    state.registrationTime,
    state.attestedStake,
    state.attestedDailyLimit,
  ]));
}
