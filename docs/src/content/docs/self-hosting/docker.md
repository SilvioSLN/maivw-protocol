---
title: Serviços, portas e persistência
description: Referência dos Compose local e Testnet, portas e volumes.
---

O procedimento completo está em [instalação com Docker](/users/quickstart-docker/).

| Serviço | Porta no host | Persistência |
| --- | --- | --- |
| Dashboard | `127.0.0.1:50443` | Consulta Gateway e blockchain |
| Gateway | `127.0.0.1:51443` | `./data/attachments` e `./data/certs` |
| WebMaivw | `127.0.0.1:52443` | Dados de negócio no Gateway |
| PostgreSQL 16 | `127.0.0.1:53443` | `./data/postgres` |
| Redis 7 | `127.0.0.1:54443` | `./data/redis`, AOF habilitado |
| Anvil local | `127.0.0.1:55443` | volume `anvil-state` |
| Endereço do deploy local | sem porta | volume `deploy-output` |

`docker-compose.yml` é a demonstração local e funciona sem `.env`. `compose.testnet.yml` exige `--env-file .env.testnet` preenchido a partir de `.env.testnet.example`. Não misture os arquivos: o primeiro contém credenciais públicas de desenvolvimento e o segundo exige dados próprios.

Todos os serviços usam uma rede Docker privada nomeada. O ambiente local usa `maivw-protocol-local-network` e a Testnet usa `maivw-protocol-testnet-network`, evitando resolução acidental de serviços homônimos de outros projetos. Para executar várias instalações do MAIVW na mesma máquina, defina um valor exclusivo em `MAIVW_DOCKER_NETWORK` no arquivo de ambiente de cada instalação.

Os diretórios de dados são bind mounts. `docker compose down -v` remove os volumes nomeados do Anvil e do endereço implantado, mas não apaga `./data/postgres`, `./data/redis`, anexos ou certificados. Remover apenas um dos volumes blockchain/deploy cria inconsistência; recrie ambos juntos se desejar zerar a demonstração.

## Ordem de inicialização

O Anvil fica saudável, `contracts-deployer` compila e implanta ou reutiliza o proxy existente, e o Gateway lê `/deploy-output/contract-address.txt`. O Gateway aguarda também PostgreSQL e Redis. Webmail e Dashboard aguardam o health check completo do Gateway.

```bash
docker compose logs --tail=100 contracts-deployer gateway
docker compose restart gateway
docker compose up -d --build
docker compose down
```

Os Dockerfiles do Gateway, Webmail e Dashboard usam lockfiles. A imagem Foundry está fixada por digest. Imagens base restantes ainda usam tags e devem entrar na política de atualização do operador.

Ao iniciar, o Gateway executa `prisma db push`. Isso é conveniente para a demonstração, mas não substitui migrations versionadas, backup e um procedimento de atualização de produção. Variáveis `NEXT_PUBLIC_*` entram no JavaScript durante o build; alterá-las exige `--build`.
