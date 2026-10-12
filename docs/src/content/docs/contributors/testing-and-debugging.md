---
title: Testes e diagnóstico
description: Verificações reproduzíveis e limites da cobertura atual.
---

Execute cada bloco a partir da raiz do repositório, em terminais ou subshells separados.

```bash
(cd gateway && npm test && npm run build)
(cd contracts && forge test -vvv)
(cd docs && npm run check:docs && npm run build)
```

Prepare dependências e Prisma conforme [setup local](/contributors/local-setup/). `npm test` usa o test runner do Node com `tsx`; o padrão inclui os arquivos `.test.ts` diretamente em `gateway/test/`.

## Cobertura

O Gateway possui testes de KMS, oráculo, julgamento semântico, roteamento, parsing de configuração e saúde. Os testes de health verificam dependências offline, timeout, recuperação e saldo desconhecido. Mocks não substituem ensaio real de RPC, Redis e PostgreSQL.

Contratos têm testes de registro, economia, mirror, governança, upgrades e invariantes. A existência desses testes não demonstra uma auditoria externa concluída.

`check:docs` verifica URLs locais, slugs da navegação, inventário de rotas e cobertura das variáveis do schema. A análise de rotas é estática e usa os registros literais `app.get/post/...`; ela não prova autenticação, validação dos exemplos nem comportamento em runtime.

## Teste integrado

Siga a instalação, verifique `/health` e faça envio entre dois nós controlados e para um destino SMTP de teste. Confirme conteúdo, assinatura, anexos e persistência após recriação. Registre rede, revisão, configuração sem segredos e resultado. Teste também rejeições e recuperação de dependências.

Não execute testes de deploy contra mainnet nem use carteira com fundos reais como conta de fixture.

## Logs e banco

```bash
docker compose logs --tail=100 gateway
docker compose exec postgres psql -U postgres -d maivw_reputation
```

```sql
SELECT id, "messageId", "from", "to", subject, "msgClass", status, "receivedAt"
FROM "Message" ORDER BY "receivedAt" DESC LIMIT 10;
SELECT domain, "subIdentityId", "reputationScore", "isBlocked", strikes FROM "Reputation";
```

Os logs e consultas podem conter conteúdo de mensagens e dados pessoais. Use dados de teste e remova segredos de evidências compartilhadas.
