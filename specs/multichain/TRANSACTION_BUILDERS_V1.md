# MAIVW Mirror Transaction Builders V1

The Gateway builds unsigned destination transactions only from a
`CanonicalDomainState` reread at a finalized block or slot. Before any bytes
are returned, both builders verify the complete binding between state,
`StateAttestationV1`, destination and the recoverable secp256k1 oracle
signature.

The shared `MirrorStateV2` codec is byte-compatible with Solidity
`abi.encode` and the Solana Rust implementation. It commits typed keys,
endpoint hash, TLS fingerprint, status, provider fields, strikes,
registration time, stake and daily limit. The maintained normative vector is
`0x309ab981466d054d4a864fe3ce46e60fb25ed3dc4f79e419e50ba63d0f58332b`.

## Validation boundary

The builders reject a request unless all of the following hold:

- the source is a canonical finalized `ORIGIN`, never a mirror relay loop;
- operation and state agree (`register`/`sync` are non-revoked, `revoke` is revoked);
- domain, immutable origin, epoch, sequence, nonce, payload and evidence match;
- destination network and registry are exact and distinct from the origin;
- the deadline is current and the nonce/evidence are non-zero;
- signature recovery matches the signer configured at the destination.

No private key, KMS client, RPC call, nonce manager or submit side effect is
inside a builder. Submission and retry state belong to later relay tasks.

## EVM destination

The EVM builder emits `to`, zero `value` and ABI calldata for exactly one of
`registerMirrorV2`, `syncMirrorV2` or `revokeMirrorV2`. Typed key descriptors
are preserved; a Solana public key is never cast to an EVM address.

## Solana destination

The Solana builder returns an unsigned transaction with exactly two ordered
instructions:

1. native secp256k1 verification over the complete 292-byte envelope;
2. `register_mirror`, `sync_mirror` or `revoke_mirror` with canonical Anchor
   Borsh arguments and the same envelope.

The second instruction uses the registry-config, domain and nonce-receipt
PDAs and the real instructions sysvar. The program checks that the immediately
preceding precompile instruction contains one local signature, the configured
20-byte `attestation_signer`, and the exact envelope. Because the native
precompile applies Keccak-256 to its message, this verifies the same digest as
EVM and the Gateway KMS.

`RegistryConfig` schema V2 therefore separates the Solana `oracle_key`
(transaction authority for warnings/slashing/batches) from the secp256k1
`attestation_signer` (cross-chain KMS identity). This avoids both key-type
conversion and an authority regression.
