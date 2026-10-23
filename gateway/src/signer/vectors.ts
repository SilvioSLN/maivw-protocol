import type { CanonicalTestVector } from "./types.js";

export const CANONICAL_TEST_VECTORS: readonly CanonicalTestVector[] = [
  {
    id: "EVM_PERSONAL_SIGN_V1",
    family: "EVM",
    description: "EIP-191 personal_sign over standard message payload",
    publicKey: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    payload: "MAIVW_CANONICAL_SIGNER_TEST_V1",
    digest: "0x01816ae43d470ae26c3caa5ed45f7ac74d4a52e62af0cd380872a888dbdd9113",
    signature: "0xd453a10c1e9077218621a7470fc0d8ea828ccb61ef82c6b9ef0243b18458c4da070aad93b9cf1301b6b0ed5e0197c2dd122c2fa3ffbca6cc6f557fca18c1c3021c",
  },
  {
    id: "EVM_RAW_DIGEST_V1",
    family: "EVM",
    description: "Raw 32-byte Keccak-256 digest signature",
    publicKey: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    payload: "MAIVW_CANONICAL_SIGNER_TEST_V1",
    digest: "0xea2b1be92713ce6129514f113bdb7ecf770d207a96798e2b522a806cd168cfbb",
    signature: "0xb2a85d0f1a0c21cb344784e904a25ec9ba331788c0093e1e5518b785dcef040e72678661e08d2b138d7e28342456dbb9b31083f4006c69af326dd0d9edc470241c",
  },
  {
    id: "SOLANA_ED25519_V1",
    family: "SOLANA",
    description: "Ed25519 detached signature over canonical byte message",
    publicKey: "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9",
    payload: "MAIVW_SOLANA_CANONICAL_V1",
    digest: "MAIVW_SOLANA_CANONICAL_V1",
    signature: "9qR1r8lpLvRG0lne8fAyxlHWNkg6PhkEkwlOpWWgKBypRg2Af6tus4zQYx6jWKXp7Gfuw2DRDsymfgK8mzmrAg==",
  },
];
