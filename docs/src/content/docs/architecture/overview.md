---
title: Visão geral da arquitetura
description: Componentes, responsabilidades e fronteiras de confiança do MAIVW.
---

O MAIVW combina um registro EVM de domínios com transporte HTTP entre Gateways e uma ponte para e-mail legado. O objetivo é permitir operação própria da infraestrutura e descoberta de identidades sem depender exclusivamente do endereço IP do remetente.

## Componentes

| Componente | Responsabilidade |
| --- | --- |
| `contracts/` | Registry atualizável por proxy UUPS, governança, stakes e Lens de leitura |
| `gateway/` | API Fastify, assinatura, descoberta, entrega P2P, SMTP e armazenamento |
| `webmaivw/` | Webmail, onboarding e administração em Next.js |
| `dashboard/` | Consultas de status, métricas e dados do Registry |
| `docs/` | Documentação Astro/Starlight |
| PostgreSQL | Usuários, domínios, mensagens, configurações e cofre de chaves |
| Redis | Cache e coordenação de roteamento |
| Diretório de anexos | Arquivos e metadados persistidos fora do PostgreSQL |

## Fluxo de uma mensagem

1. O usuário ou integração envia conteúdo ao Gateway de origem.
2. O Gateway resolve o domínio, considerando registro, rotas privadas e pools configurados.
3. Para P2P, assina `text` e `html` com a chave do domínio e envia JSON ao receptor.
4. O receptor verifica assinatura, identidade e suas políticas e persiste a mensagem.
5. A resposta HTTP informa aceite pelo Gateway. Não é um recibo assinado pelo destinatário nem prova de leitura.
6. Para destinos legados, o Gateway usa o adaptador de saída configurado.

## Fronteiras de confiança

O operador controla banco, anexos e chaves do Gateway. As mensagens não são E2EE: os Gateways processam conteúdo legível. HTTPS deve proteger o transporte público, e seu certificado precisa ser configurado no proxy. O Compose não instala certificados.

O Registry pode ser atualizado por governança, e suas chaves e endpoints podem mudar por operações autorizadas. Descrevê-lo como identidade absolutamente imutável esconderia essas permissões.

Consulte o [estado dos recursos](/status/), a [especificação P2P](/developers/p2p-handshake-spec/) e a [matriz de segurança](/developers/security-matrix/).
