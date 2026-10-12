---
title: Ambiente de desenvolvimento
description: Execute a stack pronta ou componentes separados para desenvolver.
---

Use Node.js 22+, npm, Docker/Compose e Foundry quando trabalhar diretamente nos contratos. Clone também os submódulos Solidity:

```bash
git clone --recurse-submodules https://github.com/SilvioSLN/maivw-protocol.git
cd maivw-protocol
```

## Stack local completa

```bash
docker compose up -d --build
docker compose ps
curl -i http://localhost:51443/health
```

O Compose inicia Anvil em `55443`, implanta o Registry e injeta seu endereço no Gateway. O modo local não consulta DNS público durante onboarding. Veja [instalação com Docker](/users/quickstart-docker/) para URLs e convite da demonstração.

## Gateway no host

Para alterar o Gateway com banco, Redis e Anvil em containers, mantenha a stack completa ativa ou inicie os serviços necessários. Use uma configuração própria apontando para as portas do host: PostgreSQL `53443`, Redis `54443` e Anvil `55443`. O endereço do Registry pode ser lido com:

```bash
docker compose exec contracts-deployer cat /deploy-output/contract-address.txt
```

Na pasta `gateway/`:

```bash
npm ci
npx prisma generate
npm test
npm run build
npm run dev
```

`npm run dev` carrega `../.env` quando o arquivo existe. O `.env.example` contém apenas overrides da demonstração em Docker; para rodar no host, configure também `DATABASE_URL`, `REDIS_URL`, `RPC_URL` e `REGISTRY_CONTRACT_ADDRESS` com `localhost` e as portas expostas.

## Interfaces

Instale dependências em `webmaivw/` e `dashboard/`. Para execução no host, use `.env.local` em cada aplicação:

```ini
NEXT_PUBLIC_GATEWAY_URL=http://localhost:51443
NEXT_PUBLIC_RPC_URL=http://localhost:55443
NEXT_PUBLIC_CHAIN_ID=31337
```

Nunca exponha uma chave privada em variável `NEXT_PUBLIC_*`. Webmail usa porta interna de desenvolvimento `3002` e Dashboard `3000`; as portas `52443` e `50443` são os mapeamentos do Compose.

## Contratos e documentação

As bibliotecas em `contracts/lib/` são submódulos fixados. Se faltarem, execute `git submodule update --init --recursive`. O Dockerfile copia essas versões e não baixa uma OpenZeppelin diferente durante o build.

Em `docs/`, execute `npm ci`, `npm run check:docs` e `npm run build`. O primeiro build de containers requer rede para obter imagens e pacotes; operação offline pressupõe cache já preenchido.
