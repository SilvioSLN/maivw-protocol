---
title: Economia do Registry Solana
description: Política de taxa, caução, rent, slashing e vaults para domínios cuja origem é Solana.
---

## Status da decisão

**Aceita para o MVP em 13 de outubro de 2026.** Valores absolutos permanecem configuráveis pela governança; o ativo, a unidade contábil e os percentuais abaixo são invariantes da primeira versão.

## Ativos e unidade contábil

- Taxas, cauções, penalidades e recompensas usam um único **SPL Token** configurado no `RegistryConfig`.
- O MVP aceita somente o SPL Token Program clássico. Token-2022 e mints com extensões entram em uma versão posterior, após análise específica de transfer fees, hooks e congelamento.
- O `RegistryConfig` fixa `mint`, `tokenProgram` e `decimals`. Cada transferência usa unidades inteiras mínimas e valida os três valores contra a conta do mint.
- SOL paga somente transaction fees e rent-exemption. SOL nunca compõe taxa, caução, bounty ou saldo de protocolo.
- O mint não pode ser trocado no mesmo config. Uma mudança exige uma nova versão do Registry, plano público de migração e vaults separados; saldos de mints diferentes nunca são somados.

Essa escolha evita que variações de rent ou preço do SOL alterem silenciosamente a caução econômica. Em devnet e testes, usa-se um mint próprio com a mesma quantidade de casas decimais configurada para o deploy.

## Quem paga cada custo

| Operação | SPL Token | SOL para transação/rent |
| --- | --- | --- |
| Registrar domínio de origem | Registrante | Registrante ou relayer patrocinador |
| Registrar provedor de origem | Provedor | Provedor ou relayer patrocinador |
| Atualizar estado da origem | Nenhum, salvo operação econômica explícita | Signer ou relayer |
| Criar/sincronizar mirror | Nenhum no MVP | Relayer |
| Denunciar | Nenhum depósito no MVP | Denunciante ou relayer |
| Executar julgamento/slash | Sai do vault de stake | Executor/relayer |

O patrocínio de SOL é uma decisão operacional e não transfere propriedade do domínio. Rent deve permanecer contabilmente separado da caução.

## Registro de empresa comum

O pagamento exato de `standardFee` é recebido atomicamente e separado assim:

| Destino | Percentual |
| --- | ---: |
| Founder vault | 10% |
| Treasury vault | 25% |
| Domain stake vault | 65% |

Os cálculos usam basis points com denominador `10_000`. Founder recebe `1_000`, treasury `2_500` e stake recebe o restante da operação, evitando saldo não contabilizado por arredondamento.

## Registro de provedor

Cada tier define `requiredStake`, `dailyLimit` e `penaltyPerStrike` em unidades mínimas do mint. O valor pago precisa ser exatamente `requiredStake` e **100% vira caução**, em paridade com o Registry EVM atual. Não há split founder/treasury no registro de provider.

Uma advertência cobra `min(penaltyPerStrike, currentStake)` e credita o treasury vault. Quando a caução chega a zero, o provedor é suspenso. Top-up aceita somente o mint configurado e não altera tier ou limite por si só.

## Slashing, bounty e burn

O slash remove toda a caução do domínio e calcula:

```text
reporterPool = min(originalRegistrationAmount × 10%, currentStake)
perReporter = floor(reporterPool / reporterCount)
distributed = perReporter × reporterCount
burned = currentStake - distributed
```

- Reporters devem estar ordenados, ser únicos e respeitar o limite do programa.
- Sem reporter válido, toda a caução é queimada.
- O resto de divisão também é queimado; não fica preso em vault.
- A queima usa a instrução `BurnChecked` do SPL Token Program a partir do stake vault. Enviar tokens a uma carteira sem chave não conta como burn.
- Bounties são creditados em contas de retirada (`ReporterCredit`) e sacados pelo beneficiário, seguindo o modelo pull-payment.

Essa regra preserva a semântica econômica EVM: no domínio comum, até 10% do pagamento original vai aos reporters e o restante dos 65% de stake é queimado; no provider, o mesmo teto de 10% do valor original se aplica e o restante da caução é queimado.

## Vaults e solvência

O programa mantém autoridades PDA e token accounts separadas para:

- founder fees;
- treasury fees e penalidades;
- stake por domínio;
- créditos de reporters.

O saldo atribuído a uma finalidade não pode ser sacado por outra. Toda instrução econômica valida mint, token program, owner, authority PDA e associated token account esperada. Mirrors não possuem stake local e nunca participam de slash local.

## Governança

`standardFee`, tiers e penalidades podem mudar apenas por authority/timelock e afetam operações futuras. Percentuais, mint e token program não mudam in-place no MVP. Pausa bloqueia novas entradas e julgamentos, mas não bloqueia retiradas já legitimamente creditadas.

## Critérios de aceite

Os testes do programa devem provar conservação de saldo, segregação de vaults, validação do mint, arredondamento, zero reporters, reporter duplicado, burn real, suspensão por stake zero e impossibilidade de contabilizar lamports de rent como caução.
