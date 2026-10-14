# Solana Reclaim Payload V1

`reclaim_domain` consome um novo `OriginClaimV1` com
`action = ReclaimOrigin (6)`. O claim prova novamente o controle DNS e autoriza
o novo titular e perfil no mesmo deployment de origem.

`payloadHash = keccak256(payload)`, onde `payload` tem exatamente 261 bytes:

| Offset | Size | Campo | Encoding |
|---:|---:|---|---|
| 0 | 8 | magic | ASCII `MAIVWRCL` |
| 8 | 1 | version | `0x01` |
| 9 | 32 | domain hash | `keccak256(canonicalDomainUtf8)` |
| 41 | 32 | registrant | Solana pubkey |
| 73 | 1 | operational algorithm | `0x02`, Ed25519 Solana pubkey |
| 74 | 32 | operational key | bytes32 |
| 106 | 1 | admin algorithm | `0x02`, Ed25519 Solana pubkey |
| 107 | 32 | admin key | bytes32 |
| 139 | 32 | endpoint hash | `keccak256(endpointUtf8)` |
| 171 | 32 | TLS fingerprint | bytes32; zero remove o fingerprint anterior |
| 203 | 1 | provider flag | derivado do tier |
| 204 | 1 | provider tier | `0` none, `1` basic, `2` trusted, `3` institutional |
| 205 | 8 | current epoch | uint64 big-endian |
| 213 | 8 | current sequence | uint64 big-endian |
| 221 | 8 | payment | uint64 big-endian, unidades mínimas do SPL token |
| 229 | 32 | mint | SPL mint configurado |

O envelope assinado também vincula nonce, deadline, epoch, sequence,
deployment de origem/destino e `evidenceHash` não nulo. O nonce cria um novo
`OriginClaimReceipt`, portanto claims de cadastro e reclaim nunca são
sobrescritos.

## Transição econômica e limpeza

- Apenas uma origem `Suspended` ou `Revoked` pode ser reivindicada; mirrors e
  origens ativas são rejeitados.
- A caução contabilizada remanescente é transferida ao ATA do admin anterior.
- O novo titular paga integralmente a taxa ou stake do novo tier. Excedente SPL
  enviado diretamente ao vault continua fora da contabilidade canônica.
- O epoch é incrementado e a nova versão começa em `originSequence = 1`.
- `PendingAdmin`, `RecoveryCase` e `SlashCase` no estado `Pending` do epoch
  anterior são fechados explicitamente. Estados terminais permanecem como
  histórico auditável e, em qualquer caso, o novo epoch impede seu uso.

