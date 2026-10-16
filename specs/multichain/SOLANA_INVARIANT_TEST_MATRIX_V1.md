# Solana invariant test matrix V1

This matrix is the acceptance map for the Solana registry invariant suite. It
links every SM-077 risk class to executable Rust tests; no row relies only on a
documented assumption.

| Risk class | Executable coverage |
|---|---|
| Solana origin | `registration::tests`, `state::tests::origin_and_mirror_invariants_are_distinct`, and `attestation::tests::origin_claim_binds_origin_domain_payload_and_initial_version` |
| External mirror | `mirror::tests`, the mirror attestation tests, and the mirror receipt PDA tests |
| Economics | `economics::tests`, `provider::tests`, and `slashing::tests` prove conservation, caps, bounded work, suspension, and top-up |
| Governance | `governance::tests` proves guardian/authority pause separation and rejects invalid transitions |
| Replay | `state::tests::replay_receipts_are_bound_to_domain_and_nonce`, receipt `init` constraints, strict mirror versions, and recovery/migration replay tests |
| False/substituted accounts | `security::tests`, canonical PDA derivation tests, typed-key forgery tests, and Anchor account constraints |
| Migration | `migration::tests` proves exact canonical-field preservation, explicit expansion, and rejection of replay/unknown versions |

Run the complete pinned suite with:

```sh
cd solana
cargo test --workspace --locked
```

The account-level replay guarantee is structural: receipt addresses include
both `domain_hash` and `nonce`, use distinct seed namespaces for origin claims
and mirror attestations, and are created with Anchor's `init`. Reusing the same
authorization therefore resolves to an already initialized account, while a
nonce cannot be rebound to another domain or receipt class.
