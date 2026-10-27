---
title: Serviços, portas e persistência
description: Referência dos Compose local e Testnet, portas e volumes.
---

O procedimento completo está em [instalação com Docker](/users/quickstart-docker/).

| Serviço | Porta no host | Persistência |
| --- | --- | --- |
| Dashboard | `127.0.0.1:50443` | Consulta Gateway e blockchain |
| Gateway | `127.0.0.1:51443` | volumes `attachments-data` e `certs-data` |
| WebMaivw | `127.0.0.1:52443` | Dados de negócio no Gateway |
| PostgreSQL 16 | `127.0.0.1:53443` | volume `postgres-data` |
| Redis 7 | `127.0.0.1:54443` | volume `redis-data`, AOF habilitado |
| Anvil local | `127.0.0.1:55443` | volume `anvil-state` |
| Endereço do deploy local | sem porta | volume `deploy-output` |

`docker-compose.yml` é a demonstração local e funciona sem `.env`. `compose.testnet.yml` exige `--env-file .env.testnet` preenchido a partir de `.env.testnet.example`. Não misture os arquivos: o primeiro contém credenciais públicas de desenvolvimento e o segundo exige dados próprios.

Todos os serviços usam uma rede Docker privada nomeada. O ambiente local usa `maivw-protocol-local-network` e a Testnet usa `maivw-protocol-testnet-network`, evitando resolução acidental de serviços homônimos de outros projetos. Para executar várias instalações do MAIVW na mesma máquina, defina um valor exclusivo em `MAIVW_DOCKER_NETWORK` no arquivo de ambiente de cada instalação.

Na demonstração local, os dados usam volumes nomeados por projeto Compose; anexos
e certificados recebem a propriedade do usuário node da imagem, sem exigir root
no Gateway. `docker compose down` preserva esses dados; `down -v` apaga todos os
volumes dessa instalação, inclusive banco e blockchain. A Testnet mantém os bind
mounts `./data/`; prepare suas permissões para UID 1000 antes de iniciar.

Se você usava o Compose local anterior com `./data/postgres`, `./data/redis`,
anexos e certificados, esses diretórios **não são importados automaticamente**.
Antes de trocar: pare os serviços, faça backup/dump, restaure no volume novo e
confira os dados; para manter o layout anterior, declare os binds em um override
Compose e mantenha as permissões adequadas. Não remova os originais até validar
a restauração. Preserve também Anvil e deploy-output em conjunto.

## Ordem de inicialização

O Anvil fica saudável, `contracts-deployer` compila e implanta ou reutiliza o proxy
existente, e o Gateway lê `/deploy-output/contract-address.txt`. O job exclusivo
`gateway-migration` executa `prisma migrate deploy` após PostgreSQL ficar saudável.
O Gateway aguarda sua saída zero, além de Redis e deploy. Migration falha bloqueia
o runtime; Webmail e Dashboard aguardam o health check completo do Gateway.

```bash
docker compose logs --tail=100 contracts-deployer gateway
docker compose restart gateway
docker compose up -d --build
docker compose down
```

Os Dockerfiles do Gateway, Webmail e Dashboard usam lockfiles. A imagem Foundry está fixada por digest. Imagens base restantes ainda usam tags e devem entrar na política de atualização do operador.

O runtime não executa `prisma db push` nem migrations em cada start. Ao atualizar,
faça backup e pare o runtime, execute o job de migration e só suba a nova aplicação
após exit zero. Restart simples do Gateway não altera o schema. O wrapper aceita
DATABASE_URL na Community e partes DB_* na AWS, sem tornar AWS uma dependência.
Variáveis `NEXT_PUBLIC_*` entram no JavaScript durante o build; alterá-las exige
`--build`.

Para reproduzir o teste de instalação limpa sem usar seu `.env` ou dados, execute
na raiz do protocolo `node scripts/test-community-install.mjs`. Ele exige Docker,
Compose e as seis portas acima livres; copia apenas fontes para diretório temporário,
usa projeto/rede/volumes novos e remove seus próprios recursos ao terminar. Não
executa deploy cloud nem envia e-mails/transações a redes públicas. O teste pode
baixar dependências e imagens para o build.

Use `node scripts/test-community-install.mjs --gateway-arm64` para repetir o
ensaio com Gateway e migrator em ARM64 (host ARM64 ou emulação já instalada).
Os demais serviços usam a arquitetura padrão do host. Esse teste é local e não
substitui a publicação por digest nem a validação da capacidade da célula AWS.
