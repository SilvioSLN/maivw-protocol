---
title: Especificação do Handshake P2P & Envio Direto
description: Especificação técnica da comunicação peer-to-peer entre nós do Gateway MAIVW, formatos de requisição, cabeçalhos criptográficos e prova de entrega.
---

O protocolo MAIVW utiliza conexões diretas peer-to-peer (P2P) sobre HTTPS para transferir mensagens entre domínios registrados. Nenhuma mensagem transita por servidores de terceiros ou provedores centrais.

Esta especificação define o contrato de API que todo nó de Gateway compatível com o MAIVW implementa na rota de recebimento (`/api/v1/inbox`).

---

## 🛰️ 1. Requisição de Transporte P2P

### Endpoint
```http
POST /api/v1/inbox HTTP/1.1
Host: mw.destinatario.com.br
Content-Type: application/json
```

### Cabeçalhos do Protocolo

| Cabeçalho | Obrigatório? | Descrição | Exemplo |
| :--- | :--- | :--- | :--- |
| `x-maivw-sender` | **Sim** | Domínio corporativo do remetente verificado na blockchain | `minhaempresa.com.br` |
| `x-maivw-intent-tx` | **Sim** | Hash da transação na blockchain que ancorou a intenção | `0xabc123...def456` |
| `x-maivw-sub-identity` | Não | Identidade do cliente final (quando o remetente for provedor) | `tenant_123` |
| `x-maivw-intent-root` | Não | Raiz da Merkle Tree registrada on-chain para lotes de mensagens | `0x7f8a9...` |
| `x-maivw-intent-proof` | Não | Prova de inclusão Merkle em formato JSON | `["0x...", "0x..."]` |
| `x-maivw-stealth-token` | Não | Token de autenticação prévia exigido por destinatários em Modo Stealth | `st_live_99...` |

---

## 📦 2. Estrutura do Payload (JSON)

A requisição HTTP transmite o envelope assinado diretamente no corpo JSON:

```json
{
  "messageId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "msgClass": "TX_CODE",
  "to": "suporte@destinatario.com.br",
  "subject": "Confirmação de Integração de API",
  "content": {
    "text": "Olá equipe, confirmamos o recebimento das credenciais com sucesso.",
    "html": "<p>Olá equipe,</p><p>Confirmamos o recebimento das credenciais com <strong>sucesso</strong>.</p>",
    "attachments": [
      {
        "id": "att-1",
        "filename": "recibo.pdf",
        "mimeType": "application/pdf",
        "size": 45201,
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "url": "/api/v1/attachments/att-1"
      }
    ]
  },
  "signature": "0x3a9f81bc20387a2d829...",
  "subIdentityId": "default"
}
```

---

## 🔐 3. Assinatura e Verificação Criptográfica

A autoria e a integridade são garantidas pela assinatura digital (EIP-191) utilizando **`viem`**:

### Assinatura no Nó Remetente (TypeScript / viem):
```typescript
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`);

// O conteúdo (ou seu JSON canônico) é assinado com a chave privada do domínio
const messageToSign = typeof content === "string" ? content : JSON.stringify(content);
const signature = await account.signMessage({ message: messageToSign });
```

### Verificação no Nó Receptor (TypeScript / viem):
```typescript
import { recoverMessageAddress } from "viem";

// 1. Recupera o endereço Ethereum que gerou a assinatura
const recoveredAddress = await recoverMessageAddress({
  message: typeof content === "string" ? content : JSON.stringify(content),
  signature: signature as `0x${string}`,
});

// 2. Consulta a chave pública registrada no contrato na blockchain
const registeredPublicKey = await ledgerService.getPublicKey(senderDomain);

// 3. Validação estrita
if (registeredPublicKey.toLowerCase() !== recoveredAddress.toLowerCase()) {
  throw new Error("Assinatura inválida: a chave recuperada não corresponde ao domínio na blockchain.");
}
```

---

## 📬 4. Resposta do Receptor P2P

Ao validar a integridade, reputação e a assinatura, o Gateway receptor persiste a mensagem no banco e responde:

```http
HTTP/1.1 202 Accepted
Content-Type: application/json
```

```json
{
  "status": "accepted",
  "messageId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "senderDomain": "minhaempresa.com.br",
  "subIdentityId": "default",
  "merkleVerified": false,
  "message": "Mensagem de minhaempresa.com.br validada e aceita para a caixa de entrada"
}
```

---

## ⚠️ Códigos de Retorno HTTP

| Código | Significado | Motivo |
| :--- | :--- | :--- |
| `202 Accepted` | Aceita | Assinatura válida, domínio ativo na blockchain e mensagem gravada na caixa postal. |
| `400 Bad Request` | Formato Inválido | Payload JSON corrompido, campos obrigatórios ausentes ou falha de schema Zod. |
| `401 Unauthorized` | Rejeição Criptográfica | Assinatura inválida, chave não bate com a blockchain ou prova Merkle inconsistente. |
| `404 Not Found` | Silent Drop | Destinatário configurado em Modo Stealth (Dark Endpoint) e token não fornecido. |
| `406 Not Acceptable` | Soft Bounce | A classe de mensagem (`msgClass`) está na lista de bloqueios do destinatário. |
| `429 Too Many Requests` | Limite Excedido | Limite diário do tier on-chain do remetente foi atingido. |
| `500 Internal Error` | Falha Local | Erro inesperado ao consultar a blockchain ou persistir no banco de dados. |
