---
title: Guia Rápido (Quickstart)
description: Como subir e testar um nó completo do MAIVW Protocol em menos de 5 minutos.
---

Este guia orienta na inicialização de um nó completo autônomo do MAIVW na sua máquina local ou servidor.

## Pré-requisitos

- **Docker** 24+ e **Docker Compose** v2+
- Portas disponíveis no host: `3001` (Gateway), `3002` (WebMaivw), `3000` (Dashboard), `5432` (PostgreSQL) e `6379` (Redis).

## 1. Clonar e Acessar o Repositório

```bash
git clone https://github.com/SilvioSLN/maivw-protocol.git maivw-protocol
cd maivw-protocol
```

As aplicações e serviços do protocolo ficam organizados diretamente na raiz:
- **`/gateway`**: Nó de comunicação P2P e API REST Fastify.
- **`/webmaivw`**: Interface webmail soberana (Next.js 15).
- **`/dashboard`**: Observabilidade do nó e telemetria on-chain.
- **`/contracts`**: Smart Contracts em Solidity (Base L2).
- **`/docs`**: Documentação técnica do protocolo (Astro Starlight).
- **`docker-compose.yml`**: Orquestrador completo dos serviços.

## 2. Configurar o Ambiente

Copie o arquivo de exemplo de variáveis de ambiente:

```bash
cp .env.example .env
```

Gere chaves seguras para o ambiente local:

```bash
# Gere segredos aleatórios
JWT_SECRET=$(openssl rand -hex 32)
MASTER_SECRET_KEY=$(openssl rand -hex 32)
INTERNAL_SERVICE_KEY=$(openssl rand -hex 32)

# Atualize no .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
sed -i "s/^MASTER_SECRET_KEY=.*/MASTER_SECRET_KEY=$MASTER_SECRET_KEY/" .env
sed -i "s/^INTERNAL_SERVICE_KEY=.*/INTERNAL_SERVICE_KEY=$INTERNAL_SERVICE_KEY/" .env
```

## 3. Subir o Stack com Docker Compose

Inicie todos os serviços em segundo plano:

```bash
docker compose up -d
```

O compose irá iniciar:
- **`postgres`**: Banco relacional persistente com schema inicial.
- **`redis`**: Filas de mensagens assíncronas e cache de sessões.
- **`gateway`**: API REST e orquestrador P2P (`:3001`).
- **`webmaivw`**: Interface webmail corporativa (`:3002`).
- **`dashboard`**: Monitor de observabilidade on-chain (`:3000`).

## 4. Verificar a Saúde dos Serviços

Confira se todos os containers estão saudáveis (`healthy`):

```bash
docker compose ps
```

Você também pode verificar o endpoint de health check do Gateway:

```bash
curl http://localhost:3001/health
# {"status":"ok","service":"maivw-gateway","timestamp":"2026-10-11T...","blockchain":"online","redis":"online"}
```

## 5. Acessar o Webmail

Abra o navegador em:

👉 **[http://localhost:3002](http://localhost:3002)**

1. Acesse o onboarding em `/onboarding` para conectar seu domínio via DNS TXT.
2. Acesse sua caixa de entrada corporativa em `/inbox`.
3. Comece a enviar e receber e-mails soberanos!
