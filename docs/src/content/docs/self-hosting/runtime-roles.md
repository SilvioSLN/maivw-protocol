---
title: Papéis de runtime
description: Como executar o Gateway em modo all-in-one ou separar API, ingresso, workers e indexadores.
---

O Gateway usa a mesma imagem e as mesmas regras de negócio em todos os modos.
`MAIVW_RUNTIME_ROLE` apenas seleciona quais grupos de rotas e loops o processo
inicia. A instalação Community continua usando `all-in-one`; uma implantação
distribuída pode replicar e escalar cada papel de forma independente.

## Perfis

| Papel | Rotas ou responsabilidade | Loops iniciados |
| --- | --- | --- |
| `all-in-one` | união de todos os grupos abaixo | health de roteamento, observer EVM e observer Solana quando habilitado |
| `gateway-api` | status, contas, configuração, onboarding, contatos, anexos, economia, stealth, routing e node | nenhum |
| `p2p-ingress` | recebimento P2P em `/api/v1/inbox` | nenhum |
| `mail-worker` | envio em `/api/v1/send` | verificação periódica do pool de roteamento |
| `oracle-worker` | denúncias, julgamento e operações do oráculo | nenhum loop durável nesta etapa |
| `relayer-worker` | solicitações e operações multichain | nenhum loop durável nesta etapa |
| `evm-indexer` | observa eventos do Registry EVM | observer EVM |
| `solana-indexer` | indexa eventos finalizados do programa Solana | observer Solana |

Os papéis `oracle-worker` e `relayer-worker` isolam hoje seus endpoints e
dependências de assinatura. O consumo assíncrono de fila, retry e DLQ entra no
contrato durável da AWS-007; não existe um loop fictício nesta versão.

## Inicialização

Em desenvolvimento ou após compilar o pacote `gateway`:

```bash
npm run dev
npm run dev:p2p-ingress
npm run build
npm run start:solana-indexer
```

Na imagem, selecione o papel somente por ambiente:

```bash
docker run --env-file .env \
  -e MAIVW_RUNTIME_ROLE=gateway-api \
  -p 127.0.0.1:3001:3001 maivw-gateway
```

O argumento do entrypoint e `MAIVW_RUNTIME_ROLE` devem coincidir. Uma
divergência encerra o processo para evitar que uma task seja rotulada como um
papel e execute outro. Todos usam a porta interna `3001`; em ECS, Kubernetes ou
Compose separados, cada container recebe sua própria interface de rede.

## Saúde e roteamento

Todo papel expõe:

- `GET /health/live`: prova que o processo responde e informa `role`;
- `GET /health`: testa apenas as dependências carregadas, informa
  `activeComponents` e retorna `503` quando uma dependência obrigatória falha.

Configure o proxy ou load balancer para encaminhar cada família de rota ao
papel proprietário. Indexadores não expõem rotas de negócio. Nunca publique as
rotas internas do oráculo ou do relayer sem sua autenticação de serviço.

## Segredos por responsabilidade

`gateway-api`, `oracle-worker`, `relayer-worker` e `all-in-one` precisam do
signer do oráculo. Com espelhamento e Solana habilitados, o keypair do relayer
fica somente em `relayer-worker` ou `all-in-one`. `solana-indexer` usa RPC, programa e banco,
mas não recebe keypair do relayer nem chave do oráculo. `p2p-ingress`,
`mail-worker` e os indexadores também não herdam esses segredos.

Os manifests Community e Testnet fixam `all-in-one` para preservar a instalação
em um comando. Separar processos é uma opção operacional, não um fork do
protocolo.
