---
title: Catálogo de origem e concorrência
description: Reserva global, prevenção de origem duplicada e recuperação do onboarding multichain.
---

## Status da decisão

**Aceita para o MVP em 13 de outubro de 2026.** O catálogo é a autoridade de coordenação para escolher a primeira rede de origem; o Registry da rede escolhida continua sendo a autoridade do estado do domínio.

## Invariantes

1. Um `domainHash` tem no máximo uma reserva utilizável ou origem ativa.
2. Uma origem ativa nunca expira e não é liberada por slash, suspensão ou mudança de dono do DNS.
3. Reclaim ocorre na mesma rede e Registry da origem existente.
4. Um mirror não pode reservar, reivindicar nem assumir a origem.
5. Todo `OriginClaimV1` referencia exatamente uma reserva, rede, Registry, registrante, nonce e deadline.
6. Toda transição grava um evento append-only na mesma transação do estado atual.
7. Tokens DNS, assinaturas e segredos não são persistidos em texto puro; somente hashes e metadados necessários à auditoria.

## Máquina de estados

```text
AVAILABLE
   └─ DNS validado + reserva atômica ─> RESERVED
                                      ├─ claim assinado ─> CLAIM_ISSUED
                                      │                    ├─ tx finalizada ─> ACTIVE
                                      │                    └─ prazo + margem ─> EXPIRED
                                      ├─ prazo sem claim ─> EXPIRED
                                      └─ cancelamento seguro ─> CANCELLED

ACTIVE ── slash/suspensão/reclaim ──> ACTIVE (mesma origem; muda epoch/estado on-chain)
```

`AVAILABLE` é ausência de linha bloqueante, não um status persistido. `ACTIVE` é terminal quanto à rede de origem no MVP.

## Persistência

O catálogo usa PostgreSQL como fonte transacional, com os seguintes conceitos:

### `OriginRecord`

- `domainHash` único;
- domínio canônico;
- `originNetworkId` e `originRegistryId` tipados;
- `originVersion`, inicialmente `1`;
- status `ACTIVE`;
- referência da transação finalizada, epoch e sequence observadas;
- timestamps de ativação e última reconciliação.

### `OriginReservation`

- UUID público da reserva e `domainHash`;
- rede e Registry escolhidos;
- identificador tipado do registrante;
- hash do desafio DNS validado;
- nonce criptograficamente aleatório;
- `expiresAt`, `claimDeadline` e `holdUntil`;
- status `RESERVED`, `CLAIM_ISSUED`, `CONSUMED`, `EXPIRED` ou `CANCELLED`;
- chave de idempotência e request ID.

Uma constraint parcial única bloqueia mais de uma reserva nos estados `RESERVED`/`CLAIM_ISSUED` por `domainHash`. `OriginRecord.domainHash` também é único. A criação consulta e altera ambos dentro de uma transação serializável; conflito de unicidade é convertido em `ORIGIN_ALREADY_RESERVED` ou `ORIGIN_ALREADY_ACTIVE`, nunca em uma segunda emissão.

### `OriginClaimIssuance`

- digest da atestação e versão do codec;
- hash dos bytes assinados;
- signer key ID/version, sem material privado;
- deadline, nonce e reserva;
- status de submissão/consumo;
- referência on-chain quando observada.

O digest e o nonce são únicos. Repetir a mesma chave de idempotência devolve a mesma emissão; tentar mudar qualquer campo sob a mesma chave retorna conflito.

### `OriginAuditEvent` e outbox

Cada transição acrescenta ator, ação, estado anterior/novo, request ID, hashes relevantes e timestamp de banco. A mesma transação insere um evento de outbox. Workers publicam/processam a outbox com deduplicação pelo ID do evento; logs derivados não substituem o histórico do banco.

## Reserva depois da prova DNS

Gerar um desafio não bloqueia o domínio. A reserva ocorre somente depois de validar o TXT e inclui a rede de origem escolhida pelo usuário:

1. Gateway emite desafio vinculado a domínio, conta, rede e expiração.
2. O usuário publica o TXT.
3. Gateway valida o TXT por resolvers independentes conforme a política do oráculo.
4. Em uma transação, expira reservas antigas elegíveis e tenta inserir a nova reserva.
5. O signer emite o claim apenas para a reserva confirmada.
6. O cliente ou relayer envia a transação à rede escolhida.
7. O observer relê o estado finalizado e ativa `OriginRecord`.

O desafio DNS não é uma trava e pode existir em mais de um navegador. A constraint de reserva é a decisão final.

## Corridas e idempotência

### Duas redes ao mesmo tempo

A primeira transação de reserva válida que fizer commit vence. A segunda recebe `409 ORIGIN_ALREADY_RESERVED`, com rede escolhida e expiração, mas sem dados sensíveis do reservante. Não se usa timestamp do cliente, ordem de chegada HTTP nem consulta prévia como mecanismo de exclusão.

### Repetição do mesmo pedido

O cliente envia uma chave de idempotência. Mesmo domínio, conta, rede e payload devolvem a reserva existente. A mesma chave com payload diferente retorna `409 IDEMPOTENCY_MISMATCH`.

### Expiração e transação em voo

Uma reserva sem claim expira em `expiresAt`. Depois da emissão, ela permanece bloqueante até `holdUntil`, calculado como o deadline do claim mais a margem máxima de finalidade/reorg da rede. O contrato/programa rejeita claims vencidos; o catálogo não libera outra origem enquanto uma transação antiga ainda puder finalizar validamente.

### Confirmações contraditórias

Se observers detectarem duas origens on-chain para o mesmo domínio, o catálogo não escolhe uma delas. Ele ativa o circuit breaker, bloqueia novos claims/mirrors para o domínio e exige reconciliação de incidente com evidências preservadas.

## Recuperação e alta disponibilidade

- Instâncias do Gateway e workers são stateless; a exclusão mútua está no PostgreSQL.
- Todas usam um único writer lógico. Réplicas de leitura não autorizam reserva nem emissão.
- Workers podem reiniciar e retomar `RESERVED`, `CLAIM_ISSUED` e eventos de outbox sem repetir assinatura ou ativação.
- Um reconciliador busca claims próximos do prazo, consulta a rede diretamente e decide entre `CONSUMED` e `EXPIRED`.
- Backups incluem catálogo e audit log; point-in-time recovery deve ser habilitado em produção.
- Após restauração, emissão fica pausada até reconciliar o catálogo com todos os Registries.
- Indisponibilidade do writer falha fechada: consultas continuam, mas novas origens aguardam.

### Garantias de Reorg e Crash Recovery (SM-081)

O pipeline de relayers e projeções multichain implementa salvaguardas formais contra forks, interrupções inesperadas e colisões:

1. **Reorg Raso (Pré-Submissão):** se um bloco ou slot na origem sofrer reorg antes do envio aos destinos, o job e seus mirrors em preparação são transicionados deterministicamente para `ORPHANED`. Nenhum broadcast fantasma é emitido.
2. **Reorg Profundo (Pós-Submissão):** se a reorganização ocorrer após transações já terem sido submetidas ou confirmadas em destinos externos, o job é classificado como `COMPENSATION_REQUIRED`. Registros de compensação duráveis são anexados com auditoria encadeada, preservando a evidência histórica para reconciliação e impedindo regressão de `globalDomainEpoch` ou `originSequence`.
3. **Resiliência a Falhas e Crash Recovery:**
   - **Lease Timeout:** workers adquirem exclusividade de envio sob lease temporário (`leaseUntil`). Se um worker cair durante a preparação, o job é liberado para um worker sucessor somente após o término do lease.
   - **Idempotência Pós-Broadcast:** se a queda ocorrer após a transmissão mas antes da confirmação de finalidade, a retomada identifica o estado `BROADCAST` e monitora a transação existente (`expectedTransactionId`), evitando submissões redundantes ou quebra de nonces.
   - **Monotonicidade Anti-Regressão:** eventos com sequências obsoletas ou regressões de epoch são rejeitados com `ORIGIN_VERSION_REGRESSION`.

## Transferência de origem

Transferência é **desabilitada no MVP**. O schema reserva `originVersion` e permite registrar um predecessor futuro, mas não existe endpoint, instrução, papel administrativo ou atestação capaz de mudar `originNetworkId`/`originRegistryId` de um `OriginRecord` ativo.

Uma futura versão exigirá protocolo two-phase, janela de contestação e tombstone na origem antiga. Até lá, nem governança, recuperação, novo dono do DNS, slash, reclaim ou promoção de mirror muda a rede de origem.

## Critérios de teste

- corrida concorrente entre Solana e EVM produz um vencedor;
- retry idêntico devolve o mesmo ID/digest;
- retry divergente falha;
- claim em voo impede re-reserva até a margem de finalidade;
- reserva expirada pode ser substituída atomicamente;
- `ACTIVE` não expira e só aceita reclaim na mesma origem;
- falha entre update e audit/outbox faz rollback de tudo;
- restart retoma outbox e reconciliação sem duplicar claims;
- detecção de duas origens aciona circuit breaker;
- reorg raso marca `ORPHANED` e reorg profundo ativa `COMPENSATION_REQUIRED` com compensações duráveis (SM-081);
- recuperação pós-crash retoma lease sem duplicar broadcast e bloqueia regressão de versão (SM-081).
