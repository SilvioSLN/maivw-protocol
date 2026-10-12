---
title: SMTP, webhooks e administração
description: Integrações legadas e limites de acesso às rotas operacionais.
---

## SMTP de saída

`GET /api/v1/settings/smtp/presets` lista presets. As rotas de leitura/gravação de configuração verificam JWT administrativo e domínio. `GET /api/v1/settings/smtp?domainId=1` consulta configuração; `PUT` ou `POST /api/v1/settings/smtp` salva:

```json
{
  "domainId": 1,
  "provider": "smtp",
  "smtpHost": "smtp.example.com",
  "smtpPort": 587,
  "smtpSecure": false,
  "smtpUser": "USUARIO_DO_PROVEDOR",
  "smtpPass": "SEGREDO_DO_PROVEDOR",
  "fromEmail": "contato@example.com",
  "fromName": "Equipe"
}
```

Substitua host, credenciais e remetente pelos dados do provedor. Para Resend, use `provider: "resend"` e `apiKey`. `smtpSecure: false` não deve ser interpretado como garantia de TLS obrigatório; confirme o comportamento do adaptador e a política do servidor.

`POST /api/v1/settings/smtp/test` testa a configuração e pode enviar mensagem de teste. Use somente destinatário controlado. Campos IMAP existentes na configuração não comprovam sincronização IMAP implementada para todo provedor.

## Recebimento legado

`POST /api/v1/webhooks/inbound-legacy` recebe eventos adaptados de provedores e os persiste como mensagens legadas. Configure `LEGACY_WEBHOOK_SECRET` e envie `x-webhook-secret`; Bearer também é aceito. Se o segredo estiver vazio, o handler não exige autenticação — não exponha essa configuração.

Prefira cabeçalho ao parâmetro de URL aceito pelo legado, evitando segredos em logs. A validação de segredo compartilhado não é validação nativa de todas as assinaturas dos provedores; valide o formato e a origem na integração.

Resposta bem-sucedida: `201`, `status: "processed"`, `isLegacy: true`, dados da mensagem e classe legada. Não configure MX para o Gateway HTTP: entrada SMTP exige provedor/MTA e ponte apropriada.

## Roteamento e administração

As rotas `/api/v1/routing/*` incluem pools, nós, regras e teste de resolução. O handler aceita JWT com papel `admin` ou `x-internal-service-key`. A existência do papel não demonstra isolamento entre administradores de organizações diferentes; mantenha essa área privada.

As rotas de stealth configuram `targetDomain`, `privateEndpointUrl` e `stealthToken` opcional, mas não possuem proteção uniforme no handler atual. Não confunda esse token P2P com autenticação da API administrativa.

As rotas de economics, oráculo, multichain e node oferecem consultas e operações que dependem do contrato/configuração. Algumas não verificam sessão; `fulfill-mirror` usa chave interna. Consulte o [inventário completo](/api/routes/) antes de integrar e mantenha operações administrativas em rede restrita.

Parte da telemetria possui valores de demonstração e fallbacks. Eles precisam ser removidos ou identificados no produto antes de usar o Dashboard como base de SLA ou auditoria.
