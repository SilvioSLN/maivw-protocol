---
title: Visão Geral da Base de Código
description: Mapeamento detalhado dos módulos, pacotes e fluxo de responsabilidades dentro do monorepo MAIVW Protocol.
---

O repositório do **MAIVW Protocol** é organizado de forma modular orientado a responsabilidades, separando a lógica on-chain em contratos inteligentes (Solidity), o nó de comunicação (Gateway Fastify) e as aplicações de interface (Webmail e Dashboard).

---

## 📂 1. Estrutura de Diretórios

Após clonar o repositório `maivw-protocol`, as aplicações e módulos estão organizados diretamente na raiz:

```
maivw-protocol/
├── contracts/                # Smart contracts Solidity (Foundry)
│   ├── src/                  # Contratos de registro e resolução de domínios
│   ├── test/                 # Testes unitários e de integração Forge
│   └── script/               # Scripts de deploy (Anvil, Base Sepolia, Mainnet)
│
├── gateway/                  # Nó servidor Fastify / TypeScript
│   ├── src/
│   │   ├── routes/           # Endpoints HTTP (/api/v1/send, inbox, auth, stealth, etc.)
│   │   ├── services/         # Regras de negócio, filas e criptografia
│   │   │   ├── KeyManagementService.ts # Gestão de chaves ECDSA e KMS
│   │   │   ├── LedgerService.ts        # Integração com contratos na blockchain
│   │   │   ├── OracleService.ts        # Oráculo de atestação DNS e vouchers
│   │   │   ├── RoutingPoolService.ts   # Clustering e Circuit Breaker P2P
│   │   │   ├── StealthRoutingService.ts# Dark endpoints e rotas privadas
│   │   │   └── SmtpService.ts          # Ponte híbrida com provedores SMTP
│   │   ├── schemas/          # Validação Zod (payload, taxonomia, headers)
│   │   └── utils/            # Utilitários de hash, ASN.1 e Merkle Tree
│   └── test/                 # Suíte de testes com tsx --test
│
├── webmaivw/                 # Interface Webmail soberana (Next.js 15)
│   └── src/
│       ├── app/              # App Router (inbox, composer, settings, onboarding, admin)
│       ├── components/       # Componentes React (ComposerModal, Sandboxed Iframe)
│       └── lib/              # Client SDK e utilitários
│
├── dashboard/                # Observabilidade do nó e telemetria on-chain
│   └── src/app/              # Métricas locais, cartório e telemetria
│
├── docs/                     # Documentação pública com Astro Starlight
├── docker-compose.yml        # Orquestração do nó local completo
└── .env.example              # Modelo de variáveis de ambiente do nó
```

---

## 🧩 2. Responsabilidades dos Módulos

### `/contracts` (Solidity / Foundry)
- **Contratos na Blockchain (Base L2)**: Mantêm o registro canônico de domínios corporativos, chaves públicas ECDSA associadas, tiers de provedor, staking de segurança e permissões de oráculo.
- **Camada Lens**: Implementa a resolução hierárquica reversa de subdomínios (ex: `notificacoes.empresa.com.br` resolve para `empresa.com.br` caso não possua registro isolado), economizando gas e simplificando consultas.

### `/gateway` (Node.js / Fastify)
O Gateway é o coração do nó soberano:
- **Camada de Recepção P2P (`POST /api/v1/inbox`)**: Recebe envelopes criptografados de outros nós, valida assinaturas contra o contrato na blockchain e grava no banco local.
- **Camada de Envio (`POST /api/v1/send`)**: Descobre o nó de destino via contrato na blockchain, realiza o handshake criptográfico, assina o payload com a chave do domínio de origem e despacha via HTTPS direto.
- **Fallback SMTP Híbrido**: Caso o domínio de destino não possua nó MAIVW ativo, despacha o pacote via SMTP legado através de adaptadores configurados (Resend, SendGrid, SES).
- **Tribunal e Oráculo de Arbitragem**: Dispara e avalia denúncias de Tag Spoofing via juízes semânticos heurísticos e por inteligência artificial.

### `/webmaivw` (Next.js 15)
- Interface de webmail moderna sem cookies de terceiros.
- Suporte a múltiplos perfis (`admin` para gestão de domínios e chaves, e `user` para colaboradores).
- Renderização de e-mails em iframe estritamente isolado (`sandbox`), bloqueando execução de scripts maliciosos e rastreadores ocultos (pixel trackers).

### `/dashboard` (Next.js)
- Painel de telemetria local e observabilidade de nós.
- Exibe o estado de sincronização com o cartório digital na blockchain e métricas de envelopes recebidos.

---

## 🔄 3. Fluxo de Dados entre Componentes

```
┌──────────────┐          ┌───────────────────┐          ┌──────────────────────┐
│  Webmaivw    │  POST    │  Gateway Local    │  Handshake│  Gateway Remoto      │
│  (Next.js)   ├─────────>│  (Fastify Node)   ├─────────>│  (Domínio Destino)   │
└──────────────┘          └─────────┬─────────┘          └──────────────────────┘
                                    │
                                    │ Consulta Resolução
                                    ▼
                         ┌──────────────────────┐
                         │  Contrato na         │
                         │  Blockchain (L2)     │
                         └──────────────────────┘
```

---

## 🛡️ 4. Princípios Arquiteturais do Código

1. **Zero-Trust por Padrão**: Nenhum pacote recebido via P2P é aceito sem verificação matemática de assinatura em curva elíptica contra a chave registrada na blockchain.
2. **Desacoplamento de Infraestrutura**: O Gateway não depende de um provedor específico de cloud; pode rodar em VPS comum, servidor dedicado ou cluster Kubernetes.
3. **Imutabilidade de Identidade**: Mudanças de endereço IP ou portas do Gateway são refletidas no registro on-chain por transações autenticadas pela chave administrativa do domínio.
