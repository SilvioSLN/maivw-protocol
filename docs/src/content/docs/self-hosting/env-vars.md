---
title: Variáveis de ambiente
description: Configuração do Gateway, Compose, frontend e integrações opcionais.
---

A referência cobre o schema em `gateway/src/config.ts` e variáveis lidas diretamente por outros módulos. Defaults abaixo são do **código**, salvo indicação explícita. O `.env.example` escolhe Base Sepolia para piloto; o código ainda usa Anvil como fallback quando não recebe rede.

O Compose carrega `.env` no Gateway e sobrescreve conexões internas. O modo dev do Gateway carrega `../.env`. Interfaces usam `.env.local` ou argumentos de build. Valores opcionais vazios são tratados como ausentes por `loadConfig`; leituras diretas de `process.env` seguem o comportamento do módulo.

## Gateway, dados e segredos

| Variável | Padrão / exigência | Uso |
| --- | --- | --- |
| `GATEWAY_PORT` | `3001` | Porta do processo; Compose fixa em 3001 |
| `GATEWAY_HOST` | `0.0.0.0` | Bind interno; a publicação do Compose é no loopback do host |
| `DATABASE_URL` | PostgreSQL local, banco `maivw_reputation` | Prisma; Compose usa host `postgres` |
| `POSTGRES_PASSWORD` | `postgres` no Compose | Inicialização do banco; trocar env não altera senha de banco existente |
| `REDIS_URL` | `redis://localhost:6379` | Cache/coordenação; Compose usa host `redis` |
| `ADMIN_REGISTRATION_TOKEN` | Ausente: cadastro administrativo fechado | Convite privado de pelo menos 32 caracteres; remover após cadastrar administradores |
| `JWT_SECRET` | Obrigatório, mínimo 16 caracteres | Assinatura de sessão; use alta entropia |
| `MASTER_SECRET_KEY` | Obrigatório, mínimo 16 caracteres | Entrada para derivação SHA-256 da chave AES do cofre; não exige formato hex, mas recomenda-se gerar segredo aleatório |
| `INTERNAL_SERVICE_KEY` | Obrigatório, mínimo 16 caracteres | Integrações internas; não é uma chave EVM |
| `SENDER_DOMAIN` | `empresaA.com` | Identidade padrão de envio, deve ser configurada |
| `MAIVW_CORE_DOMAIN` | `maivw.org` | Sugestões de DNS e endpoint no onboarding; não substitui `SENDER_DOMAIN` |
| `PLATFORM_INGRESS_HOSTS` | Vazio | Lista adicional de hosts reconhecidos no roteamento |
| `IS_CLOUD` | `false` | Aceita `true` ou `false`; não transforma o Compose em serviço de nuvem |
| `DEFAULT_P2P_ENDPOINT` | Opcional | URL concreta; sem ela o onboarding atual usa `https://mw.<MAIVW_CORE_DOMAIN>/api/v1/inbox` |
| `TLS_CERT_PATH` | Opcional (default `data/certs/node.crt`) | Caminho do certificado público TLS X.509 em formato PEM |
| `TLS_KEY_PATH` | Opcional (default `data/certs/node.key`) | Caminho da chave privada TLS correspondente ao certificado |
| `MTLS_STRICT_MODE` | `false` | Se `true`, impõe verificação estrita de mTLS mesmo para nós sem ancoragem |
| `TRUST_PROXY` | `false` | Se `true`, aceita cabeçalho `x-client-cert-fingerprint-sha256` proveniente de proxy reverso confiável |

Não troque `MASTER_SECRET_KEY` em banco existente sem recifrar chaves e credenciais. Não há ferramenta de migração pronta para isso.

## Blockchain e assinantes

| Variável | Padrão / exigência | Uso |
| --- | --- | --- |
| `RPC_URL` | `http://localhost:8545` no código; Sepolia no exemplo | RPC principal |
| `CHAIN_ID` | `31337` no código; `84532` no exemplo | Rede principal |
| `REGISTRY_CONTRACT_ADDRESS` | Sem default | Endereço do proxy; fallback opcional para `/deploy-output/contract-address.txt`, não montado pelo Compose atual |
| `BASE_RPC_URL` | `https://sepolia.base.org` | Caminhos Base/multichain |
| `BASE_REGISTRY_ADDRESS` | Opcional | Registro Base; não substitui globalmente `REGISTRY_CONTRACT_ADDRESS` |
| `ARBITRUM_RPC_URL` | `https://sepolia-rollup.arbitrum.io/rpc` | Caminhos Arbitrum |
| `ARBITRUM_REGISTRY_ADDRESS` | Opcional | Registry da rede correspondente |
| `POLYGON_RPC_URL` | `https://rpc-amoy.polygon.technology` | Caminhos Polygon |
| `POLYGON_REGISTRY_ADDRESS` | Opcional | Registry da rede correspondente |
| `ORACLE_SIGNER_TYPE` | `local` | `local` ou `gcp-kms` |
| `ORACLE_PRIVATE_KEY` | Obrigatória para signer local | Chave EVM, prefixo `0x` e 32 bytes; autoridade depende do contrato |
| `GCP_KMS_KEY_VERSION` | Obrigatória para `gcp-kms` | Recurso da versão de chave compatível |
| `GCP_KMS_CREDENTIALS_BASE64` | Opcional | JSON de credenciais codificado; caso contrário usa autenticação do ambiente |
| `ORACLE_MIN_BALANCE_WEI` | `10000000000000000` | Limiar informativo de saldo baixo |
| `MAIVW_ORACLE_URL` | `https://api-test.maivw.com` | Dependência remota em caminhos do onboarding |
| `DEPLOYER_PRIVATE_KEY` | Opcional no Gateway | Scripts de implantação e alguns caminhos de carteira/telemetria; não é chave pública |
| `COMPANY_A_PRIVATE_KEY` | Opcional | Assinante de fallback; sem ela o Gateway gera chave efêmera |
| `COMPANY_B_PRIVATE_KEY` | Opcional | Campo legado/teste; não é pré-requisito do piloto |
| `PROVIDER_PRIVATE_KEY` | Opcional | Campo legado/teste; não é pré-requisito do piloto |

`BASE_REGISTRY_LENS_ADDRESS` não é consumida pelo Gateway atual. Configure redes e endereços a partir de deploy verificável, sem reutilizar endereços de exemplo.

## SMTP, juiz e módulos com configuração direta

| Variável | Uso |
| --- | --- |
| `RESEND_API_KEY` | Provedor de saída padrão opcional; configuração por domínio também existe no banco |
| `LEGACY_WEBHOOK_SECRET` | Proteção do webhook legado; vazio desabilita a exigência no handler atual |
| `ORACLE_AI_JUDGE_URL` | Endpoint opcional do juiz semântico remoto |
| `ORACLE_AI_JUDGE_TOKEN` | Credencial do juiz remoto |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Caminho da credencial no processo/container; montar arquivo separadamente, nunca no build público |
| `INGRESS_PROXY_ENABLED` | Leitura direta; somente string `true` ativa o proxy de ingresso |
| `DEFAULT_SECONDARY_INGRESS_URL` | Rota secundária; código tem fallback remoto MAIVW |
| `GATEWAY_PUBLIC_URL` | Base pública usada ao processar anexos SMTP |
| `NODE_ENV` | Ambiente do processo; container usa `production`, sem significar validação de segurança concluída |

O processador de anexos também usa `NEXT_PUBLIC_GATEWAY_URL` como fallback. Para instalação independente, configure os endpoints concretos e revise rotas criadas automaticamente.

## Frontend e build

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_GATEWAY_URL` | API acessível pelo navegador |
| `NEXT_PUBLIC_RPC_URL` | RPC público no ambiente de build; alguns fluxos têm redes fixas em `webmaivw/src/lib/web3.ts` |
| `NEXT_PUBLIC_CHAIN_ID` | Rede da interface nos caminhos que consomem a variável |
| `NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS` | Proxy configurado para operações da interface |
| `NEXT_PUBLIC_WEBMAIVW_URL` | Links do Dashboard para Webmail |
| `NEXT_PUBLIC_DASHBOARD_URL` | Argumento previsto no Dockerfile; não implica uso por todas as telas |
| `NEXT_PUBLIC_PAYMENT_API_URL` | Integração externa de pagamentos; serviço não incluído no Compose |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Configuração pública do projeto Firebase |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Domínio de autenticação Firebase |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Projeto Firebase |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Bucket Firebase |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Identificador público Firebase |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Identificador público da aplicação Firebase |

Mudanças de `NEXT_PUBLIC_*` exigem rebuild. A configuração pública Firebase não é a credencial de serviço do backend. O frontend exige configuração Firebase própria para login social; valores ausentes produzem erro de configuração, sem recorrer a um projeto compartilhado.
