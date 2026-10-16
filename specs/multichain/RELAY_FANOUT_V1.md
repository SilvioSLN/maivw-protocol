# MAIVW Origin Fan-out V1

Fan-out receives one canonical `ORIGIN` state reread at finality and a fixed
attestation deadline. It creates a destination-specific nonce and
`StateAttestationV1`, signs through the isolated KMS boundary, invokes the EVM
or Solana builder, prepares the signed relay transaction durably and submits
it through the destination adapter.

Both directions use the same path:

- Solana origin to one or more EVM mirror registries;
- EVM origin to Solana and/or other EVM mirror registries.

Network family, canonical network id and network hash must agree. Destination
pairs are unique and the transaction builders reject a destination equal to
the immutable origin.

Each destination executes inside its own error boundary. Signing, building,
preparation or RPC failure for one target produces a result for that target
only; all other branches continue. Retrying fan-out first looks for an existing
prepared transaction and reuses it instead of signing or allocating a new
chain nonce.

The source evidence, `(globalDomainEpoch, originSequence)`, payload hash and
typed keys are identical across branches. Only destination fields, nonce and
relay transaction encoding differ.
