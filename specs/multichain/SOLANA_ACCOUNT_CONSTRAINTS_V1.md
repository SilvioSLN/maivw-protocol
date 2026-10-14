# Solana Account Constraints V1

This document is the security matrix for every account accepted by the MAIVW
Solana Registry. Constraints are enforced before business logic by Anchor and
rechecked in handlers where economic state is consumed.

## Ownership and type rules

| Account class | Enforcement |
| --- | --- |
| Registry program state | `Account<T>` checks program owner and Anchor discriminator; every mutable structure validates its schema and identity before use |
| SPL mint and token accounts | `Account<Mint>` / `Account<TokenAccount>` pin ownership to the classic SPL Token program |
| Programs | `Program<Token>`, `Program<AssociatedToken>` and `Program<System>` verify executable program ids |
| Signers | Every authority, admin, relayer, payer, reporter and permissionless executor that funds an account is typed as `Signer` |
| Legacy migration input | `UncheckedAccount` is accepted only with program owner, canonical PDA, exact V1 size, `DomainRecord` discriminator and V1 schema |

`RegistryConfig.validate()` pins `tokenProgram` to the classic SPL Token id and
is executed by every handler that receives the config. All active mutations also
carry the `config.active` constraint; the documented governance exceptions are
veto, recovery cancellation, reporter claim and account migration.

## PDA identity

All program state uses the canonical seeds and stored bump described in the
Solana README. New accounts use Anchor's canonical `bump`; existing accounts use
the persisted bump. Domain-bearing contexts additionally compare the account's
internal `domainHash` with the instruction argument. Epoch-scoped slash,
recovery, pending-admin, reporter-pool and intent accounts bind the epoch in both
their seeds and serialized identity.

Distinct seed namespaces are used for domain records, stake vaults, receipts,
process cases and token-vault authorities. Tests verify domain scoping, epoch and
nonce separation, and separation between founder, treasury, domain and stake
PDAs.

## Attestation sysvar

Every instruction that reads an Ed25519 precompile (`verify_attestation`, origin
registration, mirror register/sync/revoke, reclaim and recovery request) pins its
unchecked account to the native instructions sysvar address. The verifier then
requires the immediately preceding instruction, one canonical Ed25519 signature,
self-contained offsets and the exact envelope digest.

## SPL constraints

Economic instructions enforce all of the following before CPI:

- mint equals `RegistryConfig.assetMint` (or the immutable reporter-pool mint);
- mint decimals equal the configured decimals where config is in scope;
- token program equals the configured classic SPL Token program;
- user source account owner equals the signer;
- program vault is the canonical ATA for mint, PDA authority and token program;
- `StakeVault.tokenAccount` / `ReporterPool.tokenAccount` equals the supplied ATA;
- serialized vault accounting is solvent against the live token balance;
- SPL source and destination roles are distinct.

Aliasing checks cover registration fee splits, provider registration, reclaim,
top-up, warning penalties, slash distribution and reporter claims. Reclaim
intentionally permits the registrant and previous admin to be the same owner,
but neither ATA may alias a protocol vault.

## Audited unchecked accounts

| Account | Why unchecked | Constraint |
| --- | --- | --- |
| instructions sysvar | Native sysvar bytes | Exact native address |
| founder/treasury authority | PDA signs only through program seeds | Exact seed namespace and canonical bump |
| previous admin | May be an off-curve Ed25519 address and only receives SPL | Exact equality with the stored admin key; its ATA is derived by Anchor |
| optional reclaim process PDAs | May be uninitialized system accounts | Exact seeds/bump; handler accepts only program-owned typed bytes or empty system-owned data |
| migration domain record | Legacy bytes cannot deserialize as V2 | Program owner, exact PDA/size/discriminator/schema |

No unchecked account is trusted for signer status, mint data, token ownership or
arbitrary program state.
