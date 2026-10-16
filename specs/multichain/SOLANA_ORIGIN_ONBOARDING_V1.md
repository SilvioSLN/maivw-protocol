# MAIVW Solana Origin Onboarding V1

The onboarding challenge accepts a canonical Solana `NetworkId` and the
registrant Pubkey. `OriginReservationService` commits both values, the MAIVW
program Registry and the requester to the DNS challenge, preventing the same
proof from being replayed for another origin.

After DNS quorum verification, the coordinator reserves the unique origin and
hashes the exact Solana registration payload: domain, registrant, typed
operational/admin keys, endpoint, TLS fingerprint, SPL mint and fee. The
resulting `OriginClaimV1` is therefore valid only for that transaction.

`POST /api/v1/onboarding/origin-claim` returns the signed claim and an unsigned
transaction draft. The draft contains, in order:

1. secp256k1 precompile verification of the complete claim envelope;
2. `register_domain` with every canonical PDA, token account, sysvar and
   program account.

The client supplies a recent blockhash and signs as the selected Solana
registrant. EVM callers that omit `networkId` continue to use the compatible
legacy onboarding flow. Deployments that have not configured the Solana
coordinator fail explicitly with HTTP 503 instead of silently choosing EVM.

## Client discovery and execution

Authenticated clients discover eligible origins with
`GET /api/v1/onboarding/origin-networks`. Each entry includes the canonical
NetworkId, Program id, explorer, SPL mint, decimals and the exact standard fee
in both base units and display form. The UI must never infer a Solana fee from
an EVM chain id.

The claim request selects `WALLET` or `RELAYER`. In wallet mode the registrant
pays Solana's network fee. In relayer mode the relayer may be the fee payer,
but the registrant remains a required signer in both modes; relaying never
turns the origin registration into a custodial operation.
