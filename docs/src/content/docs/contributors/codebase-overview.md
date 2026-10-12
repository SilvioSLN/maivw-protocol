---
title: Mapa da base de código
description: Onde procurar contratos, rotas, serviços e interfaces.
---

| Diretório | Pontos de entrada |
| --- | --- |
| `contracts/src/` | Registry e Lens |
| `contracts/script/` | Deploy e verificação de auditoria |
| `contracts/test/` | Casos unitários, governança, segurança e invariantes |
| `gateway/src/index.ts` | Inicialização e registro de rotas |
| `gateway/src/routes/` | API; inventário em [rotas](/api/routes/) |
| `gateway/src/services/` | Ledger, assinatura, cofre, oráculo, SMTP e roteamento |
| `gateway/src/schemas/` | Payloads e classes de mensagem |
| `gateway/prisma/schema.prisma` | Modelo persistente |
| `gateway/test/` | Testes Node/TypeScript |
| `webmaivw/src/app/` | Páginas e proxy de imagens |
| `webmaivw/src/components/` | Composição e visualização de mensagens |
| `dashboard/src/app/` | Painel de consultas e telemetria |
| `docs/src/content/docs/` | Conteúdo público da documentação |

`LedgerService` faz resolução e integração EVM; `SignatureService` define os bytes assinados; `KeyManagementService` mantém o cofre do servidor. Não atribua E2EE ao cofre nem resolução wildcard à Lens.

O Dashboard inclui dados de demonstração/fallback em parte da telemetria. Confira a origem da métrica antes de tratá-la como medição real.

Consulte [arquitetura](/architecture/overview/) e [ambiente local](/contributors/local-setup/). Alterações de comportamento devem atualizar a referência correspondente e o estado dos recursos.
