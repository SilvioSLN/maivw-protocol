---
title: Variáveis de ambiente
description: Configuração do Gateway, Compose, frontend e integrações opcionais.
---

A referência cobre o schema em `gateway/src/config.ts` e variáveis lidas diretamente por outros módulos. Defaults abaixo são do **código**, salvo indicação explícita. O `.env.example` contém overrides opcionais da demonstração; `.env.testnet.example` é o modelo para Base Sepolia.

O Compose local declara sua configuração diretamente e funciona sem `.env`. O Compose de Testnet recebe valores com `--env-file .env.testnet`. O modo dev do Gateway carrega `../.env`. Interfaces usam `.env.local` ou argumentos de build. Valores opcionais vazios são tratados como ausentes por `loadConfig`.

## Modos de ambiente e segurança

| `MAIVW_ENVIRONMENT` | Uso | Regras de inicialização |
| --- | --- | --- |
| `local` | demonstração Community | exige Anvil `31337` em `anvil`, `localhost` ou loopback; permite HTTP e os segredos públicos `local-demo-*` |
| `testnet` | ensaio em redes públicas de teste | rejeita Anvil, exige Registry e HTTPS/WSS nos endpoints públicos |
| `staging` | release candidate isolado | mesmas barreiras de transporte e rede de `testnet`, com dados sintéticos |
| `production` | clientes e redes aprovadas | mesmas barreiras fail-closed, sem placeholders ou contas públicas do Anvil |

`NODE_ENV` controla o runtime JavaScript, mas não seleciona o nível de segurança. O processo usa `MAIVW_ENVIRONMENT` para impedir que uma configuração local seja promovida silenciosamente. Gateway e Payment encerram a inicialização quando o ambiente, a rede, os endpoints públicos ou os placeholders não são coerentes. Os frontends aplicam a mesma verificação em qualquer build, inclusive Docker e Vercel; na Vercel o modo deve ser declarado explicitamente.

## Gateway, dados e segredos

| Variável | Padrão / exigência | Uso |
| --- | --- | --- |
| `MAIVW_ENVIRONMENT` | `local`; obrigatório declarar nos manifests | Fronteira de segurança entre demonstração, Testnet, staging e produção |
| `MAIVW_RUNTIME_ROLE` | `all-in-one` | Seleciona API, ingresso, worker ou indexador; veja [papéis de runtime](/self-hosting/runtime-roles/) |
| `GATEWAY_PORT` | `3001` | Porta do processo; Compose fixa em 3001 |
| `P2P_PORT` | `8443` | Porta HTTPS dedicada do papel `p2p-ingress`; deve receber conexões mTLS diretas |
| `GATEWAY_HOST` | `0.0.0.0` | Bind interno; a publicação do Compose é no loopback do host |
| `GATEWAY_PUBLIC_URL` | `http://localhost:3001` | Base pública usada em anexos e respostas; HTTPS é obrigatório fora de `local` |
| `DATABASE_URL` | PostgreSQL local, banco `maivw_reputation` | Prisma; Compose usa host `postgres` |
| `POSTGRES_PASSWORD` | `postgres` no Compose | Inicialização do banco; trocar env não altera senha de banco existente |
| `REDIS_URL` | `redis://localhost:6379` | Cache/coordenação; Compose usa host `redis` |
| `QUEUE_DRIVER` | `bullmq` | Seleciona o driver de fila durável: `bullmq` (Redis) ou `memory` (testes locais) |
| `QUEUE_CONCURRENCY` | `5` | Quantidade máxima de jobs processados simultaneamente por worker |
| `QUEUE_DEFAULT_MAX_ATTEMPTS` | `3` | Número máximo de retentativas antes de enviar o job à DLQ |
| `QUEUE_DEFAULT_BACKOFF_MS` | `1000` | Intervalo base em milissegundos para cálculo de backoff exponencial |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | `15000` | Timeout total em milissegundos para encerramento gracioso e drenagem de HTTP/jobs |
| `ADMIN_REGISTRATION_TOKEN` | Ausente: cadastro administrativo público | Quando configurado, exige convite privado de pelo menos 32 caracteres em novos cadastros por senha ou social |
| `JWT_SECRET` | Obrigatório, mínimo 16 caracteres | Assinatura de sessão; use alta entropia |
| `MASTER_SECRET_KEY` | Obrigatório, mínimo 16 caracteres | Entrada para derivação SHA-256 da chave AES do cofre; não exige formato hex, mas recomenda-se gerar segredo aleatório |
| `INTERNAL_SERVICE_KEY` | Obrigatório, mínimo 16 caracteres | Integrações internas; não é uma chave EVM |
| `SENDER_DOMAIN` | `empresaA.com` | Identidade padrão de envio, deve ser configurada |
| `MAIVW_CORE_DOMAIN` | `maivw.org` | Sugestões de DNS e endpoint no onboarding; não substitui `SENDER_DOMAIN` |
| `PLATFORM_INGRESS_HOSTS` | Vazio | Lista adicional de hosts reconhecidos no roteamento |
| `IS_CLOUD` | `false` | Aceita `true` ou `false`; não transforma o Compose em serviço de nuvem |
| `DEFAULT_P2P_ENDPOINT` | Opcional | URL concreta; HTTP é aceito somente no Anvil local, outras redes exigem HTTPS |
| `TLS_CERT_PATH` | Opcional (default `data/certs/node.crt`) | Caminho do certificado público TLS X.509 em formato PEM |
| `TLS_KEY_PATH` | Opcional (default `data/certs/node.key`) | Caminho da chave privada TLS correspondente ao certificado |
| `MTLS_STRICT_MODE` | `false` | Se `true`, impõe verificação estrita de mTLS mesmo para nós sem ancoragem |
| `TRUST_PROXY` | `false` | Se `true`, aceita cabeçalho `x-client-cert-fingerprint-sha256` proveniente de proxy reverso confiável |

Não troque `MASTER_SECRET_KEY` em banco existente sem recifrar chaves e credenciais. Não há ferramenta de migração pronta para isso.

## Workers separados e execução durável

Community `all-in-one` não exige URLs internas, credenciais AWS, Firebase ou
Cloudflare. O Compose local mantém filas consumidoras desativadas por padrão e
atende envio/denúncia de forma síncrona, com persistência da operação no banco.

| Variável | Padrão / exigência | Uso |
| --- | --- | --- |
| `MAIL_WORKER_INTERNAL_URL` | Ausente | Destino fixo do proxy de envio; vazio em all-in-one |
| `ORACLE_WORKER_INTERNAL_URL` | Ausente | Destino fixo do proxy de denúncia/oráculo |
| `RELAYER_WORKER_INTERNAL_URL` | Ausente | Endereço interno reservado ao relayer; não publica curingas |
| `ORACLE_OPERATOR_EMAILS` | Vazio | Allowlist de operadores da plataforma; admin de tenant não basta |
| `WORKER_PROXY_TIMEOUT_MS` | `15000` | Prazo do proxy; POST não é repetido automaticamente |
| `WORKER_PROXY_BODY_LIMIT_BYTES` | `1048576` | Limite do corpo encaminhado e da resposta |
| `MAIL_QUEUE_CONSUMER_ENABLED` | `false` | Ativa mail:send somente em mail-worker/all-in-one |
| `ORACLE_QUEUE_CONSUMER_ENABLED` | `false` | Ativa oracle:dispute somente em oracle-worker/all-in-one |
| `RELAYER_QUEUE_CONSUMER_ENABLED` | `false` | Exige espelhamento configurado e relayer-worker/all-in-one |
| `EVM_ORIGIN_PROFILE_MODE` | `CURRENT` | ABI da origem; LEGACY_V1 exige seleção explícita |
| `EVM_OBSERVER_START_BLOCK` | `0` | Ajustar ao bloco do deploy em rede pública; cursor persiste no banco |
| `EVM_OBSERVER_MAX_BLOCKS` | `200` | Máximo de blocos por ciclo |
| `EVM_OBSERVER_POLL_INTERVAL_MS` | `5000` | Intervalo entre ciclos concluídos, sem sobreposição |
| `RELAYER_EVM_KMS_KEY_ID` | Ausente | Signer próprio do relayer EVM, não herdado do oráculo |
| `RELAYER_EVM_PRIVATE_KEY` | Ausente | Alternativa local fora do Cloud; nunca registrar no Git |

No driver BullMQ, Redis é obrigatório; não há fallback silencioso para memória.
Jobs novos referenciam uma operação durável, sem carregar credenciais. Após efeito
incerto, repetir o job não autoriza outro envio/punição; exige reconciliação.
Uma mesma tentativa HTTP de envio deve reutilizar `Idempotency-Key`.

## Armazenamento de objetos e anexos

| Variável | Padrão / exigência | Uso |
| --- | --- | --- |
| `STORAGE_DRIVER` | `filesystem` | Seleciona o driver de armazenamento de objetos: `filesystem` (local) ou `s3` (compatível com AWS S3, Cloudflare R2 e MinIO) |
| `ATTACHMENTS_DIR` | `data/attachments` | Diretório base para persistência local de anexos quando `STORAGE_DRIVER=filesystem` |
| `STORAGE_MAX_FILE_SIZE_BYTES` | `26214400` (25MB) | Limite máximo em bytes para uploads de arquivos binários no ObjectStorage |
| `STORAGE_SIGNED_URL_EXPIRES_SECONDS` | `900` (15 min) | Tempo de vida padrão em segundos para URLs pré-assinadas de upload e download |
| `S3_ENDPOINT` | Opcional | Endpoint S3 customizado (obrigatório para Cloudflare R2 ou MinIO, ex: `https://<id>.r2.cloudflarestorage.com`) |
| `S3_BUCKET` | Obrigatório se `STORAGE_DRIVER=s3` | Nome do bucket S3 ou R2 de destino |
| `S3_REGION` | `auto` | Região do bucket (ex: `us-east-1` para AWS ou `auto` para Cloudflare R2) |
| `S3_ACCESS_KEY_ID` | Obrigatório se `STORAGE_DRIVER=s3` | Chave de acesso (Access Key ID) para autenticação AWS SigV4 nativa |
| `S3_SECRET_ACCESS_KEY` | Obrigatório se `STORAGE_DRIVER=s3` | Segredo de acesso (Secret Access Key) para autenticação AWS SigV4 nativa |
| `S3_FORCE_PATH_STYLE` | `true` | Se `true`, utiliza URLs no formato path-style (`endpoint/bucket/key`), ideal para MinIO e R2 |

## Blockchain e assinantes

| Variável | Padrão / exigência | Uso |
| --- | --- | --- |
| `RPC_URL` | `http://localhost:8545`; Compose usa `http://anvil:8545` | RPC principal |
| `CHAIN_ID` | `31337`; modelo de Testnet usa `84532` | Rede principal |
| `REGISTRY_CONTRACT_ADDRESS` | Automático no Compose local; obrigatório fora dele | Endereço do proxy; o local lê `/deploy-output/contract-address.txt` |
| `BASE_RPC_URL` | `http://localhost:8545`; Testnet deve configurar | Caminhos Base/multichain |
| `BASE_WS_URL` | Exigida quando Base participa do relayer | Observer/finalidade Base |
| `BASE_REGISTRY_ADDRESS` | Opcional | Registro Base; não substitui globalmente `REGISTRY_CONTRACT_ADDRESS` |
| `ARBITRUM_RPC_URL` | `https://sepolia-rollup.arbitrum.io/rpc` | Caminhos Arbitrum |
| `ARBITRUM_WS_URL` | Exigida junto ao Registry quando o relayer está ativo | Observer Arbitrum |
| `ARBITRUM_REGISTRY_ADDRESS` | Opcional | Registry da rede correspondente |
| `POLYGON_RPC_URL` | `https://rpc-amoy.polygon.technology` | Caminhos Polygon |
| `POLYGON_WS_URL` | Exigida junto ao Registry quando o relayer está ativo | Observer Polygon |
| `POLYGON_REGISTRY_ADDRESS` | Opcional | Registry da rede correspondente |
| `MIRROR_REGISTRY_V2_ADDRESS` | Opcional | Endereço do contrato de mirror V2 em redes EVM |
| `MULTICHAIN_RELAY_ENABLED` | `false` | Exige signer e ao menos dois deployments completos |
| `SOLANA_ENABLED` | `false` | Ativa adapter Solana com RPC, WS, genesis e program; segredos adicionais dependem do papel |
| `SOLANA_RPC_URL` / `SOLANA_WS_URL` | Obrigatórias com Solana | RPC e stream do cluster configurado |
| `SOLANA_GENESIS_HASH` / `SOLANA_PROGRAM_ID` | Obrigatórias com Solana | Impedem aceitar RPC ou programa de outro deployment |
| `SOLANA_COMMITMENT` | Somente `finalized` | Leituras e observers não aceitam estado não finalizado |
| `SOLANA_EXPLORER_URL` | `https://explorer.solana.com` | Base URL do Explorer para links de auditoria |
| `SOLANA_EXPLORER_CLUSTER_QUERY` | `custom` ou `devnet` | Parâmetro de cluster para montagem de URLs no Explorer |
| `SOLANA_ASSET_KIND` | `NATIVE` ou `SPL` | Define tipo de ativo (SOL nativo ou token SPL) |
| `SOLANA_ASSET_SYMBOL` | `SOL` ou símbolo SPL | Símbolo monetário exibido na telemetria |
| `SOLANA_ASSET_DECIMALS` | `9` (SOL) ou conforme SPL | Casas decimais do ativo econômico Solana |
| `SOLANA_ASSET_MINT` | Pubkey base58 | Endereço do Mint SPL (vazio quando nativo) |
| `SOLANA_STANDARD_FEE_BASE_UNITS` | Unidades base | Taxa de registro padrão em lamports ou unidades mínimas do token |
| `SOLANA_RELAYER_PUBLIC_KEY` | Obrigatória em `relayer-worker` e `all-in-one` com Solana e relay habilitados | Fee payer/assinante público do relayer |
| `SOLANA_RELAYER_SIGNER_TYPE` | `local` | `local` para self-hosting ou `aws-kms` para Ed25519 não exportável; Maivw Cloud production exige `aws-kms` |
| `SOLANA_RELAYER_KMS_KEY_ID` | Obrigatória com signer `aws-kms` | ID, ARN ou alias de chave `ECC_NIST_EDWARDS25519` com uso `SIGN_VERIFY` |
| `SOLANA_RELAYER_KEYPAIR_PATH` | Alternativa local nos papéis de relayer | Caminho de segredo montado; nunca versionar o keypair |
| `SOLANA_RELAYER_KEYPAIR_BASE64` | Alternativa para secret manager nos papéis de relayer | Array JSON de 64 bytes codificado em base64 |
| `SOLANA_REORG_MARGIN_SLOTS` | `64` | Margem operacional do cluster |
| `SOLANA_OBSERVER_START_SLOT` | Opcional | Slot inicial para backfill manual do indexador |
| `SOLANA_OBSERVER_POLL_INTERVAL_MS` | `5000` | Intervalo em milissegundos entre polls do observador Solana |
| `SOLANA_OBSERVER_PAGE_SIZE` / `SOLANA_OBSERVER_MAX_PAGES` | `100` / `10` | Limites de backfill por poll |
| `RELAY_ATTESTATION_TTL_SECONDS` | `900` | Entre 60 e 86400 segundos |
| `RELAY_LEASE_SECONDS` / `RELAY_FAILURE_THRESHOLD` | `60` / `3` | Lease do worker e limiar do circuit breaker |
| `MULTICHAIN_ALERT_INDEXER_LAG_SLOTS` | `128` | Limiar de slots de atraso para disparar alerta INDEXER_LAG |
| `ORACLE_SIGNER_TYPE` | `local` | `local`, `gcp-kms` ou `aws-kms` |
| `ORACLE_PRIVATE_KEY` | Obrigatória para signer local | Chave EVM, prefixo `0x` e 32 bytes; autoridade depende do contrato |
| `GCP_KMS_KEY_VERSION` | Obrigatória para `gcp-kms` | Recurso da versão de chave compatível |
| `GCP_KMS_CREDENTIALS_BASE64` | Opcional | JSON de credenciais codificado; caso contrário usa autenticação do ambiente |
| `AWS_KMS_KEY_ID` | Opcional | Identificador ou ARN de chave assimétrica secp256k1 no AWS KMS |
| `ORACLE_MIN_BALANCE_WEI` | `10000000000000000` | Limiar informativo de saldo baixo |
| `MAIVW_ORACLE_URL` | `http://localhost:3001`; Testnet exige valor explícito | Dependência remota em caminhos do onboarding; HTTPS é obrigatório fora de `local` |
| `DEPLOYER_PRIVATE_KEY` | Opcional no Gateway | Scripts de implantação e alguns caminhos de carteira/telemetria; não é chave pública |
| `COMPANY_A_PRIVATE_KEY` | Opcional | Assinante de fallback; sem ela o Gateway gera chave efêmera |
| `COMPANY_B_PRIVATE_KEY` | Opcional | Campo legado/teste; não é pré-requisito do piloto |
| `PROVIDER_PRIVATE_KEY` | Opcional | Campo legado/teste; não é pré-requisito do piloto |

`BASE_REGISTRY_LENS_ADDRESS` não é consumida pelo Gateway atual. Fora do Anvil local, a inicialização rejeita Registry ausente, segredos `local-demo-*`, chave pública #0 do Anvil e endpoint P2P HTTP.

## SMTP, juiz e módulos com configuração direta

| Variável | Uso |
| --- | --- |
| `RESEND_API_KEY` | Provedor de saída padrão opcional; configuração por domínio também existe no banco |
| `SES_ENABLED` | Ativa o adaptador Amazon SESv2 para a ponte SMTP legada; usa credenciais temporárias da task role |
| `SES_REGION` | Região da identidade SES e do configuration set |
| `SES_CONFIGURATION_SET` | Configuration set usado para eventos de envio, entrega, bounce e complaint |
| `SES_FROM_EMAIL` | Remetente fixo e verificado usado pela ponte SES; quando ausente, usa o remetente da mensagem |
| `LEGACY_WEBHOOK_SECRET` | Proteção do webhook legado; vazio desabilita a exigência no handler atual |
| `ORACLE_AI_JUDGE_URL` | Endpoint opcional do juiz semântico remoto |
| `ORACLE_AI_JUDGE_TOKEN` | Credencial do juiz remoto |
| `FIREBASE_AUTH_ENABLED` | Ativa login social; desativado por padrão na Community Edition |
| `FIREBASE_PROJECT_ID` | Projeto Firebase explícito usado para validar `aud` e `iss` |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Opção local: caminho explícito da credencial no container |
| `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | Opção para secret manager: JSON da service account codificado em base64; não versionar |
| `FIREBASE_ALLOWED_PROVIDERS` | Provedores aceitos pelo Gateway; padrão `google.com,github.com` |
| `INGRESS_PROXY_ENABLED` | Leitura direta; somente string `true` ativa o proxy de ingresso |
| `DEFAULT_SECONDARY_INGRESS_URL` | Rota secundária; código tem fallback remoto MAIVW |
| `NODE_ENV` | Ambiente do processo; container usa `production`, sem significar validação de segurança concluída |

O processador de anexos também usa `NEXT_PUBLIC_GATEWAY_URL` como fallback. Para instalação independente, configure os endpoints concretos e revise rotas criadas automaticamente.

## Frontend e build

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_GATEWAY_URL` | API acessível pelo navegador |
| `NEXT_PUBLIC_RPC_URL` | RPC público no ambiente de build; o Anvil usa `http://localhost:55443` |
| `NEXT_PUBLIC_CHAIN_ID` | Rede da interface nos caminhos que consomem a variável |
| `NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS` | Proxy configurado para operações da interface |
| `NEXT_PUBLIC_WEBMAIVW_URL` | Links do Dashboard para Webmail |
| `NEXT_PUBLIC_DASHBOARD_URL` | Argumento previsto no Dockerfile; não implica uso por todas as telas |
| `NEXT_PUBLIC_PAYMENT_API_URL` | Integração externa de pagamentos; serviço não incluído no Compose |
| `NEXT_PUBLIC_DEFAULT_ORIGIN_NETWORK` | Rede de registro padrão no onboarding (`base`, `solana`, `arbitrum`, `polygon`; padrão `base`) |

Mudanças de `NEXT_PUBLIC_*` exigem rebuild. Firebase é a exceção: o WebMaivw lê `FIREBASE_PUBLIC_API_KEY`, `FIREBASE_PUBLIC_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_PUBLIC_STORAGE_BUCKET`, `FIREBASE_PUBLIC_MESSAGING_SENDER_ID`, `FIREBASE_PUBLIC_APP_ID` e `FIREBASE_ALLOWED_HOSTS` em runtime por `GET /api/config/firebase`. Essa configuração é pública e não substitui a credencial de serviço do Gateway. Valores ausentes fazem o login social falhar fechado, sem recorrer a projeto compartilhado.
