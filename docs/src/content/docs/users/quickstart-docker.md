---
title: Instalação com Docker
description: Rode uma demonstração local completa ou configure um nó em Testnet.
---

O repositório oferece dois caminhos separados: uma demonstração local com Anvil e contrato implantado automaticamente, e um Compose para uma Testnet EVM com configuração própria. O projeto continua em desenvolvimento; confira as [limitações atuais](/status/) antes de usar dados importantes.

## Demonstração local

Pré-requisitos: Git, Docker com Compose v2 e as portas `50443`, `51443`, `52443`, `53443`, `54443` e `55443` livres no host.

```bash
git clone --recurse-submodules https://github.com/SilvioSLN/maivw-protocol.git
cd maivw-protocol
docker compose up -d --build
docker compose ps
curl -i http://localhost:51443/health
```

O Compose inicia PostgreSQL, Redis, Anvil, implanta o `MAIVWRegistry`, grava o endereço do proxy em um volume e só então inicia o Gateway e as interfaces. O estado do Anvil fica no volume `anvil-state`; reiniciar a stack preserva o contrato. O primeiro build precisa de internet para baixar imagens e dependências. Depois que esses artefatos estão no cache, o funcionamento da demonstração não depende de RPC, DNS, Firebase, Resend ou oráculo externos.

Abra:

- Dashboard: `http://localhost:50443`
- Gateway: `http://localhost:51443`
- WebMaivw: `http://localhost:52443`
- RPC do Anvil para a carteira: `http://localhost:55443`

Crie a conta administrativa em `/signup` usando o convite local `local-demo-admin-invite-change-before-testnet-2026`. Cadastre um domínio como `empresa.local`. Nesse modo, o Gateway informa `dnsMode: local-demo`, aprova o desafio DNS sem consulta pública e sugere o endpoint interno `http://gateway:3001/api/v1/inbox`.

As chaves do Anvil e os segredos `local-demo-*` são públicos. A validação do Gateway rejeita esses valores fora da rede local `31337` conectada a `anvil`, `localhost` ou loopback.

## Testnet

Implante antes o proxy `MAIVWRegistry` na Testnet escolhida e garanta que a carteira do oráculo configurada no contrato tenha saldo de teste. Em seguida:

```bash
cp .env.testnet.example .env.testnet
# Edite todos os campos CHANGE_ME e as URLs example.com.
docker compose -f compose.testnet.yml --env-file .env.testnet config --quiet
docker compose -f compose.testnet.yml --env-file .env.testnet up -d --build
```

Os campos principais são:

| Campo | Exigência |
| --- | --- |
| `RPC_URL`, `CHAIN_ID` | RPC e ID da mesma Testnet |
| `REGISTRY_CONTRACT_ADDRESS` | Endereço do proxy, com bytecode na rede configurada |
| `ORACLE_PRIVATE_KEY` | Assinante igual ao `oracleNode` do Registry, ou configure GCP KMS |
| `JWT_SECRET`, `MASTER_SECRET_KEY`, `INTERNAL_SERVICE_KEY`, `ADMIN_REGISTRATION_TOKEN` | Quatro segredos diferentes, gerados pelo operador |
| `SENDER_DOMAIN`, `MAIVW_CORE_DOMAIN` | Domínios reais do nó |
| `DEFAULT_P2P_ENDPOINT` | URL HTTPS pública terminando em `/api/v1/inbox` |
| `NEXT_PUBLIC_GATEWAY_URL`, `NEXT_PUBLIC_WEBMAIVW_URL`, `NEXT_PUBLIC_RPC_URL` | URLs acessíveis pelo navegador |

Gere cada segredo separadamente com `openssl rand -hex 32`. Nunca copie a chave da conta #0 do Anvil ou os valores da demonstração para Testnet. O Gateway falha ao iniciar se detectar esses padrões, Registry ausente ou endpoint P2P sem HTTPS.

As portas continuam presas ao loopback. Para acesso remoto, coloque proxy TLS e controle de acesso à frente dos serviços. Alterações em `NEXT_PUBLIC_*` exigem novo build das interfaces.

## Verificação e diagnóstico

`/health` responde `200` quando PostgreSQL, Redis e Registry respondem; retorna `503` se algum deles falhar. `/health/live` confirma apenas que o processo HTTP está vivo.

```bash
docker compose logs --tail=100 contracts-deployer gateway
docker compose restart gateway
docker compose down
```

O Compose não fornece SMTP de entrada na porta 25 nem proxy TLS. A demonstração local serve para conhecer o fluxo; Testnet ainda requer DNS público, endpoint HTTPS, contrato e operação do nó.
