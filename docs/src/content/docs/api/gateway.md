---
title: API do Gateway
description: Mensagens, anexos, autenticação e diagnóstico da implementação atual.
---

Base do Compose local: `http://localhost:51443`. Envie JSON, salvo indicação explícita. Os exemplos usam placeholders e exigem identidades, contratos e credenciais configurados.

Veja também [contas e onboarding](/api/accounts/), [SMTP e administração](/api/operations/) e o [inventário de rotas](/api/routes/).

## Autenticação atual

Sessões usam `Authorization: Bearer <JWT>`. API keys emitidas pelo cofre têm prefixo `maivw_live_` ou `maivw_test_`; utilize a chave integral retornada, não a representação mascarada exibida na listagem.

**Não há middleware global que proteja toda a API.** `/send` exige API key de domínio verificado ou sessão de caixa ativa e vincula o remetente à credencial. As rotas `/inbox/messages` e `/inbox/trash/empty` exigem JWT de usuário existente com caixa ativa; o e-mail da consulta não concede acesso. Comparações de endereço são exatas, sem correspondência parcial. Dados antigos com nome de exibição junto ao endereço precisam ser normalizados antes de aparecer nessas consultas. Upload/download também não implementam autorização de proprietário. Esses comportamentos são lacunas, não formas recomendadas de autenticação. Mantenha a API em ambiente restrito enquanto a revisão está pendente.

## Envio

### `POST /api/v1/send`

Campos obrigatórios: `to` (e-mail), `subject` (1–998 caracteres), `msgClass`, `content.text` não vazio. `content.html`, `content.attachments`, `from`, `senderEmail`, `senderDomain`, `subIdentityId` e `recipients` são opcionais.

Classes: `TX_CODE`, `TX_RECEIPT`, `SUPPORT`, `CONVERSATION`, `MARKETING`, `COLD_OUTREACH`.

```json
{
  "from": "alice@example.com",
  "to": "bob@example.org",
  "subject": "Teste de integração",
  "msgClass": "CONVERSATION",
  "content": { "text": "Olá", "html": "<p>Olá</p>" }
}
```

Envie `Authorization: Bearer TOKEN`. Com API key, o domínio local deve estar verificado e o remetente deve pertencer a esse domínio. Com JWT, o remetente deve ser exatamente o e-mail da caixa ativa; JWT administrativo não envia como colaborador. `from`/`senderEmail` aceitam endereço simples, sem nome de exibição; se ambos forem enviados, devem coincidir. O campo `senderDomain` não pode substituir o domínio autorizado. Não use `recipients` como garantia de envio a todos os destinatários: o código atual usa esse campo na árvore Merkle, sem fan-out completo.

No sucesso, a resposta `200` contém `success`, `messageId`, `route` (`web3` ou `smtp`), `recipientDomain` e `message`. Aceite pelo Gateway/provedor não comprova leitura nem entrega definitiva. Erros incluem payload inválido (`400`), API key inválida (`401`), endpoint não encontrado (`502`) e falhas de entrega.

## Caixa postal

### `GET /api/v1/inbox/messages`

Use JWT da caixa postal, não da conta administrativa. Queries: `limit` (1–200, padrão 50), `folder` (`inbox`, `sent`, `trash`, `spam`, `quarantine`) e `isLegacy` (`true`/`false`). `total` é a quantidade de itens retornados, enquanto `counts` contém contadores das pastas. As mensagens incluem `id`, `messageId`, `from`, `to`, `subject`, `body`, `msgClass`, `status`, `isLegacy`, `isRead` e `receivedAt`.

### `PATCH /api/v1/inbox/messages/:id`

```json
{ "isRead": true, "status": "trash" }
```

Use JWT da caixa ativa. `status` aceita `trash`, `spam` ou `quarantined`; `isRead` aceita booleano. A mensagem deve corresponder exatamente ao endereço da sessão.

### `PATCH /api/v1/inbox/messages/:id/restore`

Restaura a mensagem conforme o estado tratado pelo backend.

### `DELETE /api/v1/inbox/messages/:id`

Move para a lixeira. Se já estiver na lixeira, ou com `?permanent=true`, exclui permanentemente. Exige sessão da caixa.

### `DELETE /api/v1/inbox/trash/empty`

Solicita esvaziamento da lixeira. Não use como operação de diagnóstico.

## P2P

### `POST /api/v1/inbox`

Recebe o envelope assinado de outro nó. Cabeçalhos, serialização e limitações da prova estão na [especificação P2P](/developers/p2p-handshake-spec/). O retorno `202` representa aceite pelo Gateway.

## Anexos

### `POST /api/v1/attachments/upload`

Recebe **JSON/Base64**, não multipart:

```json
{ "filename": "teste.txt", "mimeType": "text/plain", "dataBase64": "T2xh" }
```

O retorno `201` contém `success: true` e `attachment` com `id`, `filename`, `size`, `mimeType`, `sha256` e `url`. Use esse objeto em `content.attachments`.

O handler possui verificação de 25 MiB por arquivo decodificado, mas o limite HTTP do Fastify/proxy pode rejeitar a requisição antes. O Gateway não configura um `bodyLimit` específico para permitir esse tamanho. Não anuncie 25 MB efetivamente suportados sem ajustar e testar toda a cadeia.

### `GET /api/v1/attachments/:id/download`

Retorna o arquivo com `Content-Type`, `Content-Disposition` e `x-maivw-sha256`. A URL relativa retornada precisa ser resolvida contra o Gateway que armazena o anexo. Hash de arquivo não equivale a criptografia nem a autorização de acesso; a assinatura atual da mensagem não cobre seus metadados.

## Diagnóstico

### `GET /health/live`

Retorna `200` e `status: "alive"` se o servidor HTTP responde.

### `GET /health`

Consulta Registry, Redis e PostgreSQL com prazo limitado. Retorna `200`/`status: "ok"` ou `503`/`status: "degraded"`. Os campos `blockchain`, `redis` e `database` indicam cada dependência. Inclui metadados SMTP, endereço/modo do oráculo e `contractAddress`.

`oracleBalanceWei` e `oracleBalanceLow` são `null` quando não foi possível consultar saldo. Saldo baixo é informativo e não muda sozinho o HTTP status. Saúde não certifica autorização on-chain, SMTP funcional ou segurança da API.

### `GET /api/v1/status`

Retorna versão informada pelo Gateway, remetente padrão, assinante e dados do Registry. Métricas de outras rotas podem conter fallbacks de demonstração; não as trate automaticamente como observabilidade auditada.

## Contatos

`GET /api/v1/contacts/autocomplete` exige sessão de caixa ativa. `q` filtra sugestões; `domain`, se enviado, deve ser o domínio da própria caixa. O diretório exclui contas desativadas e conversas recentes usam comparação exata do endereço autenticado.
