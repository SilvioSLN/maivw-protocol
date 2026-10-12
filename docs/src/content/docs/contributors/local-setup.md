---
title: Configuração do Ambiente de Desenvolvimento
description: Guia passo a passo para clonar, configurar variáveis de ambiente e rodar o MAIVW Protocol localmente para desenvolvimento.
---

Este guia é voltado para engenheiros e desenvolvedores que desejam contribuir com o código-fonte do **MAIVW Protocol**, rodar testes locais, depurar serviços e estender os contratos ou o gateway.

---

## 💻 1. Pré-requisitos do Sistema

Antes de iniciar, certifique-se de ter as seguintes ferramentas instaladas na sua máquina:

| Ferramenta | Versão Mínima | Finalidade |
| :--- | :--- | :--- |
| **Node.js** | `>= 20.0.0` (LTS recomendada) | Execução do Gateway e Webmail |
| **npm** ou **pnpm** | npm 10+ / pnpm 9+ | Gerenciador de pacotes das aplicações |
| **Docker & Compose** | Docker 24+, Compose v2 | Containers auxiliares (Postgres, Redis) ou stack completo |
| **Foundry / Forge** | Última versão estável | Compilação e testes dos contratos na blockchain |
| **Git** | `>= 2.30` | Controle de versão |

---

## 📦 2. Clonando e Estrutura do Repositório

Clone o repositório principal:

```bash
git clone https://github.com/SilvioSLN/maivw-protocol.git maivw-protocol
cd maivw-protocol
```

O repositório do protocolo organiza os serviços de forma modular e independente na raiz:
- **`gateway/`**: Backend Fastify, orquestrador P2P e verificação criptográfica.
- **`webmaivw/`**: Interface webmail corporativa (Next.js 15).
- **`dashboard/`**: Monitor de observabilidade do nó e cartório on-chain (Next.js).
- **`contracts/`**: Contratos inteligentes em Solidity (Foundry).
- **`docs/`**: Documentação técnica com Astro Starlight.

Instale as dependências nos serviços em que for trabalhar:
```bash
# Gateway
cd gateway && npm install && cd ..

# WebMaivw
cd webmaivw && npm install && cd ..

# Dashboard
cd dashboard && npm install && cd ..

# Docs
cd docs && npm install && cd ..
```

---

## ⚙️ 3. Configuração de Variáveis de Ambiente

O projeto possui um arquivo de modelo `.env.example`. Copie-o para `.env` na raiz:

```bash
cp .env.example .env
```

Gere segredos aleatórios para as chaves criptográficas:

```bash
JWT_SECRET=$(openssl rand -hex 32)
MASTER_SECRET_KEY=$(openssl rand -hex 32)
INTERNAL_SERVICE_KEY=$(openssl rand -hex 32)

sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
sed -i "s/^MASTER_SECRET_KEY=.*/MASTER_SECRET_KEY=$MASTER_SECRET_KEY/" .env
sed -i "s/^INTERNAL_SERVICE_KEY=.*/INTERNAL_SERVICE_KEY=$INTERNAL_SERVICE_KEY/" .env
```

---

## 🚀 4. Inicializando a Infraestrutura de Suporte

Você pode subir a infraestrutura de banco de dados e cache em segundo plano utilizando o Docker Compose:

```bash
docker compose up -d postgres redis
```

Verifique se os containers estão saudáveis:

```bash
docker compose ps
```

Se preferir subir a blockchain local para testes dos contratos, execute o Anvil em um terminal dedicado:
```bash
anvil --chain-id 31337
```

---

## 🛠️ 5. Executando os Serviços em Modo Dev

Com a infraestrutura rodando, você pode inicializar os serviços individualmente com hot-reload a partir de suas pastas:

### Gateway (Fastify)
```bash
cd gateway
npm run dev
# O Gateway responderá em http://localhost:3001
```

### Webmail (WebMaivw)
```bash
cd webmaivw
npm run dev
# O Webmail estará acessível em http://localhost:3002
```

### Dashboard de Observabilidade
```bash
cd dashboard
npm run dev
# O Dashboard estará acessível em http://localhost:3000
```

### Documentação (Starlight)
```bash
cd docs
npm run dev
# A documentação estará acessível em http://localhost:4321
```

### Testar os Contratos com Foundry
```bash
cd contracts
forge test -vvv
```
