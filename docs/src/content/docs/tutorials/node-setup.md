---
title: Subindo um Nó Completo (Self-Hosting)
description: Guia passo a passo para instalar e executar um nó completo do MAIVW Protocol com Docker Compose.
---

Este guia ensina como colocar um nó completo do **MAIVW Protocol** em produção em menos de 10 minutos utilizando Docker e Docker Compose.

---

## 💻 1. Requisitos de Infraestrutura

### Requisitos Mínimos de Hardware
- **CPU:** 2 vCPUs (x86_64 ou ARM64)
- **Memória RAM:** 4 GB
- **Armazenamento:** 30 GB SSD NVMe
- **Rede:** IP público fixo ou subdomínio apontado com suporte a portas 80 e 443

### Software Necessário
- **Sistema Operacional:** Ubuntu 22.04 LTS / Debian 12 / macOS / Linux moderno
- **Docker Engine:** versão 24.0+
- **Docker Compose:** versão 2.20+
- **Node.js:** versão 20.x LTS (opcional, apenas para desenvolvimento local sem containers)
- **pnpm:** versão 9.x+

---

## 📥 2. Clonando o Repositório

```bash
git clone https://github.com/SilvioSLN/maivw-protocol.git maivw-protocol
cd maivw-protocol
```

As aplicações e módulos do protocolo ficam localizados diretamente na raiz:
- `/gateway`: O backend Fastify P2P e roteador criptográfico.
- `/webmaivw`: O cliente Webmail moderno em Next.js 15.
- `/dashboard`: Monitor de observabilidade e telemetria on-chain.
- `/contracts`: Smart Contracts em Solidity (Foundry).
- `/docs`: Documentação técnica em Astro Starlight.
- `docker-compose.yml`: Orquestração local dos containers.

---

## ⚙️ 3. Configuração de Variáveis de Ambiente

Copie o modelo de configuração para o `.env` local:

```bash
cp .env.example .env
```

### Principais Variáveis do `.env` Central:

```ini
# --- REDE BLOCKCHAIN (Base L2 ou Anvil Local) ---
RPC_URL=https://sepolia.base.org
CHAIN_ID=84532
BASE_RPC_URL=https://sepolia.base.org
BASE_REGISTRY_ADDRESS=0x0000000000000000000000000000000000000000
BASE_REGISTRY_LENS_ADDRESS=0x0000000000000000000000000000000000000000

# --- BANCO DE DADOS & CACHE ---
POSTGRES_PASSWORD=gere_uma_senha_forte
DATABASE_URL=postgresql://postgres:gere_uma_senha_forte@postgres:5432/maivw_reputation?schema=public
REDIS_URL=redis://redis:6379

# --- CRIPTOGRAFIA & SEGURANÇA (openssl rand -hex 32) ---
JWT_SECRET=gere_segredo_hex_32_bytes
MASTER_SECRET_KEY=gere_segredo_hex_32_bytes
INTERNAL_SERVICE_KEY=gere_segredo_hex_32_bytes

# --- GATEWAY & SERVIÇOS ---
GATEWAY_PORT=3001
GATEWAY_HOST=0.0.0.0
```

---

## 🚀 4. Inicializando os Serviços com Docker Compose

Suba toda a pilha com um único comando:

```bash
docker compose up -d --build
```

O Docker Compose irá inicializar automaticamente:
1. `postgres`: Banco de dados relacional para persistência de mensagens e caixas postais.
2. `redis`: Cache e filas de processamento assíncrono.
3. `gateway`: Gateway Fastify escutando na porta `3001`.
4. `webmaivw`: Interface webmail moderna Next.js escutando na porta `3002`.
5. `dashboard`: Monitor de observabilidade on-chain escutando na porta `3000`.

---

## 🩺 5. Verificando a Saúde dos Serviços

Teste se os serviços estão operando normalmente:

```bash
# Testar integridade do Gateway
curl http://localhost:3001/health

# Resposta esperada:
# {"status":"ok","service":"maivw-gateway","timestamp":"2026-10-11T...","blockchain":"online","redis":"online"}
```

Acesse a interface gráfica no seu navegador:
👉 **`http://localhost:3002`** (ou através do seu domínio reverso HTTPS configurado no Nginx/Caddy).

---

## 🔄 6. Manutenção e Logs

Para acompanhar os logs de tráfego de e-mails em tempo real:

```bash
# Ver logs do Gateway (recebimento e envio P2P)
docker compose logs -f gateway

# Ver logs do Webmail
docker compose logs -f webmaivw

# Reiniciar um serviço específico
docker compose restart gateway
```
