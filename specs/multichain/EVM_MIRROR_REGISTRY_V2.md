# EVM Mirror Registry V2

`MAIVWMirrorRegistryV2` is the EVM destination for V1 state attestations emitted by Solana or another MAIVW origin network.

It is a separate UUPS proxy, not an added storage segment in `MAIVWRegistry`. The legacy implementation is 24,555 bytes, leaving only 21 bytes below the EIP-170 runtime limit. Keeping the mirror projection separate preserves the deployed Registry storage byte-for-byte and leaves the new implementation independently upgradeable.

## Write flow

1. The observer finalizes and rereads the state on the origin network.
2. The oracle serializes `StateAttestationV1`, with `destinationRegistry` set to the Mirror Registry proxy and `destinationNetworkHash` set to `keccak256("evm:<chainId>")`.
3. `payloadHash` is `hashMirrorStateV2(state)`. The oracle signs the raw `keccak256` digest of the fixed 292-byte envelope.
4. A relayer calls `registerMirrorV2`, `syncMirrorV2` or `revokeMirrorV2`.
5. The destination verifies signature, deadline, action, destination, payload, immutable origin and the lexicographic `(globalDomainEpoch, originSequence)` version.

An exact replay is a no-op. A different payload at the same version, an older version, or a different origin reverts. Revocation retains `exists`, origin and version as a tombstone. A later state may become active again only with a greater version signed by the same origin, such as after an origin-side reclaim.

## Key and economic semantics

Keys are stored as `(algorithm, bytes32)` descriptors:

- `1`: secp256k1 EVM address, left-padded to 32 bytes;
- `2`: Ed25519 Solana public key;
- `3`: raw Ed25519 public key.

No Ed25519 key is converted into an EVM `address`. `attestedStake` and `dailyLimit` are query-only origin values. The mirror contract does not custody or spend the origin stake.

## Compatibility and migration

`migrateLegacyMirrorV2` is owner-only and imports an active legacy mirror once, representing its existing EVM keys with algorithm `1`. The origin network is derived from the legacy `originChainId`; governance supplies the original registry and transaction reference.

The Lens batches profile and version reads through `getEnrichedMirrorsV2`. The Gateway uses `MIRROR_REGISTRY_V2_ADDRESS` and `getTypedDomainIdentity` to resolve the original key algorithm, status, origin, epoch and sequence without an alias.

The canonical Registry layout is pinned by `contracts/storage-layout/MAIVWRegistry.v2.slots` and checked with `contracts/script/check-storage-layout.sh`. Upgrade and operational rollback of the mirror proxy are covered by `MAIVWMirrorRegistryV2.t.sol`.
