# Solana Recovery Payload V1

`request_recovery` consome uma `StateAttestationV1` com
`action = RecoverOrigin (5)`. A assinatura Ed25519 do oracle cobre o envelope
completo; seu `payloadHash` é o `keccak256` da concatenação abaixo, sem ABI,
padding ou prefixo de tamanho:

```text
"MAIVWREC"              // 8 bytes ASCII
|| version              // uint8 = 1
|| domainHash           // bytes32
|| globalDomainEpoch    // uint64 big-endian
|| originSequence       // uint64 big-endian
|| newAdmin             // 32-byte Solana pubkey
|| newOperationalKey    // bytes32 Ed25519
```

O payload tem exatamente 121 bytes. O `nonce`, `deadline`, deployment de
origem/destino e `evidenceHash` pertencem ao envelope V1 e, portanto, também
estão cobertos pela assinatura. `evidenceHash` deve ser diferente de zero.

## Replay e concorrência

- `RecoveryCase = PDA("recovery-case", domainHash, globalDomainEpoch_u64_le)`
  guarda o pedido corrente e o resultado auditável daquele epoch.
- `RecoveryReceipt = PDA("recovery-receipt", domainHash, nonce)` é append-only;
  a criação com `init` impede reutilizar uma autorização mesmo após
  cancelamento ou substituição do pedido.
- O envelope deve conter o epoch e a sequence atuais do domínio. Uma alteração
  concorrente da origem invalida a prova ainda não consumida.

## Transições

1. Qualquer relayer pode apresentar a atestação válida e financiar os PDAs.
2. O admin corrente pode cancelar um caso `Pending`, inclusive durante pause.
3. Qualquer signer pode executar depois de `recoveryDelaySeconds`, desde que o
   domínio continue `Origin`, `Active` e no mesmo epoch.
4. A execução troca admin e chave operacional, incrementa o epoch e inicia o
   novo epoch em `originSequence = 1`. Isso invalida por versão qualquer
   `PendingAdmin`, slash ou recovery vinculado ao epoch anterior.

