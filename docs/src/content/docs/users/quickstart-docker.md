---
title: Subir Nó com Docker Compose
description: Guia passo a passo para instalar, configurar e iniciar um nó completo do MAIVW Protocol via Docker Compose.
---

O **MAIVW Protocol** foi projetado para que qualquer empresa, desenvolvedor ou entusiasta possa operar um **nó soberano e autônomo** de comunicação em minutos, sem depender de nenhuma infraestrutura proprietária ou serviços de nuvem centralizados.

Este guia orienta a implantação em servidores Linux (Ubuntu/Debian, CentOS/Rocky, Arch) ou ambientes locais utilizando **Docker Compose**.

---

## 📋 Pré-requisitos de Sistema

| Recurso | Requisito Mínimo (Testes/PME) | Requisito Recomendado (Produção) |
| :--- | :--- | :--- |
| **CPU** | 2 vCPUs | 4 vCPUs ou mais |
| **Memória RAM** | 4 GB | 8 GB |
| **Armazenamento** | 20 GB SSD | 50 GB NVMe |
| **Sistema Operacional** | Linux x86_64 / arm64 | Ubuntu 22.04+ LTS / Debian 12 |
| **Docker** | Engine v24.0+ | Docker v26.0+ |
| **Docker Compose** | Plugin Compose v2.20+ | Plugin Compose v2.26+ |

---

## 1. Clonar o Repositório do Protocolo

Clone o repositório oficial da pilha aberta do MAIVW:

```bash
git clone https://github.com/SilvioSLN/maivw-protocol.git maivw-protocol
cd maivw-protocol
```

As aplicações do protocolo ficam localizadas diretamente na raiz do repositório:
- **`gateway/`**: Nó de roteamento P2P, atestador criptográfico e API Fastify.
- **`webmaivw/`**: Interface webmail corporativa e painel de administração (Next.js).
- **`dashboard/`**: Monitor de observabilidade e métricas on-chain.
- **`contracts/`**: Códigos dos contratos inteligentes Solidity (Base L2).
- **`docs/`**: Documentação técnica do protocolo (Astro Starlight).
- **`docker-compose.yml`**: Orquestrador de contêineres e bancos de dados.

---

## 2. Configurar o Arquivo de Ambiente (`.env`)

Crie o arquivo de configuração copiando o modelo de exemplo:

```bash
cp .env.example .env
```

### Gerando Chaves de Criptografia Seguras

Execute os comandos abaixo para gerar segredos randômicos e injetá-los no `.env`:

```bash
# Gera segredos de 256 bits para JWT e criptografia de sessões
JWT_SECRET=$(openssl rand -hex 32)
MASTER_SECRET_KEY=$(openssl rand -hex 32)
INTERNAL_SERVICE_KEY=$(openssl rand -hex 32)

# Atualiza automaticamente no arquivo .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
sed -i "s/^MASTER_SECRET_KEY=.*/MASTER_SECRET_KEY=$MASTER_SECRET_KEY/" .env
sed -i "s/^INTERNAL_SERVICE_KEY=.*/INTERNAL_SERVICE_KEY=$INTERNAL_SERVICE_KEY/" .env
```

### Variáveis Principais no `.env`

Abra o arquivo `.env` no seu editor favorito e configure as credenciais da rede:

```ini
# Configuração da Blockchain (Base Sepolia para testes ou Base Mainnet)
RPC_URL=https://sepolia.base.org
CHAIN_ID=84532
REGISTRY_CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
BASE_REGISTRY_LENS_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512

# Banco de Dados e Cache (alinhados ao docker-compose.yml)
POSTGRES_PASSWORD=postgres
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/maivw_reputation?schema=public
REDIS_URL=redis://redis:6379
```

---

## 3. Subir os Contêineres

Execute o Docker Compose para baixar as imagens e iniciar os serviços em segundo plano:

```bash
docker compose up -d
```

### O que está sendo executado?

```
┌────────────────────────────────────────────────────────┐
│                   SEU NÓ MAIVW (Docker)                │
├─────────────────┬───────────────────┬──────────────────┤
│ Serviço         │ Porta Interna/Host│ Função           │
├─────────────────┼───────────────────┼──────────────────┤
│ postgres        │ 5432              │ Banco de Dados   │
│ redis           │ 6379              │ Filas de Mensagem│
│ gateway         │ 3001              │ API REST & P2P   │
│ webmaivw        │ 3002              │ Webmail & Admin  │
│ dashboard       │ 3000              │ Monitor On-Chain │
└─────────────────┴───────────────────┴──────────────────┘
```

---

## 4. Verificar se Todos os Serviços Estão Saudáveis

Para conferir o status de execução de cada container:

```bash
docker compose ps
```

Todos os serviços devem exibir o estado `Up` ou `healthy`.

Para testar o endpoint de saúde do **Gateway**:

```bash
curl http://localhost:3001/health
```

Você deverá receber uma resposta com status positivo:
```json
{
  "status": "ok",
  "service": "maivw-gateway",
  "timestamp": "2026-10-11T...",
  "blockchain": "online",
  "redis": "online"
}
```

---

## 5. Próximo Passo

Agora que seu nó local está em execução, você precisa **vincular o seu domínio de e-mail institucional** no Cartório On-Chain.

👉 Siga o guia: [Configuração de Domínio & DNS TXT](/users/dns-domain-setup/)
