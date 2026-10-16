# Prisma Multichain Migration V1

`20261016000000_baseline_with_multichain` is the first versioned PostgreSQL
baseline for the gateway. It contains the existing product tables and the full
multichain persistence graph in one reproducible migration.

The multichain portion includes:

- immutable origin records, DNS reservations, OriginClaim issuance, audit and
  transactional outbox rows;
- finalized EVM blocks/events and Solana transactions/events with durable
  cursors;
- relay jobs, independent destinations, monotonic transitions, immutable
  signed submissions, leases and attempt history;
- reorg/compensation and persistent circuit-breaker state;
- reconciliation runs/findings with origin epoch/sequence and audit hashes.

Uniqueness constraints protect source event idempotency, one destination per
deployment, one signed submission per destination, retry attempt identity and
one finding per run/deployment. Foreign keys use restrictive deletion for
audit and relay evidence.

The container now executes `prisma migrate deploy`; it no longer performs
`prisma db push` at startup.

## Existing databases created with `db push`

Before deploying this version against an existing schema, back up PostgreSQL,
verify that its schema matches this Prisma schema, and baseline it once:

```sh
npx prisma migrate resolve --applied 20261016000000_baseline_with_multichain
npx prisma migrate deploy
```

Do not mark the baseline as applied on an empty or divergent database. New
databases should run `prisma migrate deploy` directly.
