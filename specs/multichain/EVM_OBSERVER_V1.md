# MAIVW EVM Observer V1

One durable observer runs per Registry on Base, Arbitrum or Polygon. Its network
identity is the canonical `evm:{chainId}` plus the Registry address normalized
to 32 bytes. Reopening a cursor with different chain, Registry, start block or
confirmation policy fails closed.

## Finality and progress

The scan ceiling is `head - confirmations`, where `confirmations` is configured
per deployment. Blocks above that ceiling are never persisted as source events
and cannot trigger a `StateAttestationV1`.

For each finalized block, the observer:

1. reads the header at the exact height and verifies hash, number and parent;
2. reads Registry logs for that block and validates every log position;
3. decodes known ABI events;
4. atomically persists the block, decoded events and `nextBlock` cursor.

An RPC error, missing header, wrong parent or malformed log stops the scan at
that height. A restart resumes from the same `nextBlock`; event uniqueness uses
`(networkId, blockHash, transactionHash, logIndex)`.

## Reorganizations

Before every batch, the observer rereads the last persisted block. If its hash
changed, it walks backwards until the first common ancestor. The former branch
is retained with status `ORPHANED`, including its events, and the cursor moves
to `commonAncestor + 1` for deterministic backfill of the replacement branch.

Mirrors are not silently rolled back by this observer. Only finalized source
events leave this component; compensation of an already relayed state remains
the higher-sequence reconciliation flow defined by the multichain protocol.
