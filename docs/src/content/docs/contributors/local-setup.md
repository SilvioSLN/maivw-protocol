---
title: Ambiente de desenvolvimento
description: Execute serviços locais com variáveis carregadas e banco preparado.
---

Use Node.js 22.12+ (ou versão compatível com o Astro instalado), npm, Docker/Compose e Foundry para contratos. Cada pasta tem seu próprio `package.json`; não há instalação única na raiz.

## Preparar o ambiente

```bash
git clone https://github.com/SilvioSLN/maivw-protocol.git
cd maivw-protocol
cp .env.example .env
docker compose up -d postgres redis
```

Preencha os três segredos e a chave do oráculo conforme [instalação](/users/quickstart-docker/). Para Anvil, inicie `anvil --chain-id 31337` em outro terminal e faça o [deploy local](/contracts/registry/). Configure no `.env` `CHAIN_ID=31337`, `RPC_URL=http://localhost:8545`, o proxy implantado e o assinante do oráculo. O Anvil não é iniciado pelo Compose.

Nesse fluxo o Gateway roda no host, portanto `localhost:8545` está correto. Não use a mesma URL dentro de um container para alcançar o host.

## Gateway

Execute cada bloco na pasta indicada, partindo da raiz do repositório:

```bash
cd gateway
npm install
npx prisma generate
node --env-file=../.env node_modules/prisma/build/index.js db push
npm run dev
```

`npm run dev` carrega `.env` da raiz antes de importar os módulos do Gateway. `db push` é apropriado para o banco de desenvolvimento; para evolução de produção, é necessário planejar migrations e backup.

## Interfaces

Instale dependências de `webmaivw/` e `dashboard/` separadamente. Crie `.env.local` em cada aplicação com as variáveis públicas necessárias, por exemplo:

```ini
NEXT_PUBLIC_GATEWAY_URL=http://localhost:3001
NEXT_PUBLIC_RPC_URL=http://localhost:8545
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS=ENDERECO_REAL_DO_PROXY
```

O endereço acima é um placeholder. **Não copie o `.env` inteiro do Gateway para o frontend**. Nunca prefixe uma chave privada com `NEXT_PUBLIC_`.

Em terminais separados, rode `npm install` e `npm run dev` em cada aplicação. Webmail usa porta 3002 e Dashboard 3000. Integrações Firebase e pagamento são opcionais e exigem configuração própria; não use fallbacks remotos como evidência de instalação independente.

## Contratos e documentação

As bibliotecas Solidity ficam em `contracts/lib/`. Confira a presença de OpenZeppelin, OpenZeppelin Upgradeable e forge-std antes de `forge build` e `forge test`. Não atualize essas bibliotecas implicitamente durante um teste.

Em `docs/`, execute `npm install`, `npm run check:docs` e `npm run build`. O README dessa pasta explica a manutenção do site.
