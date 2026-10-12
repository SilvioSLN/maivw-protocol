---
title: Configuração de DNS (Registro.br, Cloudflare & Route 53)
description: Como configurar as entradas de DNS necessárias para vincular seu domínio à chave criptográfica do seu nó MAIVW.
---

Para que outros servidores descubram o endereço do seu Gateway e validem a chave pública do seu domínio, você deve publicar uma entrada de registro **TXT** na zona DNS do seu domínio.

---

## 🏷️ 1. Registro TXT de Verificação e Posse de Domínio

No gerenciador de DNS do seu provedor, você deve publicar o registro de prova de posse obrigatória gerado pelo seu nó:

| Campo | Valor |
| :--- | :--- |
| **Tipo** | `TXT` |
| **Nome / Host** | `_maivw-verify` (resultando em `_maivw-verify.seudominio.com.br`) |
| **Valor / Conteúdo** | `maivw-verification=a50c83f25438b...` *(token de 32 caracteres gerado no onboarding)* |
| **TTL** | `300` (5 minutos) ou Automático |

### Parâmetros & Finalidade:
- **`_maivw-verify`**: Subdomínio padronizado de verificação consultado pelo Oráculo MAIVW.
- **`maivw-verification=<token>`**: Token criptográfico determinístico que prova a titularidade do domínio na internet antes da emissão da transação on-chain no Smart Contract.

---

## 🌐 2. Passo a Passo por Provedor de DNS

### A. Registro.br
1. Acesse o painel em [registro.br](https://registro.br) e faça login.
2. Clique no domínio desejado e role até a seção **DNS**.
3. Clique em **Configurar Zona DNS** (ou **Editar Zona**).
4. Clique em **+ Nova Entrada**:
   - Selecione o tipo **TXT**.
   - No campo **Nome**, digite: `_maivw-verify`.
   - No campo **Texto**, insira: `"maivw-verification=SEU_TOKEN_AQUI"` (com aspas).
5. Clique em **Salvar Alterações**.

### B. Cloudflare
1. Acesse o painel da Cloudflare e selecione seu domínio.
2. No menu lateral, acesse **DNS** > **Registros**.
3. Clique em **Adicionar Registro**:
   - **Tipo:** `TXT`.
   - **Nome:** `_maivw-verify`.
   - **TTL:** `Automático`.
   - **Conteúdo:** `maivw-verification=SEU_TOKEN_AQUI`.
4. Clique em **Salvar**.

### C. AWS Route 53
1. Acesse o console do **Route 53** e clique em **Hosted zones**.
2. Selecione a zona do seu domínio e clique em **Create record**.
3. Preencha:
   - **Record name:** `_maivw-verify`.
   - **Record type:** `TXT`.
   - **Value:** `"maivw-verification=SEU_TOKEN_AQUI"` *(com aspas duplas)*.
   - **TTL:** `300`.
4. Clique em **Create records**.

---

## 🔍 3. Validando a Propagação do DNS

Após cadastrar o registro, teste a propagação usando a linha de comando:

```bash
# Usando a ferramenta dig (Linux / macOS)
dig TXT _maivw-verify.seudominio.com.br +short

# Saída esperada:
# "maivw-verification=SEU_TOKEN_AQUI"
```

Ou usando `nslookup` (Windows / Linux):

```bash
nslookup -type=TXT _maivw-verify.seudominio.com.br
```

Assim que a resposta retornar o token de verificação, seu nó estará pronto para solicitar a validação pelo oráculo e registrar o domínio no contrato na blockchain.
