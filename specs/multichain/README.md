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

`fixtures/origin-claim-v1.json` is the normative Solana registration payload plus its complete `OriginClaimV1` envelope. `fixtures/full-lifecycle-v1.json` is the normative transition suite. It covers origin registration and update, provider warning/slash, recovery, reclaim, Solana-origin mirroring into EVM, synchronization and tombstone revocation. Numeric economic values are expressed as decimal strings in the smallest unit of the origin asset; `attestedStake` is informational at a mirror and `spendableLocalStake` must remain zero.

The EVM projection contract, ordering rules, typed-key behavior and legacy migration are specified in `EVM_MIRROR_REGISTRY_V2.md`. Solana mirror registration and its EVM-compatible state hash are specified in `SOLANA_MIRROR_STATE_V2.md`.
The isolated KMS/local signing boundary for both claim kinds is specified in `ATTESTATION_SIGNER_V1.md`.
The durable finalized-block scanner for Base, Arbitrum and Polygon is specified in `EVM_OBSERVER_V1.md`.
The finalized slot/signature scanner and deterministic Anchor event decoder are specified in `SOLANA_OBSERVER_V1.md`.
The block/slot-pinned canonical state readers are specified in `FINALIZED_STATE_READERS_V1.md`.
The unsigned EVM/Solana mirror builders, shared payload hash and cryptographic checks are specified in `TRANSACTION_BUILDERS_V1.md`.
The durable origin-to-N-destinations relay state machine is specified in `RELAY_JOB_STATE_MACHINE_V1.md`.
Idempotent signed-transaction submission, leases, retry and finality are specified in `RELAY_SUBMISSION_RETRY_V1.md`.
Bidirectional origin fan-out and per-destination failure isolation are specified in `RELAY_FANOUT_V1.md`.
N×N drift classification, repair plans and reconciliation audit hashes are specified in `RECONCILIATION_NXN_V1.md`.
Logical orphan handling, terminal relay states and per-destination compensation are specified in `REORG_COMPENSATION_V1.md`.
Persistent safety scopes, automatic trip conditions and audited manual reset are specified in `RELAY_CIRCUIT_BREAKER_V1.md`.
The typed chain-agnostic deployment, explorer, asset and finality model is specified in `NETWORK_MODEL_V1.md`.
The common Ledger facade and its family adapter boundary are specified in `LEDGER_ADAPTERS_V1.md`.
Finalized Solana PDA reads and origin/mirror/provider projection are specified in `SOLANA_LEDGER_ADAPTER_V1.md`.
DNS-bound Solana origin selection, OriginClaim issuance and registration transaction drafts are specified in `SOLANA_ORIGIN_ONBOARDING_V1.md`.
The deployment-backed public network catalog and isolated adapter health semantics are specified in `MULTICHAIN_NETWORKS_API_V1.md`.
Catalog-backed origin resolution and per-deployment domain projections are specified in `MULTICHAIN_STATUS_API_V1.md`.
Authenticated origin-to-N mirror job creation is specified in `MIRROR_JOB_API_V1.md`.
Family-specific API schemas and stable public error codes are specified in `MULTICHAIN_API_SCHEMA_V1.md`.
Fail-fast deployment, signer, RPC/WS and operational limit configuration is specified in `GATEWAY_MULTICHAIN_CONFIG_V1.md`.

Solana pause authority and the operations that remain available during an incident are specified in `SOLANA_GOVERNANCE_V1.md`.

Solana account schema compatibility and the explicit `DomainRecord` V1 to V2 migration are specified in `SOLANA_ACCOUNT_MIGRATIONS_V1.md`.

The canonical Solana observer event, action coverage and IDL contract are specified in `SOLANA_EVENTS_V1.md`.

The Solana owner, signer, PDA, SPL, sysvar and account-alias constraints are specified in `SOLANA_ACCOUNT_CONSTRAINTS_V1.md`.

The transactional single-origin constraint, monotonic reconciliation and tamper-evident audit/outbox chain are specified in `ORIGIN_CATALOG_V1.md`.

The DNS-bound origin selection, expiring atomic reservation and idempotent `OriginClaimV1` issuance are specified in `ORIGIN_RESERVATION_V1.md`.
