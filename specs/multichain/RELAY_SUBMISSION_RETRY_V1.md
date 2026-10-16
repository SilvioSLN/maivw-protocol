# MAIVW Relay Submission and Retry V1

Submission is split into durable preparation, broadcast and destination
finality. The relayer persists the already signed transaction bytes, their
Keccak-256 hash, expected transaction id, attestation deadline and a unique
idempotency key before any network call.

Workers acquire a bounded compare-and-set lease. A failed RPC call releases
the lease and schedules exponential backoff. Every retry broadcasts the exact
same signed bytes, so it preserves the EVM nonce or Solana signature and cannot
create a second logical transaction. A returned transaction id different from
the prepared id is rejected.

An exact retry after `BROADCAST` does not call the RPC again; it repairs any
missing materialized job transition and returns the stored transaction id.
The coordinator refuses preparation or initial broadcast after the
attestation deadline.

`CONFIRMED` is written only after the family adapter reports destination
finality and supplies an auditable block/slot reference. Pending confirmations
remain `SUBMITTED`; reverted or dropped transactions are surfaced for later
reconciliation instead of being treated as success. Every broadcast, retry
schedule and confirmation has an append-only attempt record.
