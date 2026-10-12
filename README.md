<p align="center">
  <a href="https://maivw.com" target="_blank" rel="noopener noreferrer">
    <img src="docs/src/assets/brand/monogram-badge.png" alt="MAIVW Protocol Logo" width="130" height="130" />
  </a>
</p>

<h1 align="center">MAIVW Protocol</h1>

<p align="center">
  <strong>Mathematical Authenticated Identity &amp; Verifiable Workspace</strong>
</p>

<p align="center">
  O protocolo aberto de comunicação assíncrona corporativa com identidade ancorada em blockchain (EVM/Base), transporte P2P soberano e ponte híbrida com e-mail legado.
</p>

<p align="center">
  <a href="https://docs.maivw.com"><img src="https://img.shields.io/badge/docs-docs.maivw.com-6366f1?style=for-the-badge&logo=astro&logoColor=white" alt="Docs" /></a>
  <a href="https://app.maivw.com"><img src="https://img.shields.io/badge/Maivw%20Cloud-app.maivw.com-10b981?style=for-the-badge&logo=googlecloud&logoColor=white" alt="Maivw Cloud" /></a>
  <a href="https://donate.stripe.com/cNi7sKeUIb5P96deZk2kw00"><img src="https://img.shields.io/badge/Apoiar%20o%20Projeto-Doar%20via%20Stripe-635bff?style=for-the-badge&logo=stripe&logoColor=white" alt="Doar via Stripe" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/tests-60%20passed-brightgreen?style=flat-square&logo=node.js" alt="Tests" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Solidity-0.8.28-363636?style=flat-square&logo=solidity&logoColor=white" alt="Solidity" />
  <img src="https://img.shields.io/badge/Network-Base%20Sepolia-0052FF?style=flat-square&logo=ethereum&logoColor=white" alt="Base L2" />
  <img src="https://img.shields.io/badge/Network-Solana%20(Roadmap)-14F195?style=flat-square&logo=solana&logoColor=000000" alt="Solana" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/License-GPL--3.0-blue?style=flat-square" alt="License" />
</p>

---

## 💡 O que é o MAIVW?

O **MAIVW** é a sigla oficial para **Mathematical Authenticated Identity & Verifiable Workspace**. É uma infraestrutura de comunicação descentralizada desenvolvida para devolver às organizações o controle soberano sobre suas identidades digitais e mensagens assíncronas:

- **M — Mathematical (Matemática):** Autoria e integridade baseadas em provas determinísticas, criptografia de curva elíptica (*secp256k1* / *ECDSA*) e árvores de Merkle com Envelope v2 canônico.
- **A — Authenticated (Autenticada):** Todas as mensagens são assinadas digitalmente na origem pela chave do domínio, eliminando spoofing, forjamento de remetente ou adulteração de trânsito.
- **I — Identity (Identidade):** O domínio corporativo DNS é ancorado criptograficamente em smart contracts na blockchain (EVM/Base L2), eliminando a dependência de autoridades centralizadas.
- **V — Verifiable (Verificável):** Qualquer nó valida autonomamente as assinaturas, endpoints e status de reputação na blockchain em tempo real, sem intermediários.
- **W — Workspace (Espaço de Trabalho):** Um ambiente completo e seguro com Webmail sandboxed, gerenciamento multitenant de contas, observabilidade e controle absoluto de dados.

---

## 🎯 O Problema que Resolvemos

O ecossistema tradicional de e-mails (SMTP/IMAP) foi concebido na década de 1980 sem camadas nativas de autenticidade ou segurança:

1. **Vulnerabilidade a Phishing e Spoofing:** Camadas corretivas adicionadas posteriormente (SPF, DKIM, DMARC) são complexas, frequentemente mal configuradas e não oferecem garantia matemática irrefutável de não-repúdio.
2. **Monopólio e Aprisionamento (*Vendor Lock-in*):** Poucas Big Techs controlam quem pode enviar mensagens e definem arbitrariamente a entregabilidade por meio de caixas-pretas de reputação.
3. **Falta de Soberania de Dados:** Empresas pagam quantias elevadas para armazenar seus dados sensíveis em nuvens de terceiros sujeitas a varreduras automatizadas e termos de serviço unilaterais.

**O propósito do MAIVW** é transformar a troca corporativa de mensagens em uma rede aberta, criptograficamente protegida e resistente à censura, mantendo total interoperabilidade com o ecossistema legado através de gateways híbridos.

---

## ⚡ Como Aderir ao Protocolo

O MAIVW foi desenhado para ser acessível tanto para organizações que buscam praticidade imediata quanto para aquelas que exigem controle total de infraestrutura.

### Opção 1: Maivw Cloud (Mais Rápido & Gerenciado)
Se você deseja usufruir da soberania do protocolo sem precisar gerenciar servidores, instâncias de banco ou contratos:

1. Acesse **[app.maivw.com](https://app.maivw.com)**.
2. Conecte seu domínio através de uma entrada DNS TXT simples.
3. Comece a enviar e receber mensagens assinadas imediatamente pela interface webmail moderna.

### Opção 2: Servidor Próprio (Self-Hosted / Nó Soberano)
Para operar seu nó de forma 100% independente em sua própria máquina ou VPS:

```bash
# 1. Clone o repositório e os submódulos dos contratos
git clone --recurse-submodules https://github.com/SilvioSLN/maivw-protocol.git
cd maivw-protocol

# 2. Inicie a demonstração local completa
docker compose up -d --build
```

O Compose inicia Anvil, implanta o Registry e conecta os serviços automaticamente. Abra:

- **Dashboard:** `http://localhost:50443`
- **Gateway:** `http://localhost:51443`
- **WebMaivw:** `http://localhost:52443`
- **RPC Anvil:** `http://localhost:55443`

Use o convite `local-demo-admin-invite-change-before-testnet-2026` apenas para criar a conta na demonstração. As chaves e os segredos locais são públicos.

Para Testnet, copie `.env.testnet.example` para `.env.testnet`, preencha RPC, proxy Registry, domínios, URLs HTTPS e segredos próprios, e execute `docker compose -f compose.testnet.yml --env-file .env.testnet up -d --build`. Consulte o **[Guia de Instalação Docker](https://docs.maivw.com/users/quickstart-docker/)**.

---

## 🧱 Arquitetura e Componentes

O repositório é organizado em um monorepo modular e coeso:

```
maivw-protocol/
├── contracts/     # Smart Contracts Solidity (MAIVWRegistry UUPS, Lens, DANE on-chain)
├── gateway/       # Backend Fastify, roteador híbrido P2P/SMTP, Envelope v2 e DANE
├── webmaivw/      # Webmail corporativo soberano Next.js 15 com visualização isolada
├── dashboard/     # Painel de observabilidade de nós e telemetria on-chain
└── docs/          # Documentação técnica oficial e documentação interativa Starlight
```

---

## 🛡️ Estágio de Desenvolvimento & Próximos Passos

O protocolo MAIVW está atualmente em estágio de **Pilotos Controlados / Testnet Pública**. 

A segurança e a transparência técnica são princípios inegociáveis do projeto:
- **Auditabilidade e Hardening:** Marcos de engenharia e segurança validados (ver [Estado dos Recursos](https://docs.maivw.com/status/)).
- **Envelope v2 Canônico:** Assinatura estruturada EIP-191 com proteção ativa contra replay por ID e janela temporal.
- **Ancoragem On-Chain / DANE (S08):** Validação mTLS criptografada ponta a ponta com impressões digitais de certificados ancoradas no contrato `MAIVWRegistry`.
- **Anti-SSRF:** Proxy de imagens com resolução DNS segura contra redes privadas e metadados de nuvem.

### Próximos Passos no Roadmap:
- [ ] **S07 — Criptografia de Ponta a Ponta (E2EE):** Projeto e implementação de gestão de chaves no cliente para sigilo absoluto de mensagens.
- [ ] **Auditorias Formais de Segurança:** Revisão externa independente dos smart contracts Solidity.
- [ ] **Expansão Multichain EVM:** Suporte nativo a L2s adicionais (Arbitrum, Optimism, Polygon) com oráculo de estado.
- [ ] **Integração com a Rede Solana:** Expansão da ancoragem de identidade, registro de domínios e micro-taxas de liquidação para o ecossistema Solana (programas Anchor, liquidação ultrarrápida e suporte a carteiras Phantom/Solflare).

---

## 💙 Apoie o Desenvolvimento

O MAIVW Protocol é uma iniciativa de código aberto, livre e mantida com foco na independência digital corporativa. O desenvolvimento contínuo de smart contracts, auditorias e ferramentas é viabilizado pelo suporte da comunidade:

👉 **[Contribua com a construção e manutenção do protocolo via Stripe](https://donate.stripe.com/cNi7sKeUIb5P96deZk2kw00)**

Qualquer contribuição fortalece a soberania de dados e acelera o lançamento de novas versões da rede.

---

## 📚 Documentação & Links Oficiais

- 📖 **Documentação Oficial:** [https://docs.maivw.com](https://docs.maivw.com)
- 🌐 **Plataforma Gerenciada (Cloud):** [https://app.maivw.com](https://app.maivw.com)
- 💳 **Doações e Patrocínio:** [Link Seguro Stripe](https://donate.stripe.com/cNi7sKeUIb5P96deZk2kw00)
- 📊 **Estado dos Recursos:** [https://docs.maivw.com/status/](https://docs.maivw.com/status/)

---

## 📄 Licença

Este projeto é distribuído sob a licença **GNU General Public License v3.0** (GPL-3.0). Consulte o arquivo [LICENSE](LICENSE) para mais detalhes.
