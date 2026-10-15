# MAIVW Attestation Signer V1

The Gateway uses one secp256k1 signing boundary for both `OriginClaimV1` and
`StateAttestationV1`. Only the canonical 32-byte digest enters that boundary.
The private key, KMS client and credentials never appear in the returned value,
logs, reservation rows or relay jobs.

Production uses a versioned Google Cloud KMS resource. Each result stores:

- `signature`: recoverable 65-byte, low-S secp256k1 signature;
- `keyId`: KMS crypto-key resource without `/cryptoKeyVersions/{version}`;
- `keyVersion`: immutable KMS version;
- `signerAddress`: address derived from the KMS public key when a complete
  attestation is signed.

Before returning, the boundary recovers the signer address from the digest and
signature and compares it with the configured public key. It also rejects a
kind/purpose mismatch, such as sending a `StateAttestationV1` through an
`ORIGIN_CLAIM` operation.

Local private-key signing exists only for development and exposes the same
interface. Its key id contains the public address, never the private key.
