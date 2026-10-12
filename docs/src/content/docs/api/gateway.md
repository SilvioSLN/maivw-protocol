---
title: Gateway REST API
description: Referência dos principais endpoints HTTP expostos pelo nó Gateway Fastify.
---

O **Gateway MAIVW** expõe uma API REST tipada para clientes de e-mail (como o WebMaivw), integrações backend e nós parceiros via protocolo P2P.

## Autenticação

A maioria das rotas de usuário e administração requer o cabeçalho:
```http
Authorization: Bearer <token_jwt>
```
Para microsserviços e integrações de envio via API, chaves de API também são suportadas:
```http
Authorization: Bearer maivw_live_sk_...
```

---

## ✉️ Rotas de Envio & Mensagens

### `POST /api/v1/send`
Dispara uma mensagem para um destinatário P2P MAIVW ou endereço de e-mail tradicional (via fallback SMTP).

#### Request Body
```json
{
  "to": "bob@parceiro.com.br",
  "subject": "Acordo de Cooperação Técnica",
  "msgClass": "CONVERSATION",
  "content": {
    "text": "Segue em anexo o documento assinado.",
    "html": "<p>Segue em anexo o documento assinado.</p>",
    "attachments": [
      {
        "id": "att-01",
        "filename": "contrato.pdf",
        "mimeType": "application/pdf",
        "size": 1048576,
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "url": "/api/v1/attachments/att-01"
      }
    ]
  },
  "recipients": ["copia@parceiro.com.br"]
}
```

> **Classes de Mensagem Permitidas (`msgClass`):**
> `TX_CODE` (segurança/OTP), `TX_RECEIPT` (comprovantes/faturas), `SUPPORT` (atendimento), `CONVERSATION` (comunicação humana direta), `MARKETING` (newsletters/campanhas) e `COLD_OUTREACH` (prospecção).

#### Response (`200 OK`)
```json
{
  "success": true,
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "route": "web3",
  "recipientDomain": "parceiro.com.br",
  "message": "Mensagem enviada com sucesso via Protocolo MAIVW (Web3 P2P)"
}
```

---

## 📥 Rotas de Caixa de Entrada (Inbox)

### `GET /api/v1/inbox/messages`
Lista as mensagens da caixa postal do usuário autenticado.

#### Query Parameters
- `limit`: Quantidade máxima de itens a retornar (padrão: `50`).
- `folder`: Pasta desejada — `inbox` (padrão), `sent`, `trash`, `spam` ou `quarantine`.
- `isLegacy`: Filtra e-mails legados (`true`) ou nativos Web3 P2P (`false`).

#### Response (`200 OK`)
```json
{
  "total": 42,
  "folder": "inbox",
  "counts": {
    "inbox": 42,
    "sent": 15,
    "spam": 0,
    "trash": 3
  },
  "messages": [
    {
      "id": 101,
      "messageId": "550e8400-e29b-41d4-a716-446655440000",
      "from": "alice@empresa.com.br",
      "to": "bob@parceiro.com.br",
      "subject": "Acordo de Cooperação Técnica",
      "body": "{\"text\":\"Segue em anexo...\",\"html\":\"<p>Segue...</p>\"}",
      "msgClass": "CONVERSATION",
      "status": "received",
      "signature": "0x7f8a9...",
      "isLegacy": false,
      "isRead": false,
      "receivedAt": "2026-10-11T04:30:00.000Z"
    }
  ]
}
```

### `PATCH /api/v1/inbox/messages/:id`
Atualiza o estado de leitura ou move a mensagem para a lixeira.
```json
{
  "isRead": true,
  "moveToTrash": false
}
```

### `PATCH /api/v1/inbox/messages/:id/restore`
Restaura uma mensagem da lixeira de volta para a caixa de entrada.

### `DELETE /api/v1/inbox/messages/:id`
Exclui permanentemente uma mensagem da lixeira.

### `DELETE /api/v1/inbox/trash/empty`
Esvazia todas as mensagens da lixeira do usuário autenticado.

---

## 🤝 Receptor P2P Direto (Servidor para Servidor)

### `POST /api/v1/inbox`
Endpoint HTTP direto consumido pelo Gateway remoto para entregar envelopes autenticados.

#### Cabeçalhos do Protocolo
- `x-maivw-sender`: Domínio remetente verificado na blockchain.
- `x-maivw-intent-tx`: Hash da transação na blockchain comprovando a intenção de envio.
- `x-maivw-sub-identity` *(opcional)*: Sub-identidade do remetente (para provedores multi-tenant).
- `x-maivw-intent-root` e `x-maivw-intent-proof` *(opcionais)*: Raiz e prova Merkle para lotes de mensagens.
- `x-maivw-stealth-token` *(opcional)*: Token de autorização para domínios em Modo Stealth.

#### Response (`202 Accepted`)
```json
{
  "status": "accepted",
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "senderDomain": "empresa.com.br",
  "subIdentityId": "default",
  "merkleVerified": false,
  "message": "Mensagem de empresa.com.br validada e aceita para a caixa de entrada"
}
```

---

## 📎 Anexos Criptográficos

### `POST /api/v1/attachments/upload`
Upload de anexo via formulário multipart (`multipart/form-data`). Retorna os metadados com cálculo automático de hash SHA-256 e ID único.

### `GET /api/v1/attachments/:id`
Download de anexo previamente validado.

---

## 🩺 Diagnóstico e Status do Nó

### `GET /health`
Verifica a integridade operacional do nó, conectividade com Redis, status da blockchain e saldo do oráculo.

```bash
curl http://localhost:3001/health
```

```json
{
  "status": "ok",
  "service": "maivw-gateway",
  "timestamp": "2026-10-11T05:50:00.000Z",
  "blockchain": "online",
  "redis": "online",
  "smtp": {
    "provider": "resend",
    "configured": true
  },
  "oracle": "0x0000000000000000000000000000000000000000",
  "oracleSignerType": "local",
  "oracleBalanceWei": "150000000000000000",
  "oracleBalanceLow": false,
  "contractAddress": "0x5FbDB2315678afecb367f032d93F642f64180aa3"
}
```

### `GET /api/v1/status`
Retorna versão do Gateway, domínio configurado, carteira assinadora e total de domínios registrados no cartório on-chain.
