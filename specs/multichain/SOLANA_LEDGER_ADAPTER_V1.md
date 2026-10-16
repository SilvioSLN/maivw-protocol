# MAIVW Solana Ledger Adapter V1

The Solana adapter derives each `DomainRecord` PDA from
`["domain", keccak256(canonicalDomain)]` and reads it with `finalized`
commitment. The account must be owned by the configured MAIVW program and its
decoded domain/hash must match the requested PDA.

For an `ORIGIN`, the stored origin family, network hash and Registry bytes must
match the current Solana deployment. A `MIRROR` retains the immutable external
origin instead. Both kinds expose typed operational/admin keys, endpoint,
status, epoch and sequence.

Provider reads return tier, strikes, daily limit and both stake views. Local
stake is available only for an origin; a mirror reports zero local custody and
keeps the attested origin stake separately.

Health checks compare the RPC genesis hash with the configured canonical
`NetworkId` and require a non-negative finalized slot. Cluster divergence is a
hard error suitable for the relayer circuit breaker.

