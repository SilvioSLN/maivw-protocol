# Solana Registry Events V1

This document defines the observer contract for the MAIVW Solana Registry. The
IDL at `solana/idls/maivw_registry.json` is the machine-readable source for all
instructions, accounts, errors and events.

## Canonical domain event

Every successful instruction that creates or mutates a `DomainRecord` emits one
`DomainStateChanged` after the final invariant check. Operation-specific events
may be emitted as well, but indexers use this canonical event to order and
project state.

The event always contains:

- `action` and `recordKind`, explicitly distinguishing `Origin` and `Mirror`;
- `domainHash`;
- the immutable origin reference: family, network hash and registry;
- `globalDomainEpoch` and `originSequence`;
- current status and schema version;
- origin transaction reference, actor and timestamp.

Ordering is lexicographic by `(globalDomainEpoch, originSequence)`. Indexers
must also persist Solana `(slot, transaction signature, instruction index, log
index)` as the delivery cursor. Repeated delivery of the same cursor is a no-op.

## Action coverage

| Action | Mutating instruction(s) |
| --- | --- |
| `Registered` | `register_domain`, `register_provider`, `register_mirror` |
| `MirrorSynchronized` | `sync_mirror` |
| `MirrorRevoked` | `revoke_mirror` |
| `Reclaimed` | `reclaim_domain` |
| `IntentBatchRegistered` | `register_intent_batch` |
| `StakeToppedUp` | `top_up_stake` |
| `WarningIssued` | `issue_warning` |
| `SlashExecuted` | `execute_slash` |
| `MailKeyUpdated` | `update_mail_key` |
| `EndpointUpdated` | `update_endpoint` |
| `TlsFingerprintUpdated` | `update_tls_fingerprint` |
| `AdminUpdated` | `accept_domain_admin` |
| `RecoveryExecuted` | `execute_recovery` |
| `Migrated` | `migrate_domain_record_v1_to_v2` |

Instructions that only create or update auxiliary process accounts keep their
operation-specific events but do not emit `DomainStateChanged`, because the
canonical domain bytes and version did not change. This includes slash proposal
or veto, reporter claim, admin proposal and recovery request or cancellation.

## Registry lifecycle

`RegistryInitialized` commits the deployment network, program id, authority,
guardian, oracle key, mint, schema version and timestamp. `RegistryPaused` and
`RegistryUnpaused` identify the governance signer and transition time.

## Mirror details

`MirrorRegistered`, `MirrorSynchronized` and `MirrorRevoked` remain the detailed
relayer events. They carry attestation nonce and evidence transaction; sync and
revoke also carry the previous epoch/sequence. A consumer can therefore audit
the attestation while using `DomainStateChanged` for the uniform state stream.
