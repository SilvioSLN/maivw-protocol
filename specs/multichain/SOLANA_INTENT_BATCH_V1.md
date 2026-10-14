# Solana Intent Batch V1

`register_intent_batch` ancora uma raiz Merkle para um domínio de origem
Solana. O armazenamento canônico é:

```text
IntentBatch = PDA(
  "intent-batch",
  domainHash,
  globalDomainEpoch_u64_le,
  batchNonce_bytes32
)
```

O nonce é fornecido explicitamente pelo publicador, deve ser diferente de zero
e faz parte da chave. A conta usa `init`, portanto repetir o mesmo
`(domainHash, epoch, nonce)` falha antes de qualquer mutação. Uma raiz igual pode
ser publicada com outro nonce quando representa outro batch.

## Validação

- apenas registros `Origin` e `Active` no epoch informado;
- `messageClass` contém de 1 a 32 bytes;
- `merkleRoot` é diferente de zero;
- o signer corresponde à chave operacional, chave admin ou oracle configurado;
- mirrors, domínios suspensos/revogados e signers estranhos são rejeitados.

A conta persiste o nonce, classe e seu `keccak256`, raiz, publicador, timestamp,
epoch e `originSequence`. O registro incrementa a sequence exatamente uma vez,
permitindo que mirrors ordenem a nova âncora em relação às demais alterações do
domínio.

