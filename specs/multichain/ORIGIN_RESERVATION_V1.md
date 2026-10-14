# MAIVW Origin Reservation and Claim V1

This workflow serializes the choice of the first origin network after DNS proof
and before an on-chain registration can finalize. A DNS challenge alone never
blocks a domain.

## Challenge

The requester chooses all origin coordinates before the challenge is issued:

- canonical domain and `domainHash`;
- requester account;
- typed origin family, canonical `NetworkId` and normalized `RegistryId`;
- typed registrant algorithm and 32-byte key;
- challenge expiration.

The TXT value is:

```text
_maivw-verify.<domain> TXT "maivw-origin-v1=<challengeId>.<randomToken>"
```

Only `keccak256(token)`, the context hash and the complete TXT value hash are
stored. The random token is returned once to the caller and is never persisted
in clear text. `QuorumDnsTxtVerifier` requires the exact TXT value from two
independent resolver groups by default and fails closed on timeout or disagreement.

## Atomic reservation

After DNS validation, one PostgreSQL `SERIALIZABLE` transaction:

1. revalidates challenge ownership, token and expiration;
2. rejects an existing `OriginRecord`;
3. expires an eligible old blocker and appends its audit event;
4. checks the requester's hashed idempotency key;
5. inserts `OriginReservation` and its audit/outbox event;
6. marks the challenge verified.

`OriginReservation.blockingDomainHash` is unique and equals `domainHash` while
the reservation blocks. Expiration or cancellation sets it to `null`; PostgreSQL
therefore permits a later reservation without weakening the one-live-blocker
constraint. An exact retry returns the existing reservation. Reusing the same
idempotency key with different context returns `IDEMPOTENCY_MISMATCH`.

## OriginClaimV1 issuance

One reservation produces at most one `OriginClaimIssuance`. The envelope is the
shared fixed-width `AttestationV1` with:

- kind `ORIGIN_CLAIM` and action `REGISTER_ORIGIN`;
- origin and destination both equal to the chosen network/Registry;
- epoch and sequence equal to zero;
- the reservation nonce as claim ID and replay key;
- the canonical registration `payloadHash`;
- the validated TXT value hash as `evidenceHash`;
- a bounded deadline.

The service signs the digest through `OriginClaimSigner`, which receives the
stable issuance ID as its idempotency context. Signature, signer key ID/version,
encoded bytes, digest and all hashes are persisted. The concrete HSM/KMS adapter
is supplied by SM-049; the canonical registration-payload builders are supplied
by SM-048.

After issuance the reservation remains blocking until:

```text
holdUntil = claimDeadline + maximum finality/reorg margin for the origin family
```

This prevents another network from winning while an older, still-valid claim
may be in flight. Once `holdUntil` passes, lazy expiration atomically clears the
blocking key, marks an unconsumed claim expired and appends audit/outbox events.

## Auditability

`RESERVATION_CREATED`, `CLAIM_ISSUED` and `RESERVATION_EXPIRED` are append-only,
globally ordered events. Every event contains previous/next snapshots and the
hash of the previous event for that reservation. `verifyReservationAuditChain`
recalculates the chain. Each transition creates an outbox event in the same
database transaction.

## Scope boundary

This module does not mark a domain active. EVM/Solana observers must confirm and
reread finalized Registry state before using `OriginCatalogService.activate`.
The existing product onboarding routes are switched to this workflow in SM-063;
until then they remain isolated from the new multichain reservation core.
