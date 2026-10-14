# Solana Account Migrations V1

This document defines the account-layout upgrade policy for the MAIVW Solana
Registry. A program upgrade must never reinterpret incompatible persisted bytes
as a new schema.

## Version policy

- Every persisted account starts with a `u16 schemaVersion` after its Anchor
  discriminator.
- Handlers accept only the schema version compiled into the program.
- Adding, removing, reordering or changing the type of a serialized field is an
  incompatible change and requires a named migration instruction.
- A migration supports exactly one directed edge (`Vn -> Vn+1`). It must reject
  replay, version skips, unknown layouts, wrong owners, wrong discriminators and
  non-canonical PDAs.
- Compatible semantic changes that do not alter persisted bytes do not bump the
  account schema.

## DomainRecord V1 to V2

`migrate_domain_record_v1_to_v2(domainHash)` is the first explicit migration.
It is authorized only by `RegistryConfig.authority` and remains available while
the Registry is paused so an incident or deployment upgrade cannot deadlock the
state repair.

The instruction:

1. verifies the program-owned canonical `['domain', domainHash]` PDA;
2. requires the `DomainRecord` discriminator and the exact V1 account size;
3. decodes the immutable V1 layout and requires `schemaVersion == 1`;
4. preserves every canonical domain, origin/mirror, version and economic field;
5. funds the new rent minimum from the authority, expands the account and writes
   schema V2 atomically;
6. initializes `lastMigratedSlot` and a zeroed 32-byte reserved region;
7. validates the complete V2 record and emits `DomainRecordMigrated`.

New records are born at schema V2 with `lastMigratedSlot = 0`. Existing V1
records are rejected by normal typed handlers until explicitly migrated. The
reserved bytes must remain zero; consuming them in a future compatible revision
requires a separate specification even if account size does not change.

## Indexer requirements

Indexers must read the discriminator and schema before decoding an account.
`DomainRecordMigrated` carries record kind, origin family/network/registry,
epoch, sequence and origin transaction so an observer can preserve ordering and
provenance across the layout transition.
