# MAIVW Registry para Solana

Workspace Anchor do Registry MAIVW capaz de operar como origem canônica ou como
espelho de uma origem EVM/Solana. A implementação é incremental; o estado deste
marco cobre o schema base, autenticação de atestações, inicialização do registry
e registros de origem para domínios e provedores com pagamento SPL atômico.

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
| `RegistryConfig` | `['registry-config']` | Governança, oráculo, mint/token program, fees, delays e tiers |
| `DomainRecord` | `['domain', domain_hash]` | Estado de domínio `Origin` ou `Mirror` |
| `OriginClaimReceipt` | `['origin-claim', domain_hash, nonce]` | Consumo append-only de uma autorização global |
| `StakeVault` | `['stake-vault', domain_hash]` | Metadados e contabilidade da caução isolada |

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

`verify_attestation` continua disponível como verificação sem mutação. As
instruções `register_domain` e `register_provider` fazem o consumo persistente
criando `OriginClaimReceipt`; portanto, somente elas oferecem proteção contra
replay de cadastro.

## Inicialização e registros de origem

`initialize_registry` cria uma única configuração no PDA global, fixa o SPL
Token Program clássico, mint e decimals, e valida roles, fees, delays e tiers.

`register_domain` exige `OriginClaimV1`, cria domínio/recibo/vault atomicamente e
transfere exatamente `standardFee`: 10% para o founder vault, 25% para o treasury
vault e o restante para o stake vault do domínio. `register_provider` também
exige o claim, mas transfere 100% do `requiredStake` do tier para o stake vault e
grava seu limite diário. Lamports de rent nunca são lidos como caução.

O layout normativo de `payloadHash` está em
[`SOLANA_REGISTRATION_PAYLOAD_V1.md`](../specs/multichain/SOLANA_REGISTRATION_PAYLOAD_V1.md).
