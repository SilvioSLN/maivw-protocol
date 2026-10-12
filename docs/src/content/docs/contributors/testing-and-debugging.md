---
title: Testes e Depuração
description: Como executar suítes de testes unitários, testes de contratos inteligentes com Foundry e depurar serviços localmente.
---

Garantir a integridade criptográfica e a estabilidade do nó requer testes contínuos em diferentes camadas do sistema. Este guia apresenta como rodar testes e depurar problemas no **MAIVW Protocol**.

---

## ⚡ 1. Testes de Contratos na Blockchain (Foundry / Forge)

Os contratos de identidade, registro, herança wildcard e arbitragem são validados usando o **Foundry**:

```bash
cd contracts
forge test -vvv
```

### O que os testes de contratos cobrem:
- Registro de domínios corporativos com chave pública e prazo de voucher do oráculo.
- Atualização autorizada de endpoint HTTP/P2P versus tentativas de alteração não autorizadas (revert).
- Resolução e herança de subdomínio via camada Lens.
- Bloqueio de domínios infratores e execução de `slashDomain` pelo oráculo.
- Consumo e limites de gas na rede Base L2.

---

## 🔬 2. Testes Automatizados do Gateway (Node / tsx)

O Gateway utiliza TypeScript e o test runner nativo do Node.js executado via `tsx`:

```bash
cd gateway
npm test
```

### Principais suítes de teste existentes (`gateway/test/`):
- **`GcpKmsAccount.test.ts`**: Assinatura criptográfica via Google Cloud KMS / Cloud HSM com decodificação ASN.1 DER para r/s normalizado.
- **`OracleService.test.ts`**: Emissão de vouchers de atestação EIP-712 e checagem de saldo do oráculo.
- **`RoutingPoolService.test.ts`**: Roteamento dinâmico multi-cluster, circuit breaker e Weighted Round-Robin.
- **`SemanticJudge.test.ts`**: Classificador semântico heurístico e por inteligência artificial para detecção de Tag Spoofing.

---

## 🎬 3. Teste Integrado com Docker Compose

Para validar toda a stack operando em conjunto:

```bash
# 1. Suba todos os serviços
docker compose up -d

# 2. Verifique o status dos containers
docker compose ps

# 3. Teste o endpoint de saúde do Gateway
curl http://localhost:3001/health
```

Acesse o Webmail em `http://localhost:3002` e o Dashboard em `http://localhost:3000` para validar o fluxo de envio e recebimento de e-mails.

---

## 🔍 4. Depuração e Inspeção de Logs

Quando estiver investigando comportamentos anômalos em containers ou durante desenvolvimento:

### Inspecionar logs do Gateway
```bash
docker compose logs -f gateway
```

### Inspecionar logs do Webmail
```bash
docker compose logs -f webmaivw
```

### Depurar o Banco PostgreSQL
```bash
# Acessar console psql interativo do banco do nó
docker compose exec postgres psql -U postgres -d maivw_reputation
```

Consultas úteis:
```sql
-- Verificar mensagens recebidas e enviadas
SELECT id, "messageId", "from", "to", "subject", "msgClass", status, "receivedAt" 
FROM "Message" 
ORDER BY "receivedAt" DESC 
LIMIT 10;

-- Verificar histórico de reputação por domínio
SELECT domain, "subIdentityId", "reputationScore", "isBlocked", strikes 
FROM "Reputation";
```
