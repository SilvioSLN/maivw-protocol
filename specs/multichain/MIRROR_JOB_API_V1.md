# Multichain Mirror Job API V1

The authenticated `POST /api/v1/multichain/attest-mirror` and internal
`POST /api/v1/multichain/fulfill-mirror` endpoints enqueue the same durable
origin-to-N relay job. Neither endpoint broadcasts an ad-hoc transaction.

The coordinator resolves the immutable origin from `OriginRecord`, requires
the corresponding configured adapter to reproduce the same origin reference
and `(globalDomainEpoch, originSequence)`, then selects only configured
deployments with mirror capability. Origins and destinations may independently
be EVM or Solana.

The source event key is deterministic for operation, domain, origin and
version. Exact retries reuse the job; changing the destination set for that
source is a conflict. The existing relay pipeline is responsible for finalized
state verification, attestation, transaction construction, submission,
confirmation and reconciliation.

`attest-mirror` requires an active administrator that owns the verified
domain. `fulfill-mirror` requires the internal relayer service key. Legacy
`targetChainId` is accepted as an alias for a single `evm:<chainId>`
destination; new clients use canonical `destinationNetworkIds`.
