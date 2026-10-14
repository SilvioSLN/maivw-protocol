# MAIVW Multichain Attestations V1

This directory is the language-neutral source for the bytes signed by the MAIVW oracle and verified by EVM/Solana registries.

## Envelope

All integers are unsigned big-endian. All hash and registry fields are exactly 32 bytes. Total encoded size is 292 bytes.

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 8 | ASCII magic `MAIVWATT` |
| 8 | 1 | version (`1`) |
| 9 | 1 | kind (`1` origin claim, `2` state attestation) |
| 10 | 1 | action (`1` register origin, `2` register mirror, `3` sync, `4` revoke, `5` recover origin, `6` reclaim origin) |
| 11 | 1 | reserved, must be zero |
| 12 | 32 | domain hash |
| 44 | 32 | origin network hash |
| 76 | 32 | origin registry, normalized to 32 bytes |
| 108 | 32 | destination network hash |
| 140 | 32 | destination registry, normalized to 32 bytes |
| 172 | 8 | global domain epoch |
| 180 | 8 | origin sequence |
| 188 | 32 | nonce |
| 220 | 8 | deadline, Unix seconds |
| 228 | 32 | payload hash |
| 260 | 32 | evidence hash |

The signed digest is `keccak256(envelope)`. Dynamic state and evidence never appear directly in the envelope; their canonical serializers are committed through the final two hashes.

Network identifiers use canonical strings such as `evm:8453` or `solana:<cluster-genesis-hash>`. Their encoded field is `keccak256(utf8(networkId))`.

EVM registry addresses are left-padded with twelve zero bytes. Solana program IDs use their raw 32 decoded bytes. Conversion of domain keys between secp256k1 and Ed25519 is forbidden.

The JSON files under `fixtures/` are normative test vectors. Implementations must reproduce both `encoded` and `digest` exactly. The maintained implementations are:

- TypeScript: `gateway/src/multichain/AttestationCodec.ts`
- Solidity: `contracts/src/libraries/MAIVWAttestationV1.sol`
- Rust: `solana/crates/maivw-attestation/src/lib.rs`

`fixtures/full-lifecycle-v1.json` is the normative transition suite. It covers origin registration and update, provider warning/slash, recovery, reclaim, Solana-origin mirroring into EVM, synchronization and tombstone revocation. Numeric economic values are expressed as decimal strings in the smallest unit of the origin asset; `attestedStake` is informational at a mirror and `spendableLocalStake` must remain zero.

The EVM projection contract, ordering rules, typed-key behavior and legacy migration are specified in `EVM_MIRROR_REGISTRY_V2.md`. Solana mirror registration and its EVM-compatible state hash are specified in `SOLANA_MIRROR_STATE_V2.md`.

Solana pause authority and the operations that remain available during an incident are specified in `SOLANA_GOVERNANCE_V1.md`.

Solana account schema compatibility and the explicit `DomainRecord` V1 to V2 migration are specified in `SOLANA_ACCOUNT_MIGRATIONS_V1.md`.
