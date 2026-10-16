# MAIVW Relay Circuit Breaker V1

The relayer uses persistent circuit breakers to fail closed without discarding
in-flight evidence. A breaker can cover the whole relayer, one domain, one
deployment, or one domain/deployment pair. Submission checks every applicable
scope from global to most specific before preparing signed bytes or
broadcasting a transaction.

The following signals open a breaker immediately:

- `ORIGIN_CONFLICT`: more than one immutable origin is observed;
- `STATE_DRIFT`: equal versions commit different canonical state;
- `RPC_DIVERGENCE`: trusted RPC endpoints disagree on finalized state;
- `LOW_BALANCE`: the deployment cannot fund the required transaction.

`RELAY_FAILURE` increments a consecutive-failure counter and opens the breaker
at its persisted threshold. `RELAY_SUCCESS` clears the counter only while the
breaker is closed; success never hides an incident after it opens.
Reconciliation findings classified as `ORIGIN_CONFLICT` or `STATE_DRIFT` map
directly to a domain/deployment breaker signal.

An open breaker stops new preparation and broadcast. It does not stop finality
checks for transactions already sent, reorg evidence collection, withdrawals
that are independently protected, or compensation workflows. This distinction
avoids turning a safety pause into loss of observability.

Only an explicit manual reset closes an open breaker. The reset identifies the
operator and incident reason. Every signal and reset is append-only, idempotent
by request id plus request hash, and linked to the previous audit hash for its
scope. Concurrent state changes use a persisted version compare-and-set.

