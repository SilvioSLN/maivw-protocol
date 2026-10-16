# MAIVW N×N Reconciliation V1

Reconciliation runs once per active origin domain and compares its finalized
canonical state with every configured destination Registry. Iterating the
origin catalog across every deployment produces the complete N×N matrix
without treating a mirror as a new origin.

For each destination the service records one immutable classification:

- `IN_SYNC`: same immutable origin, version, payload and source transaction;
- `MISSING_MIRROR`: no projection exists;
- `VERSION_BEHIND`: destination needs sync or revoke;
- `VERSION_AHEAD`: destination claims state newer than finalized origin;
- `STATE_DRIFT`: the same version commits different state or evidence;
- `ORIGIN_CONFLICT`: record kind or immutable origin differs;
- `UNREADABLE`: destination state could not be read at finality.

Safe repair plans are `REGISTER`, `SYNC`, `REVOKE` or `RETRY_READ`.
Ahead versions, immutable-origin conflicts, same-version drift and an absent
already-revoked mirror require `MANUAL_REVIEW`; reconciliation never hides
them with an invalid transaction that the destination would reject.

Each run and finding stores a deterministic audit hash. Runs for the same
domain link to the previous run hash. A request id is idempotent only for the
same complete snapshot; reuse with changed state or targets is a conflict.
