# MAIVW Registry para Solana

Workspace Anchor do Registry MAIVW capaz de operar como origem canônica ou como
espelho de uma origem EVM/Solana. A implementação é incremental; o estado deste
marco cobre o schema base e a autenticação de atestações, ainda sem instruções de
mutação do registro.

## Toolchain fixada

- Rust `1.93.1` (`rust-toolchain.toml`)
- Anchor `1.0.1`
- Solana/Agave `3.1.10`
- dependências Rust fechadas em `Cargo.lock`

Use `./scripts/check-toolchain.sh` para validar os binários locais e
`./scripts/test.sh` para executar os testes sem alterar o lockfile. Para comandos
Anchor locais, gere uma carteira descartável com `./scripts/prepare-local-wallet.sh`.
A carteira é ignorada pelo Git e nunca deve receber ativos reais.

## PDAs

| Conta | Seeds | Objetivo |
|---|---|---|
| `RegistryConfig` | `['registry-config']` | Governança, oráculo, ativo econômico, fees, delays e tiers |
| `DomainRecord` | `['domain', domain_hash]` | Estado de domínio `Origin` ou `Mirror` |

`DomainRecord` reserva espaço para domínio DNS de 253 bytes e endpoint de 512
bytes. Os testes serializam o pior caso, comparam o tamanho declarado e calculam
o rent mínimo correspondente.

## Verificação de atestação

`verify_attestation` recebe exatamente o envelope V1 de 292 bytes e exige:

1. uma instrução nativa Ed25519 imediatamente anterior;
2. uma única assinatura, com chave e mensagem contidas nessa própria instrução;
3. signer igual ao `oracle_key` de `RegistryConfig`;
4. mensagem igual a `keccak256(envelope)`;
5. rede e program id de destino iguais a este deployment;
6. deadline vigente e nonce diferente de zero;
7. a conta real do instructions sysvar.

O consumo persistente do nonce será feito pelo `OriginClaimReceipt` em SM-027.
Até essa conta existir, `verify_attestation` é uma verificação sem mutação e não
deve ser usada isoladamente como prova de consumo único.
