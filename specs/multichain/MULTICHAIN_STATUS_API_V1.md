# Multichain Domain Status API V1

`GET /api/v1/multichain/status/:domain` resolves the immutable origin from the
global origin catalog and then reads the domain from every configured ledger
adapter. It never infers origin from the gateway's primary EVM connection and
never fabricates a mirror for a supported-but-unconfigured network.

The response identifies the catalog origin, its finalized transaction and
version, followed by one entry per configured deployment. Each entry exposes
its `ORIGIN` or `MIRROR` role, serialized typed identity and one projection:

- `IN_SYNC`, `VERSION_BEHIND` or `VERSION_AHEAD` from `(epoch, sequence)`;
- `MISSING_ORIGIN` or `MISSING_MIRROR` when the account/record is absent;
- `ORIGIN_CONFLICT` when record kind or immutable origin reference diverges;
- `UNREADABLE` when that deployment cannot be queried.

Read failures are isolated per deployment and return only a stable error code.
They do not suppress healthy origin or mirror reads. Big integers are emitted
as decimal strings so the response is lossless JSON.
