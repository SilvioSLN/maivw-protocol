---
title: Diagnóstico & Resolução de Problemas (Troubleshooting)
description: Soluções práticas para os problemas mais comuns enfrentados ao operar um nó MAIVW.
---

Se o seu nó estiver apresentando instabilidade, falhas no envio P2P ou dificuldades na verificação DNS, utilize este guia para diagnosticar e resolver os incidentes rapidamente.

---

## 🩺 1. Verificando o Estado dos Serviços

O primeiro passo é verificar se todos os containers estão ativos:

```bash
docker compose ps
```

Para visualizar os logs em tempo real do serviço que estiver com falhas (ex: o `gateway`):

```bash
docker compose logs -f gateway
```

---

## 🛑 2. Problemas Mais Comuns e Como Resolver

### A. "Meu e-mail P2P falha ao entregar para outros nós"

**Sintoma:** Ao enviar para outro domínio MAIVW, a mensagem fica presa na fila ou retorna erro de conexão P2P.

**Causas e Soluções:**
1. **Endpoint não acessível pela internet pública:**
   - O endereço configurado em `PUBLIC_ENDPOINT_URL` no `.env` precisa ser uma URL pública com certificado SSL/TLS válido (HTTPS).
   - Verifique se a porta `3001` (ou a porta do seu reverse proxy Nginx/Traefik/Caddy) está liberada no firewall:
     ```bash
     curl -I https://mw.minhaempresa.com.br/api/v1/inbox
     ```
     O comando deve retornar `405 Method Not Allowed` ou `400 Bad Request` (o que indica que a rota existe e está acessível para POSTs autenticados).
2. **Certificado SSL autoassinado ou inválido:**
   - O protocolo MAIVW rejeita conexões HTTP sem criptografia ou com certificados expirados para prevenir ataques Man-in-the-Middle. Use certificados válidos gerados pelo **Let's Encrypt** ou **Cloudflare SSL**.

---

### B. "O Oráculo não valida meu registro DNS TXT"

**Sintoma:** Na tela de Onboarding, ao clicar em "Verificar DNS", surge mensagem de registro TXT não localizado ou token divergente.

**Causas e Soluções:**
1. **Tempo de propagação DNS:**
   - Alguns provedores de DNS demoram até 15 minutos para propagar registros TXT.
   - Teste no terminal consultando diretamente servidores mundiais de DNS:
     ```bash
     # Consulta via Google DNS (8.8.8.8)
     dig @8.8.8.8 +short TXT _maivw-verify.minhaempresa.com.br

     # Consulta via Cloudflare DNS (1.1.1.1)
     dig @1.1.1.1 +short TXT _maivw-verify.minhaempresa.com.br
     ```
2. **Formatação incorreta no provedor:**
   - Certifique-se de que o nome da entrada é `_maivw-verify` (e não `@` ou `_maivw-verify.minhaempresa.com.br.minhaempresa.com.br` por duplicação do painel).
   - Verifique se o valor do registro corresponde exatamente a `maivw-verification=<token>` com o token de 32 caracteres gerado no assistente do seu nó.

---

### C. "Transação revertida / Falha de Gas na Blockchain"

**Sintoma:** O Gateway emite o erro `insufficient funds for intrinsic transaction cost` ou `execution reverted` ao tentar registrar o domínio on-chain.

**Causas e Soluções:**
1. **Saldo de ETH insuficiente na carteira do nó:**
   - A carteira correspondente à sua `DEPLOYER_PRIVATE_KEY` precisa de uma fração de ETH para cobrir o gas da transação no contrato.
   - Na testnet (**Base Sepolia**), você pode obter ETH gratuito em faucets oficiais:
     - [Superchain Faucet](https://console.optimism.io/faucet)
     - [Coinbase Base Sepolia Faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet)
   - Na **Base Mainnet**, o gas de registro custa menos de **R$ 0,05**, mas a carteira deve ter saldo suficiente para cobrir o `standardFee` do contrato.

---

### D. "Porta 3001 ou 3002 já está em uso"

**Sintoma:** O Docker Compose falha ao subir com o erro: `Bind for 0.0.0.0:3001 failed: port is already allocated`.

**Solução:**
Se você já tiver outra aplicação rodando nessas portas na sua máquina, altere o mapeamento no arquivo `docker-compose.yml`:

```yaml
gateway:
  ports:
    - "3011:3001" # Altera a porta externa no host para 3011
webmaivw:
  ports:
    - "3012:3002" # Altera a porta externa no host para 3012
```

---

## 💾 3. Backup e Migração de Servidor

Para migrar seu nó para um novo servidor ou criar uma cópia de segurança completa:

1. **Faça backup do arquivo de ambiente:**
   ```bash
   cp .env /backup/maivw-env-backup.env
   ```
2. **Exporte o banco de dados PostgreSQL:**
   ```bash
   docker compose exec -T postgres pg_dump -U postgres maivw_reputation > /backup/maivw_dump.sql
   ```
3. **No novo servidor:**
   - Restaure o arquivo `.env`.
   - Suba os containers com `docker compose up -d`.
   - Importe o dump do banco:
     ```bash
     cat /backup/maivw_dump.sql | docker compose exec -T postgres psql -U postgres -d maivw_reputation
     ```
   Seu nó continuará operando exatamente com as mesmas caixas, chaves e credenciais.
