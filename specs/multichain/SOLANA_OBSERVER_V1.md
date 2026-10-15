# MAIVW Solana Observer V1

The Solana observer accepts only `finalized` RPC data. Its durable cursor binds
the cluster `networkId`, Registry `programId`, initial slot and the latest
finalized `(slot, signature)` watermark.

`getSignaturesForAddress` is paginated backwards until the configured start
slot or previous signature. The complete gap is collected before persistence;
if the page budget is exhausted or any transaction is unavailable, the cursor
does not advance. Transactions and canonical events are then inserted
idempotently in one database transaction.

The default decoder recognizes Anchor `DomainStateChanged` by its eight-byte
discriminator and stores `(slot, signature, instructionIndex, logIndex)` plus
epoch, sequence and immutable origin reference. A restart repeats, at worst,
safe upserts and cannot duplicate a source event.
