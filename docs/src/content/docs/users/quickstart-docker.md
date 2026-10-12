---
title: Instalação com Docker para piloto
description: Suba um nó controlado com PostgreSQL, Redis e contrato EVM configurado.
---

Este procedimento usa uma testnet e mantém as portas no loopback do host. Não é um guia de liberação para produção; confira as [limitações atuais](/status/).

## Pré-requisitos

Docker com Compose v2, Git e OpenSSL; portas locais 3000, 3001, 3002, 5432 e 6379 disponíveis. Dimensionamento depende da carga; não há benchmark que comprove um mínimo universal.

Você também precisa de RPC acessível, endereço do **proxy Registry** na mesma rede e assinante do oráculo. O modo `local` exige uma chave EVM mesmo quando o onboarding consulta um oráculo remoto. Para emitir provas locais, o assinante deve ser autorizado pelo contrato e ter saldo de teste. Veja [contratos e deploy](/contracts/registry/).

## Preparar configuração

```bash
git clone https://github.com/SilvioSLN/maivw-protocol.git
cd maivw-protocol
cp .env.example .env
openssl rand -hex 32
```

Execute a geração três vezes e atribua valores distintos a `JWT_SECRET`, `MASTER_SECRET_KEY` e `INTERNAL_SERVICE_KEY` no `.env`. Preencha:

| Campo | Valor a configurar |
| --- | --- |
| `RPC_URL`, `CHAIN_ID` | RPC e ID da mesma rede; exemplo padrão: Base Sepolia, `84532` |
| `REGISTRY_CONTRACT_ADDRESS` | Endereço real do proxy; não copie um endereço de Anvil para testnet |
| `BASE_REGISTRY_ADDRESS` | Mesmo proxy se usar Base nos caminhos multichain |
| `ORACLE_PRIVATE_KEY` | Chave EVM válida do assinante local; não publique nem reutilize chave de teste em produção |
| `SENDER_DOMAIN`, `MAIVW_CORE_DOMAIN` | Identidade/configuração de domínio deste nó |
| `DEFAULT_P2P_ENDPOINT` | URL HTTPS concreta e acessível ao outro nó, terminando em `/api/v1/inbox` |
| `POSTGRES_PASSWORD` | Senha do banco; atualize também `DATABASE_URL` para uso fora do Docker |
| `NEXT_PUBLIC_GATEWAY_URL` | URL do Gateway acessível pelo navegador |
| `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS` | Configuração pública coerente com a rede escolhida |

O Compose carrega `.env` no Gateway e substitui os hosts de PostgreSQL e Redis pelos nomes dos serviços. Alterar `POSTGRES_PASSWORD` depois de criar o banco não troca automaticamente a senha no PostgreSQL existente.

## Iniciar e verificar

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl -i http://localhost:3001/health
```

`/health` responde `200` quando as consultas de banco, Redis e Registry completam; retorna `503` e `status: "degraded"` se alguma falhar ou exceder o prazo. O saldo do oráculo aparece separadamente e não certifica sua autorização. `/health/live` só informa se o processo HTTP responde.

O frontend pode aguardar o Gateway ficar saudável. Confira logs se houver espera persistente:

```bash
docker compose logs --tail=100 gateway
```

Abra Webmail em `http://localhost:3002` e Dashboard em `http://localhost:3000`. Em servidor remoto, use túnel SSH ou rede administrativa privada; `localhost` no navegador é o computador do usuário.

## Domínio e primeiro teste

Cadastre a conta administrativa em `/signup`, siga o onboarding com [DNS TXT](/users/dns-domain-setup/) e crie uma caixa postal. Valide dois nós de teste, assinatura e persistência antes de usar dados reais. Para destinos SMTP, configure o provedor em `/settings` e teste a ponte separadamente.

O Compose não fornece servidor SMTP de entrada na porta 25, Anvil nem proxy TLS. Veja [operação e exposição de rede](/self-hosting/operations/).
