# MAIVW Finalized State Readers V1

Observers provide only a finalized source reference. Before signing, the
relayer reads the canonical state again instead of treating event arguments as
the mirror payload.

- EVM reads the block hash and all Registry views with the same explicit
  `blockNumber`; a hash or epoch mismatch fails closed.
- Solana derives the `DomainRecord` PDA, requests it with `finalized` and
  `minContextSlot`, verifies owner/discriminator, decodes the complete Borsh
  account and compares domain hash, epoch and sequence with the event.

Both readers return one chain-agnostic state containing typed keys, endpoint,
TLS, status, provider data, stake, immutable origin and transaction reference.
That object is the only accepted input for mirror payload builders.
