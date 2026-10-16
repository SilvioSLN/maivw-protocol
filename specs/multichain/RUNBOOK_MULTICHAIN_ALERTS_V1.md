# MAIVW Multichain Alerts Runbook V1

Every alert contains a stable code, scope and runbook anchor. Preserve the
alert id, relevant audit hashes and public transaction references in the
incident record. Never paste signer material, service keys or signed payloads.

## Origin conflict

1. Keep the affected domain/deployment circuit open; do not attest or retry.
2. Compare the origin catalog audit chain with finalized Registry state on both
   reported networks.
3. Escalate to protocol governance. Reset only after one canonical origin is
   proven and the losing reservation/projection is revoked.

## Indexer lag

1. Check finalized RPC health and compare `observedSlot` with `indexedSlot`.
2. Increase the bounded page budget only when RPC capacity and database write
   latency are healthy; never skip the cursor gap.
3. Resume from the persisted signature. Alert resolves below the configured
   slot threshold after a complete poll.

## Reorg

1. Stop submissions for the affected scope and identify the orphaned source
   reference from the reorg audit row.
2. Execute every pending compensation idempotently and retain resulting
   transaction/finality references.
3. Reconcile N×N; reset the circuit only when compensations are resolved and no
   mirror still reflects the orphaned version.

## Low balance

1. Confirm the expected asset, mint/address and minimum required amount from
   the breaker event; do not transfer to an address copied from logs alone.
2. Verify the canonical relayer account in deployment configuration, fund it
   through the approved treasury process, and record the transfer reference.
3. Recheck balance through two RPCs, then perform an audited manual reset.

## Relayer paused

1. Read `triggerSignal`, scope and the latest audit event before taking action.
2. Follow the trigger-specific section in this runbook; a pause is a safety
   control, not a retry condition.
3. Require an operator identity and incident reference in the manual reset.

## KMS failure

1. Keep signing disabled and check Cloud KMS availability, credentials,
   IAM permission, key version state and signer-address derivation.
2. Do not fall back to a local production private key. Test the same KMS key
   version with a non-production diagnostic digest through the approved tool.
3. Resume only after signatures recover to the configured oracle address and
   the failed operation is safely retried with its original idempotency key.

## State drift

1. Keep the domain/deployment circuit open and collect origin/mirror state
   hashes, epoch, sequence and reconciliation audit hash.
2. If the mirror is behind, issue the canonical SYNC/REVOKE repair. If versions
   match but hashes differ, treat as a protocol incident and do not overwrite.
3. Run reconciliation again and reset only at `IN_SYNC` with zero unresolved
   findings.
