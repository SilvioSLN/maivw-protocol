# Gateway Multichain Configuration V1

Multichain deployments are opt-in. The gateway constructs ledger adapters only
for complete, validated deployments; an address or RPC appearing in a legacy
support list is not enough to advertise a network.

When Solana is enabled, startup requires HTTP RPC, WebSocket RPC, canonical
cluster genesis hash, program ID, relayer public key and either a mounted
keypair path or a 64-byte keypair supplied by the secret manager. Inline
keypairs must match the configured public key. Commitment is fixed to
`finalized`.

Native Solana settlement is exactly `SOL` with 9 decimals and no mint. A
Solana deployment supports origin registration only when a complete SPL asset,
positive standard fee and OriginClaim signer are configured; native-asset
deployments remain mirror-capable. The production onboarding coordinator is
created automatically for an origin-capable deployment.

Each enabled EVM relay deployment requires a valid Registry address, HTTP RPC
and WebSocket RPC. The relayer itself requires at least two complete
deployments plus a local secp256k1 key or configured GCP KMS version.

Observer page limits, reorg margin, attestation TTL, worker lease and circuit
failure threshold are bounded by the environment schema. Empty Docker values
are removed before validation, so they cannot silently satisfy a required
field.
