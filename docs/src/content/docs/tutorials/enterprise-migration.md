---
title: Piloto e coexistência com e-mail legado
description: Planeje testes, entrada SMTP e critérios de retorno antes de migrar caixas.
---

A versão atual deve ser avaliada em piloto controlado. Não há migração automática comprovada de caixas Google Workspace/Microsoft 365 nem garantia de conformidade regulatória por instalar o MAIVW.

## Piloto

Escolha contas e parceiros de teste. Mantenha MX e caixas do provedor existente enquanto testa identidade on-chain, mensagens P2P e fallback SMTP. Configure encaminhamentos/webhooks somente após validar origem, formato e proteção de acesso.

DNS TXT de posse não substitui MX, SPF, DKIM ou DMARC do provedor. O Compose não inclui servidor SMTP de entrada nem sincronizador IMAP universal. Não prometa uma caixa unificada sem testar a integração escolhida.

## Critérios para ampliar uso

- Corrigir os bloqueios de autenticação, onboarding e integridade indicados em [estado dos recursos](/status/).
- Testar envio e recebimento nos dois sentidos, duplicação, falhas, anexos e recuperação.
- Medir capacidade e custos do ambiente, sem usar latências ou economias não medidas.
- Definir retenção, acesso administrativo, tratamento de denúncias e envio de conteúdo ao juiz remoto.
- Ensaiar [backup e restauração](/self-hosting/operations/) e registrar um plano de retorno ao provedor anterior.

Não remova o serviço existente até validar continuidade e acesso ao histórico. Assinatura técnica de conteúdo não resolve por si só fraude, comprometimento de conta, validade jurídica ou obrigações de compliance.
