---
title: Deploy com Docker Compose
description: Detalhes da arquitetura de containers, portas, volumes e orquestração do stack MAIVW Community.
---

O arquivo `docker-compose.yml` na raiz do repositório do protocolo provisiona todo o ambiente de forma desacoplada e isolada.

## Tabela de Serviços e Portas

| Serviço | Imagem / Build | Porta Host | Descrição |
| :--- | :--- | :--- | :--- |
| `postgres` | `postgres:16-alpine` | `5432` | Banco PostgreSQL com banco `maivw_reputation` |
| `redis` | `redis:7-alpine` | `6379` | Fila BullMQ e cache em memória |
| `gateway` | `./gateway` (Node 20+) | `3001` | Gateway HTTP/Fastify e protocolo P2P |
| `webmaivw` | `./webmaivw` (Next.js 15) | `3002` | Interface webmail do usuário |
| `dashboard` | `./dashboard` (Next.js) | `3000` | Dashboard de nós e reputação on-chain |

## Estrutura de Volumes e Persistência

Para garantir que os dados não sejam perdidos entre reinicializações de containers, os volumes são mapeados localmente:

- `./data/postgres`: Mapeado para `/var/lib/postgresql/data` (armazena usuários, chaves cifradas e metadados de mensagens).
- `./data/redis`: Mapeado para `/data` com `--appendonly yes` (persistência das filas de tarefas).

> **Dica de Produção:** Certifique-se de adicionar a pasta `./data/` ao seu `.gitignore` e configurar rotinas de backup regulares para o diretório `./data/postgres`.

## Comandos Úteis

### Iniciar em background
```bash
docker compose up -d
```

### Visualizar logs em tempo real
```bash
# Todos os serviços
docker compose logs -f

# Apenas o Gateway
docker compose logs -f gateway

# Apenas o Webmail
docker compose logs -f webmaivw
```

### Reconstruir imagens após atualizações
```bash
docker compose build --no-cache
docker compose up -d
```

### Parar e remover os containers
```bash
# Para os containers mantendo os volumes de dados
docker compose down

# ATENÇÃO: Para e remove também os volumes locais
docker compose down -v
```

## Health Checks Integrados

O Gateway depende da inicialização completa do PostgreSQL e do Redis antes de subir. Isso é garantido por blocos `healthcheck` e `condition: service_healthy` no `docker-compose.yml`:

```yaml
gateway:
  depends_on:
    redis:
      condition: service_healthy
    postgres:
      condition: service_healthy
```
