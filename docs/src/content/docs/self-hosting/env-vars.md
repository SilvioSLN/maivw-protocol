---
title: Variáveis de Ambiente
description: Referência detalhada de todas as variáveis de configuração do nó e serviços MAIVW.
---

O arquivo `.env` na raiz do nó define a identidade da rede, conexões de banco de dados, chaves criptográficas e contratos na blockchain.

## Configurações do Gateway

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `GATEWAY_PORT` | `3001` | Porta HTTP/REST do Fastify. |
| `GATEWAY_HOST` | `0.0.0.0` | Endereço de bind de rede. |
| `MAIVW_CORE_DOMAIN` | `maivw.org` | Domínio padrão utilizado no handshake e nas assinaturas. |
| `PLATFORM_INGRESS_HOSTS` | - | Lista de hosts permitidos para roteamento e proxy reverso. |

## Banco de Dados & Filas

| Variável | Exemplo | Descrição |
| :--- | :--- | :--- |
| `POSTGRES_PASSWORD` | `postgres` | Senha do usuário `postgres` no banco de dados. |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/maivw_reputation?schema=public` | String de conexão Prisma com o PostgreSQL. |
| `REDIS_URL` | `redis://localhost:6379` | Conexão com o Redis para jobs assíncronos e cache. |

## Segurança & Criptografia (Obrigatório em Produção)

| Variável | Descrição |
| :--- | :--- |
| `JWT_SECRET` | Chave secreta de alta entropia (mínimo 16 chars) para assinatura e verificação de tokens JWT. |
| `MASTER_SECRET_KEY` | Chave de 32 bytes (256 bits) em hexadecimal usada para cifragem simétrica AES-256-GCM de chaves privadas em repouso. |
| `INTERNAL_SERVICE_KEY` | Token de autenticação interna entre microsserviços e workers. |

## Blockchain & Smart Contracts (EVM / Base)

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `CHAIN_ID` | `84532` (Base Sepolia) | ID da cadeia EVM. Utilize `31337` para anvil local ou `8453` para Base Mainnet. |
| `RPC_URL` / `BASE_RPC_URL` | `https://sepolia.base.org` | Endpoint RPC compatível com JSON-RPC Ethereum. |
| `REGISTRY_CONTRACT_ADDRESS` / `BASE_REGISTRY_ADDRESS` | `0x...` | Endereço do contrato de cartório de identidades na blockchain. |
| `BASE_REGISTRY_LENS_ADDRESS` | `0x...` | Endereço do contrato de resolução e herança wildcard. |
| `DEPLOYER_PRIVATE_KEY` | - | Chave privada da carteira que assina transações na blockchain. |

## Oráculo e Arbitragem

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `ORACLE_SIGNER_TYPE` | `local` | Modo do assinante: `local` (chave privada) ou `gcp-kms` (Cloud HSM). |
| `GCP_KMS_KEY_VERSION` | - | Identificador de versão da chave no Google Cloud KMS (quando `ORACLE_SIGNER_TYPE=gcp-kms`). |
| `ORACLE_AI_JUDGE_URL` | - | URL do cluster de IA remoto para julgamento semântico de disputas. |
| `ORACLE_AI_JUDGE_TOKEN` | - | Token de autorização para o juiz de IA remoto. |

## Multi-Chain (Opcional)

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `ARBITRUM_RPC_URL` | `https://sepolia-rollup.arbitrum.io/rpc` | Endpoint RPC da rede Arbitrum Sepolia. |
| `ARBITRUM_REGISTRY_ADDRESS` | - | Endereço do contrato de espelhamento na Arbitrum. |
| `POLYGON_RPC_URL` | `https://rpc-amoy.polygon.technology` | Endpoint RPC da rede Polygon Amoy. |
| `POLYGON_REGISTRY_ADDRESS` | - | Endereço do contrato de espelhamento na Polygon. |

## Integração Legada & SMTP (Opcional)

| Variável | Descrição |
| :--- | :--- |
| `RESEND_API_KEY` | Chave de API para relay de envio para provedores legados (ex: Gmail, Outlook). |
| `LEGACY_WEBHOOK_SECRET` | Segredo para validação de webhooks de recebimento SMTP legados. |
