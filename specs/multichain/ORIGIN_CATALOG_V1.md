# MAIVW Origin Catalog V1

`OriginCatalogService` is the transactional authority that serializes the first
finalized origin observed for a canonical domain. It does not replace the
Registry state of that origin network.

## Persisted invariants

- `OriginRecord.domainHash` is globally unique.
- `domainHash` is `keccak256(utf8(lowercase(trim(domain))))` and is checked
  before any write.
- `originNetworkFamily`, `originNetworkId` and `originRegistryId` are immutable.
- the transaction family must equal the origin family;
- `globalDomainEpoch` and `originSequence` fit in `uint64` and reconciliation
  only accepts a lexicographically greater pair;
- an exact activation or reconciliation retry is a no-op;
- the current record, audit event and outbox event are written in one
  PostgreSQL `SERIALIZABLE` transaction.

The unique constraint, rather than an HTTP preflight check, decides concurrent
EVM/Solana activation. A losing writer receives `ORIGIN_ALREADY_ACTIVE`. A
serialization failure receives `ORIGIN_CATALOG_RETRY` and may be retried.

## Append-only audit chain

Each state transition inserts one `OriginAuditEvent`; the service exposes no
audit update or delete operation. Events have a database-generated `ordinal`
and a per-domain hash chain:

```text
eventHash = keccak256(utf8(canonical JSON event V1))
event[n].previousEventHash = event[n - 1].eventHash
OriginRecord.lastAuditHash = event[n].eventHash
```

The canonical JSON includes the event and record IDs, domain hash, action,
previous and next snapshots, actor, request ID, previous hash and timestamp.
All bigint fields are decimal strings. `verifyOriginAuditChain` recalculates
every event and detects mutation, deletion or reordering.

Each audit insertion also creates one `OriginOutboxEvent` with topic
`maivw.origin-catalog.v1`. Publication retries may update the outbox status,
but never the audit event.

## Supported transitions

### Activation

Absence of `OriginRecord` becomes `ACTIVE` after an observer supplies a
finalized transaction reference. Once present, the network and Registry can no
longer change in V1.

### Reconciliation

The same origin may advance `(globalDomainEpoch, originSequence)` and replace
the finalized transaction reference. Regression is rejected. The same version
with another transaction reference is treated as contradictory evidence.

## Scope boundary

DNS challenges, temporary reservation, `OriginClaimV1` issuance and expiration
are defined in `ORIGIN_RESERVATION_V1.md`. Observer cursor/finality logic belongs to SM-050/SM-051. The
Prisma migration that combines all multichain persistence models belongs to
SM-069; until then the schema is validated and can be applied by the existing
deployment schema workflow.
