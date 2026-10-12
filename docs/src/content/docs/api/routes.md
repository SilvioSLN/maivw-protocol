---
title: Inventário de rotas
description: Métodos e caminhos registrados no código do Gateway, agrupados por módulo.
---

Inventário estático de **84 rotas**. Gerado por `npm run docs:routes`; não equivale a uma especificação OpenAPI nem a uma auditoria de autorização. O link de cada módulo aponta para seu código no repositório.

Consulte [mensagens e anexos](/api/gateway/), [contas e onboarding](/api/accounts/) e [SMTP e administração](/api/operations/) para entradas e limites.

## Política de acesso por área

| Área | Situação atual |
| --- | --- |
| Contas, API keys e configurações | Autorização parcial; mensagens exigem usuário/caixa ativa, criação local de domínio retorna 410 |
| Send | API key de domínio verificado ou JWT de caixa ativa; remetente vinculado à credencial |
| Inbox P2P | Assinatura de conteúdo e políticas do receptor; não usa sessão do Webmail |
| Onboarding | JWT administrativo, domínio próprio, desafio DNS e recibo; fulfill-registration suspenso (503) |
| Anexos | Não há autorização de proprietário no handler atual |
| Routing | JWT admin ou chave interna; isolamento entre organizações a revisar |
| Webhook | Segredo compartilhado só exigido quando configurado |
| Multichain | Proteção específica em fulfill-mirror; não há proteção uniforme do módulo |
| Stealth, economics, node e oracle | Sem proteção uniforme de sessão; manter administração privada |

## index.ts

[Fonte: gateway/src/index.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/index.ts)

| Método | Caminho |
| --- | --- |
| `GET` | `/api/v1/companies` |
| `GET` | `/api/v1/companies/:domain` |
| `GET` | `/api/v1/companies/stats` |
| `GET` | `/api/v1/reputation/:domain` |
| `GET` | `/api/v1/status` |

## attachments.ts

[Fonte: gateway/src/routes/attachments.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/attachments.ts)

| Método | Caminho |
| --- | --- |
| `GET` | `/api/v1/attachments/:id/download` |
| `POST` | `/api/v1/attachments/upload` |

## auth.ts

[Fonte: gateway/src/routes/auth.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/auth.ts)

| Método | Caminho |
| --- | --- |
| `GET` | `/api/v1/api-keys` |
| `POST` | `/api/v1/api-keys` |
| `DELETE` | `/api/v1/api-keys/:id` |
| `GET` | `/api/v1/auth/accounts` |
| `POST` | `/api/v1/auth/accounts` |
| `DELETE` | `/api/v1/auth/accounts/:id` |
| `POST` | `/api/v1/auth/google` |
| `POST` | `/api/v1/auth/login` |
| `GET` | `/api/v1/auth/me` |
| `POST` | `/api/v1/auth/register` |
| `GET` | `/api/v1/developer/logs` |
| `GET` | `/api/v1/domains` |
| `POST` | `/api/v1/domains` |
| `GET` | `/api/v1/inbox/messages` |
| `DELETE` | `/api/v1/inbox/messages/:id` |
| `PATCH` | `/api/v1/inbox/messages/:id` |
| `PATCH` | `/api/v1/inbox/messages/:id/restore` |
| `DELETE` | `/api/v1/inbox/trash/empty` |

## contacts.ts

[Fonte: gateway/src/routes/contacts.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/contacts.ts)

| Método | Caminho |
| --- | --- |
| `GET` | `/api/v1/contacts/autocomplete` |

## dispute.ts

[Fonte: gateway/src/routes/dispute.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/dispute.ts)

| Método | Caminho |
| --- | --- |
| `POST` | `/api/v1/dispute` |
| `POST` | `/api/v1/oracle/reclaim-proof` |
| `POST` | `/api/v1/report-spam` |

## economics.ts

[Fonte: gateway/src/routes/economics.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/economics.ts)

| Método | Caminho |
| --- | --- |
| `PUT` | `/api/v1/economics/endpoint` |
| `GET` | `/api/v1/economics/genesis` |
| `POST` | `/api/v1/economics/genesis-provider` |
| `GET` | `/api/v1/economics/governance` |
| `GET` | `/api/v1/economics/provider/:domain` |
| `GET` | `/api/v1/economics/tiers` |
| `POST` | `/api/v1/economics/topup` |

## health.ts

[Fonte: gateway/src/routes/health.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/health.ts)

| Método | Caminho |
| --- | --- |
| `GET` | `/health` |
| `GET` | `/health/live` |

## inbox.ts

[Fonte: gateway/src/routes/inbox.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/inbox.ts)

| Método | Caminho |
| --- | --- |
| `POST` | `/api/v1/inbox` |

## multichain.ts

[Fonte: gateway/src/routes/multichain.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/multichain.ts)

| Método | Caminho |
| --- | --- |
| `POST` | `/api/v1/multichain/attest-mirror` |
| `POST` | `/api/v1/multichain/fulfill-mirror` |
| `GET` | `/api/v1/multichain/networks` |
| `GET` | `/api/v1/multichain/status/:domain` |

## node.ts

[Fonte: gateway/src/routes/node.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/node.ts)

| Método | Caminho |
| --- | --- |
| `GET` | `/api/v1/node/telemetry` |

## onboarding.ts

[Fonte: gateway/src/routes/onboarding.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/onboarding.ts)

| Método | Caminho |
| --- | --- |
| `POST` | `/api/v1/onboarding/challenge` |
| `POST` | `/api/v1/onboarding/check-dns` |
| `POST` | `/api/v1/onboarding/claim-proof` |
| `POST` | `/api/v1/onboarding/complete` |
| `POST` | `/api/v1/onboarding/finalize-web3-registration` |
| `POST` | `/api/v1/onboarding/fulfill-registration` |
| `GET` | `/api/v1/onboarding/node-mode` |
| `POST` | `/api/v1/onboarding/verify-and-register` |

## oracle.ts

[Fonte: gateway/src/routes/oracle.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/oracle.ts)

| Método | Caminho |
| --- | --- |
| `GET` | `/api/v1/oracle/reports` |
| `GET` | `/api/v1/oracle/reports/:id` |
| `POST` | `/api/v1/oracle/reports/:id/human-action` |
| `POST` | `/api/v1/oracle/reports/simulate-incoming` |
| `POST` | `/api/v1/oracle/simulate` |
| `GET` | `/api/v1/oracle/status` |

## routing.ts

[Fonte: gateway/src/routes/routing.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/routing.ts)

| Método | Caminho |
| --- | --- |
| `DELETE` | `/api/v1/routing/nodes/:id` |
| `PUT` | `/api/v1/routing/nodes/:id` |
| `POST` | `/api/v1/routing/nodes/:id/reset-health` |
| `GET` | `/api/v1/routing/pools` |
| `POST` | `/api/v1/routing/pools` |
| `DELETE` | `/api/v1/routing/pools/:id` |
| `PUT` | `/api/v1/routing/pools/:id` |
| `POST` | `/api/v1/routing/pools/:poolId/nodes` |
| `GET` | `/api/v1/routing/rules` |
| `POST` | `/api/v1/routing/rules` |
| `DELETE` | `/api/v1/routing/rules/:id` |
| `PUT` | `/api/v1/routing/rules/:id` |
| `POST` | `/api/v1/routing/test-resolve` |

## send.ts

[Fonte: gateway/src/routes/send.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/send.ts)

| Método | Caminho |
| --- | --- |
| `POST` | `/api/v1/send` |

## settings.ts

[Fonte: gateway/src/routes/settings.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/settings.ts)

| Método | Caminho |
| --- | --- |
| `GET` | `/api/v1/settings/domain/:domainId` |
| `GET` | `/api/v1/settings/smtp` |
| `POST` | `/api/v1/settings/smtp` |
| `PUT` | `/api/v1/settings/smtp` |
| `GET` | `/api/v1/settings/smtp/presets` |
| `POST` | `/api/v1/settings/smtp/test` |
| `GET` | `/api/v1/settings/tls/:domain` |
| `POST` | `/api/v1/settings/tls/:domain` |

## stealth.ts

[Fonte: gateway/src/routes/stealth.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/stealth.ts)

| Método | Caminho |
| --- | --- |
| `GET` | `/api/v1/stealth/config/:domain` |
| `PUT` | `/api/v1/stealth/config/:domain` |
| `GET` | `/api/v1/stealth/routes` |
| `POST` | `/api/v1/stealth/routes` |
| `DELETE` | `/api/v1/stealth/routes/:targetDomain` |

## webhooks.ts

[Fonte: gateway/src/routes/webhooks.ts](https://github.com/SilvioSLN/maivw-protocol/blob/main/gateway/src/routes/webhooks.ts)

| Método | Caminho |
| --- | --- |
| `POST` | `/api/v1/webhooks/inbound-legacy` |

