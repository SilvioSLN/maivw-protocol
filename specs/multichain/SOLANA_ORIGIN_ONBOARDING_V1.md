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

