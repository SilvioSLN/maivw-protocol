# Multichain Networks API V1

`GET /api/v1/multichain/networks` publishes the deployments that are actually
configured in the running gateway. It does not synthesize networks from a
hard-coded support list.

## Source of truth

Each `LedgerAdapter` owns one validated `NetworkDefinition`. The endpoint
enumerates those adapters, so a network is advertised only when its Registry
and adapter were constructed successfully. EVM and Solana use the same public
shape without coercing chain IDs, addresses or public keys into one another.

## Response entry

Each entry contains:

- `family`, canonical `networkId`, normalized `registryId` and
  `registryVersion`;
- display `name` and explicit `capabilities.origin` / `capabilities.mirror`;
- the typed settlement `asset` and finality policy;
- explorer metadata for transactions, addresses and blocks;
- an observed `state` with `AVAILABLE` or `UNAVAILABLE`, `checkedAt` and a
  stable `errorCode` when the adapter health check fails.

Availability is isolated per adapter. One failed RPC or Registry does not hide
healthy deployments and does not fail the entire endpoint.

## Security and configuration

RPC and WebSocket URLs are operational secrets/configuration and are not
returned. Error messages from providers are also omitted; only stable codes
cross the API boundary. The endpoint is public because clients need it before
choosing an origin or mirror destination.

The endpoint reports runtime reachability, not protocol consensus. Its health
state must not replace finalized origin reads or reconciliation checks.
