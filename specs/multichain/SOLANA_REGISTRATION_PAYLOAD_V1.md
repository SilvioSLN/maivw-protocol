# MAIVW Solana Registration Payload V1

`OriginClaimV1.payloadHash` for `register_domain` and `register_provider` is
`keccak256(payload)`, where `payload` is the fixed 245-byte sequence below.
No Borsh length prefixes or JSON encoding are used.

| Offset | Size | Field | Encoding |
|---:|---:|---|---|
| 0 | 8 | magic | ASCII `MAIVWREG` |
| 8 | 1 | version | `0x01` |
| 9 | 32 | domain hash | `keccak256(canonicalDomainUtf8)` |
| 41 | 32 | registrant | Solana pubkey bytes |
| 73 | 1 | operational key algorithm | `0x02`, Ed25519 Solana pubkey |
| 74 | 32 | operational key | raw pubkey bytes |
| 106 | 1 | admin key algorithm | `0x02`, Ed25519 Solana pubkey |
| 107 | 32 | admin key | raw pubkey bytes |
| 139 | 32 | endpoint hash | `keccak256(endpointUtf8)` |
| 171 | 32 | TLS fingerprint | raw SHA-256 bytes; zero means not configured |
| 203 | 1 | provider flag | `0x00` domain, `0x01` provider |
| 204 | 1 | provider tier | `0x00` none, `0x01` basic, `0x02` trusted, `0x03` institutional |
| 205 | 8 | payment | unsigned 64-bit, big-endian, minimum token units |
| 213 | 32 | mint | configured SPL Token mint pubkey bytes |

The signed 292-byte attestation independently binds `nonce`, `deadline`, DNS
evidence, destination network and program id. The registration instruction
requires its `claim_nonce` argument to equal the signed nonce and initializes
`OriginClaimReceipt` at:

```text
PDA("origin-claim", domainHash, nonce)
```

Replaying the same authorization therefore tries to initialize the same PDA and
fails. A future reclaim can consume a new authorization without overwriting the
append-only receipt of an earlier claim.

For a standard domain, `payment` is `RegistryConfig.standardFee`. For a provider,
it is the selected tier's `requiredStake`; the `providerFee` fallback is not used
by `register_provider`.
