# MAIVW Registry para Solana

Workspace Anchor do Registry MAIVW capaz de operar como origem canônica ou como
espelho de uma origem EVM/Solana. A implementação é incremental; o estado deste
marco cobre o schema base, autenticação de atestações, inicialização do registry
e registros de origem para domínios e provedores com pagamento SPL atômico,
warnings, slashing escalável, atualizações administrativas de domínio e criação
de mirrors externos somente leitura.

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
| `SubIdentityStrike` | `['sub-identity-strike', domain_hash, global_domain_epoch_le, sub_identity_hash]` | Contador de warnings por subidentidade e titular/epoch |
| `SlashCase` | `['slash-case', domain_hash, global_domain_epoch_le]` | Proposta, timelock, veto e resultado auditável do slash |
| `ReporterPool` | `['reporter-pool', domain_hash, global_domain_epoch_le]` | Raiz Merkle e contabilidade pull-payment das recompensas |
| `ReporterClaim` | `['reporter-claim', reporter_pool, reporter]` | Recibo único que impede saque duplicado por reporter |
| `PendingAdmin` | `['pending-admin', domain_hash, global_domain_epoch_le]` | Proposta two-step de rotação da chave administrativa |
| `RecoveryCase` | `['recovery-case', domain_hash, global_domain_epoch_le]` | Pedido, timelock, cancelamento e execução de recovery |
| `RecoveryReceipt` | `['recovery-receipt', domain_hash, nonce]` | Consumo append-only da autorização do oracle |
| `IntentBatch` | `['intent-batch', domain_hash, global_domain_epoch_le, batch_nonce]` | Raiz Merkle única por nonce explícito e epoch |
| `MirrorAttestationReceipt` | `['mirror-attestation', domain_hash, nonce]` | Consumo append-only de uma atestação de mirror |

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

`issue_warning` exige a assinatura direta do oracle configurado, incrementa os
contadores agregado e por subidentidade, cobra
`min(penaltyPerStrike, currentStake)` do stake vault para o treasury vault e
suspende o provider quando o saldo fica abaixo do mínimo do tier. Warnings podem
continuar drenando um provider suspenso. `top_up_stake` aceita aporte SPL de
qualquer signer, mas uma recarga parcial não reativa: é preciso recompor todo o
`requiredStake`. Ambas as instruções incrementam `originSequence`.

Tokens enviados diretamente ao ATA do stake vault sem passar pelo programa são
tratados como excedente não contabilizado: satisfazem solvência, mas não elevam
`currentStake`. Isso impede que depósitos não solicitados bloqueiem as operações
e evita que terceiros alterem a caução canônica fora de `top_up_stake`.

## Atualizações administrativas do domínio

`update_mail_key`, `update_endpoint` e `update_tls_fingerprint` aceitam somente
a assinatura da `admin_key` Ed25519 gravada no domínio. A chave operacional não
pode rotacionar a si própria. As instruções exigem Registry ativo, registro
`Origin` local em status `Active` e o PDA canônico do domínio; mirrors e domínios
suspensos ou revogados são somente leitura.

A nova mail key deve ser diferente de zero e o endpoint deve conter de 1 a 512
bytes. O fingerprint TLS ocupa 32 bytes; zero representa remoção explícita do
fingerprint. Cada mutação atualiza `updatedAt`, incrementa exatamente uma vez o
`originSequence` e emite evento com `globalDomainEpoch` e a nova sequence para
ordenamento dos mirrors.

`propose_domain_admin` exige a chave administrativa atual, rejeita candidato
nulo ou igual ao admin vigente e grava a proposta no `PendingAdmin` do epoch
corrente. Uma nova proposta do mesmo admin substitui a anterior. A troca só se
torna canônica quando a pubkey candidata assina `accept_domain_admin`; nesse
momento a sequence é incrementada e a proposta fica marcada como aceita.

O aceite confere que `proposed_by` ainda corresponde ao admin atual. Como o PDA
inclui `globalDomainEpoch` e o handler exige igualdade com o epoch do domínio,
recovery ou reclaim invalidam propostas antigas sem permitir aceite tardio.

## Recovery

`request_recovery` aceita uma atestação Ed25519 do oracle apresentada por
qualquer relayer. A prova vincula domínio, epoch, sequence corrente, nonce e as
novas chaves; um `RecoveryReceipt` imutável impede replay mesmo se o pedido for
cancelado ou substituído. O caso fica pendente até
`recoveryDelaySeconds`.

O admin corrente pode chamar `cancel_recovery` durante o timelock, inclusive
quando o Registry está pausado. Após o prazo, `execute_recovery` é permissionless
e exige que o domínio ainda seja uma origem ativa no mesmo epoch. A execução
troca admin e chave operacional, incrementa o epoch e inicia a nova versão em
`originSequence = 1`, invalidando propostas vinculadas ao epoch anterior.

O layout assinado está em
[`SOLANA_RECOVERY_PAYLOAD_V1.md`](../specs/multichain/SOLANA_RECOVERY_PAYLOAD_V1.md).

## Reclaim

`reclaim_domain` só aceita uma origem suspensa ou revogada e exige um novo
`OriginClaim` com prova DNS, ação `ReclaimOrigin`, nonce inédito e payload
vinculado ao titular, perfil, epoch/sequence correntes, pagamento e mint. A
caução contabilizada residual volta ao ATA do admin anterior e o novo titular
paga integralmente a nova taxa ou stake.

A instrução fecha explicitamente propostas `PendingAdmin`, `RecoveryCase` e
`SlashCase` ainda pendentes no epoch anterior, redefine strikes/provider/TLS,
incrementa o epoch e inicia `originSequence = 1`. Estados terminais permanecem
auditáveis e não podem operar no novo epoch.

O formato normativo está em
[`SOLANA_RECLAIM_PAYLOAD_V1.md`](../specs/multichain/SOLANA_RECLAIM_PAYLOAD_V1.md).

## Intent batches

`register_intent_batch` aceita a chave operacional, o admin ou o oracle de um
domínio `Origin` ativo. O publicador escolhe um nonce `bytes32` não nulo; o PDA
inclui domínio, epoch e nonce e é criado com `init`, tornando duplicidade uma
falha estrutural. A classe contém de 1 a 32 bytes e a raiz Merkle não pode ser
nula. Cada batch incrementa `originSequence` e persiste publicador e timestamp.

O layout e as regras estão em
[`SOLANA_INTENT_BATCH_V1.md`](../specs/multichain/SOLANA_INTENT_BATCH_V1.md).

## Registro de mirror

`register_mirror` aceita uma `StateAttestationV1/RegisterMirror` assinada pelo
oracle e cria atomicamente o `DomainRecord` somente leitura e o recibo de nonce.
A origem precisa ser um deployment externo; domínio, destino, epoch, sequence,
payload e transação de origem ficam cobertos pelo envelope. Chaves EVM mantêm o
endereço secp256k1 com padding canônico, enquanto chaves Solana permanecem
Ed25519, sem aliases ou casts.

O mirror não cria `StakeVault` nem transfere SPL. Stake e limite diário
atestados são campos informativos; o stake local permanece zero. O relayer paga
somente transaction fee e rent. O payload de 448 bytes é compatível com
`MAIVWMirrorRegistryV2.hashMirrorStateV2` e está especificado em
[`SOLANA_MIRROR_STATE_V2.md`](../specs/multichain/SOLANA_MIRROR_STATE_V2.md).

`sync_mirror` exige a mesma origem imutável do cadastro e aceita apenas uma
versão lexicograficamente superior em `(globalDomainEpoch, originSequence)`.
Versões iguais, regressões e troca de origem falham antes de qualquer mutação.
Cada atualização consome um novo `MirrorAttestationReceipt`, substitui todo o
estado replicado de forma atômica e conserva o stake local em zero.

`revoke_mirror` aplica somente um payload `Revoked` de versão superior e mantém
o `DomainRecord` como tombstone. A origem, versão e referência da transação
continuam auditáveis; o registro permanece `Mirror`, portanto não pode executar
operações locais nem `reclaim_domain`. Uma reativação posterior exige
`sync_mirror` da mesma origem com uma versão ainda maior.

## Slashing escalável

`propose_slash` exige o oracle configurado e cria uma proposta vinculada ao
domínio, ao `globalDomainEpoch`, a um nonce e à raiz Merkle dos reporters. A
execução só é possível depois de `slashDelaySeconds`; durante o timelock,
guardian ou authority podem chamar `veto_slash`. Após o prazo,
`execute_slash` é permissionless, revoga o domínio, move apenas o pool agregado
para um vault próprio e queima o restante do stake contabilizado.

O custo de `execute_slash` é constante: nenhuma lista de reporters atravessa a
transação. Cada reporter prova sua folha e chama `claim_reporter_reward`; o PDA
`ReporterClaim` torna o saque único. Claims legitimados continuam disponíveis
mesmo se o Registry for pausado. Provas têm no máximo 16 hashes, cobrindo até
65.536 reporters sem crescimento não limitado da instrução.

O formato normativo da árvore está em
[`SOLANA_REPORTER_MERKLE_V1.md`](../specs/multichain/SOLANA_REPORTER_MERKLE_V1.md).

O layout normativo de `payloadHash` está em
[`SOLANA_REGISTRATION_PAYLOAD_V1.md`](../specs/multichain/SOLANA_REGISTRATION_PAYLOAD_V1.md).
