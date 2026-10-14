---
title: Política de chaves e autoridades
description: Separação entre chave operacional, chave administrativa, oráculo e governança no Registry.
---

## Objetivo

O MAIVW separa credenciais de alta frequência de autoridades capazes de alterar a identidade do domínio. A mesma política deve ser aplicada nos Registries EVM e Solana.

## Poderes

| Autoridade | Uso esperado | Pode fazer |
| --- | --- | --- |
| Mail/public key (hot) | Serviço online de e-mail | Assinar mensagens e publicar intent batches |
| Admin key (cold) | Cofre ou multisig do domínio | Rotacionar hot key, endpoint, TLS e admin; cancelar recovery |
| Oracle | Serviço controlado de prova/julgamento | Autorizar registro/reclaim/recovery, emitir warning/slash e retransmitir batch |
| Guardian | Resposta emergencial | Pausar e vetar slash pendente |
| Protocol authority/owner | Multisig + timelock | Configuração, upgrade, unpause e tesouraria |

A hot key não pode rotacionar a si própria, mudar endpoint/TLS nem iniciar troca de admin. Assim, a exposição do serviço de envio não se transforma em tomada permanente do domínio.

Na origem Solana, intent batches aceitam a hot key, o admin ou o oracle como
relayer. O PDA inclui epoch e nonce explícito, impedindo duplicidade e evitando
que um batch do titular anterior seja confundido com o estado atual.

## Epoch e processos pendentes

Proposta de admin, recovery e slash são vinculados ao epoch corrente. Recovery e reclaim incrementam epoch e invalidam propostas anteriores. Slashing torna o domínio não ativo, impedindo aceite tardio de admin; reclaim também limpa explicitamente todo estado pendente.

Na origem Solana, recovery usa atestação Ed25519 do oracle vinculada também à
sequence corrente e às novas chaves. Um recibo append-only por nonce bloqueia
replay após cancelamento; o admin pode cancelar durante pause e a execução é
permissionless somente depois do timelock, enquanto o domínio permanecer ativo
no mesmo epoch.

O reclaim na origem Solana exige um novo `OriginClaim` com prova DNS e nonce
inédito. Ele libera a caução contabilizada ao admin anterior, cobra integralmente
o novo registro, fecha processos ainda pendentes e cria um novo epoch. Contadores
por subidentidade também incluem o epoch no PDA, impedindo que strikes do titular
anterior contaminem o novo perfil.

Na rotação administrativa Solana, o admin atual pode substituir uma proposta
pendente, mas não concluir a troca sozinho. O candidato deve assinar o aceite, e
o programa confere novamente epoch, estado ativo e identidade do admin que fez
a proposta. A sequence canônica muda somente no aceite.

## Mirrors

Chaves presentes em um mirror identificam o estado da origem, mas não concedem poder de escrita local. Atualização de chave, endpoint, TLS, admin, recovery e intent batch em mirror revertem. Somente uma atestação válida da mesma origem pode sincronizar ou revogar o mirror.

## Operação durante pausa

A pausa bloqueia novas operações de risco. Withdrawals já creditados permanecem disponíveis para evitar confisco operacional. Guardian não pode despausar nem fazer upgrade.

## Requisitos para Solana

- Cada chave usa algoritmo + bytes; Ed25519 e secp256k1 não são convertidas entre si.
- PDAs e signer constraints implementam a mesma matriz de poderes.
- Toda conta pendente inclui `domain`, `epoch` e bump validados.
- O programa rejeita instruções locais de mutação quando `recordKind == MIRROR`.
