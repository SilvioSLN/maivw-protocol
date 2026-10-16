# MAIVW Multichain Relay Job State Machine V1

Each finalized source event creates one durable relay job identified by an
immutable `sourceEventKey`. A job owns one destination row for every target
deployment. The origin deployment cannot also be a destination and duplicate
network/Registry pairs are rejected.

The monotonic state sequence is:

`DETECTED → FINALIZED → ATTESTED → SUBMITTED → CONFIRMED → RECONCILE`

Detection and finalization apply to the source job. Finalization stores the
hash of the state reread at the exact finalized block or slot and atomically
advances every destination to `FINALIZED`. Later transitions are independent
per destination. The aggregate job state is the minimum state reached by all
destinations, so one fast chain never hides an unfinished destination.

Every materialized state change appends a `MultichainRelayTransition` row.
Compare-and-set updates prevent concurrent workers from skipping or regressing
a state. An exact retry is a no-op; changing the destination set, finalized
state hash, attestation digest or chain reference under the same identity is a
conflict.

The state machine stores public hashes and transaction references only. KMS
credentials, private keys and RPC clients never enter job persistence.
