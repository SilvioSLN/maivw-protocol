---
title: Serviços, portas e persistência
description: Referência do Compose e diferenças entre reinício, rebuild e remoção.
---

O procedimento completo está em [instalação com Docker](/users/quickstart-docker/).

| Serviço | Porta no host | Persistência |
| --- | --- | --- |
| PostgreSQL 16 | `127.0.0.1:5432` | `./data/postgres` → `/var/lib/postgresql/data` |
| Redis 7 | `127.0.0.1:6379` | `./data/redis` → `/data`, AOF habilitado |
| Gateway (Node 22) | `127.0.0.1:3001` | `./data/attachments` → `/app/data/attachments` |
| WebMaivw | `127.0.0.1:3002` | Dados de negócio no Gateway |
| Dashboard | `127.0.0.1:3000` | Consulta Gateway e blockchain |

Esses diretórios são **bind mounts**. `docker compose down -v` não apaga `./data/postgres`, `./data/redis` ou `./data/attachments`. Não use esse comando como procedimento de limpeza de dados.

## Configuração

O `.env` da raiz é carregado no Gateway por `env_file`. O bloco `environment` do Compose tem precedência para portas e conexões internas. As variáveis `NEXT_PUBLIC_*` usadas pelo Next.js são incorporadas no build; alterar somente o ambiente do container não atualiza JavaScript já compilado.

Os Dockerfiles ainda instalam dependências sem lockfile compartilhado. Não presuma builds idênticos sem fixar as versões/imagens do ambiente de implantação.

## Comandos

```bash
docker compose logs --tail=100 gateway
docker compose restart gateway
# Recriar após mudanças de código/configuração pública do frontend:
docker compose up -d --build
# Parar mantendo os diretórios persistentes:
docker compose down
```

Ao iniciar, o Gateway executa `prisma db push`. Isso sincroniza o schema, mas não substitui um histórico de migrations nem um plano de atualização de produção. Faça backup e ensaie alterações de schema antes de atualizar.

O Gateway aguarda os health checks de banco e Redis. Webmail e Dashboard aguardam `/health` do Gateway. Um nó saudável ainda pode ter SMTP inválido, saldo insuficiente ou permissões incorretas no contrato.
