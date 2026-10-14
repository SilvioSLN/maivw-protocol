# Solana Registry Governance V1

O estado operacional do Registry fica em `RegistryConfig.active`. A pausa é um
circuit breaker local: não muda a origem de nenhum domínio, não altera saldos e
não invalida direitos já adquiridos.

## Autoridade

| Instrução | Signers autorizados | Pré-condição |
| --- | --- | --- |
| `pause_registry` | `guardian` ou `authority` | Registry ativo |
| `unpause_registry` | somente `authority` | Registry pausado |

Chamadas repetidas são rejeitadas. Ambas as instruções validam o PDA e o schema
de `RegistryConfig` antes de alterar `active` e emitem eventos com signer e
timestamp. O guardian pode reagir rapidamente a incidentes, mas não pode
retomar o protocolo unilateralmente.

## Política durante a pausa

Instruções que criam obrigações, alteram estado canônico ou movimentam stake
ainda não adjudicado exigem `config.active = true`. Isso inclui registros,
mirrors, updates, top-up/warning, propostas e execução de slash, rotação admin,
recovery/reclaim e intent batches.

As seguintes saídas ou proteções já legitimadas permanecem disponíveis:

- `claim_reporter_reward`: o pool e a prova Merkle já definem o crédito; a
  instrução não depende do config ativo;
- `veto_slash`: guardian/authority ainda podem impedir um slash pendente;
- `cancel_recovery`: o admin vigente ainda pode cancelar um recovery pendente.

Pausa não permite criar novos créditos nem alterar a versão de domínio. Ela
também não concede poderes novos ao guardian ou à authority.

