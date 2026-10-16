# Multichain API Schemas and Errors V1

The gateway validates family-specific values before they reach orchestration:

- EVM account identifiers are 20-byte `0x` addresses and transaction
  identifiers are 32-byte `0x` hashes;
- Solana accounts are canonical 32-byte base58 public keys and transaction
  signatures decode to exactly 64 bytes;
- network identifiers are canonical `evm:<chainId>` or
  `solana:<cluster-genesis-hash>` strings;
- family-discriminated account and transaction objects reject fields from the
  other family.

Mirror requests accept at most sixteen unique canonical destination network
IDs. The same schemas are reused by onboarding for EVM addresses/hashes and
Solana network/public-key fields.

Public multichain failures use a stable envelope:

```json
{"success":false,"error":{"code":"ORIGIN_CONFLICT","message":"Origem diverge do catálogo"}}
```

Codes distinguish malformed EVM address/hash, malformed Solana
public-key/signature, missing or conflicting origin, same-version
`STATE_DRIFT`, invalid destination/operation, unavailable dependency and an
opaque internal error. Provider messages and stack traces never cross the API
boundary.
