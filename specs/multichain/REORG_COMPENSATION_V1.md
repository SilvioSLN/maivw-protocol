# MAIVW Relay Reorg and Logical Compensation V1

An orphaned source event is terminal for the relay job that was derived from
it. The relayer never deletes that job, its transitions, signed transaction
bytes or destination receipts. Instead, it records the fork evidence and
moves each destination to one of two exceptional states:

- `ORPHANED`: no transaction reached the destination, so the projection must
  not be submitted after the source event disappears;
- `COMPENSATION_REQUIRED`: a transaction was submitted or finalized and a
  network-specific reconciliation action is required.

The job state is the strongest outcome across all destinations. A single
materialized mirror therefore makes the job `COMPENSATION_REQUIRED`, while an
event orphaned before every submission leaves the whole job `ORPHANED`.
Neither state can return to the normal monotonic relay pipeline.

Every affected materialized destination gets one durable compensation item.
It preserves the original transaction identifier and starts as `PENDING` with
action `RECONCILE_ORPHANED_SOURCE`. A later network-specific worker may resolve
it by revoking, restoring the canonical origin state or recording an approved
manual resolution. The generic reorg handler does not invent a rollback that
the destination protocol cannot guarantee.

Reorg signals are idempotent for the same job and complete request hash. A
different signal for an already-orphaned job is rejected as a conflict. Reorg
records form an append-only audit chain per domain; compensation records also
commit their immutable inputs in an audit hash.

The observer remains responsible for detecting that a finalized EVM block or
Solana slot/signature is no longer canonical. The reorg service consumes that
evidence using the relay job's `sourceEventKey`, preventing the orphaned event
from becoming final application state while retaining all forensic evidence.

