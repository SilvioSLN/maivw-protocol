# MAIVW Ledger Adapters V1

`LedgerService` is the chain-agnostic facade. It owns an exact `NetworkId` to
adapter registry and dispatches common reads without checking whether the
target is EVM or Solana.

Every `LedgerAdapter` exposes:

- immutable family, network and Registry identifiers;
- typed domain identity, including origin/mirror kind, endpoint, keys, status,
  epoch and sequence;
- provider state, stake, tier, strikes and daily limit;
- a network health check.

The existing EVM implementation is isolated as `EvmLedgerAdapter`. The facade
delegates the legacy single-chain API to its primary EVM adapter so existing
Gateway consumers remain compatible while new multichain consumers resolve an
adapter explicitly by canonical `NetworkId`.

Duplicate networks or Registry identifiers are rejected at startup. Unknown
networks fail explicitly instead of silently falling back to Base or casting a
Solana identifier to an EVM chain id.

