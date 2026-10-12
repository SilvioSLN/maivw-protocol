---
title: Especificação P2P atual
description: Formato do envelope, assinatura EIP-191 e limites de interoperabilidade.
---

O receptor expõe `POST /api/v1/inbox` com `Content-Type: application/json`. Configure HTTPS para tráfego público. O código atual não negocia uma sessão criptográfica de mensagem nem emite recibo assinado.

## Cabeçalhos

| Cabeçalho | Comportamento do receptor |
| --- | --- |
| `x-maivw-sender` | Domínio do remetente, obrigatório |
| `x-maivw-intent-tx` | O receptor exige este campo ou `x-maivw-intent-root`; não verifica receipt on-chain nesse fluxo |
| `x-maivw-intent-root` | Raiz Merkle declarada pelo emissor |
| `x-maivw-intent-proof` | Array de hashes codificado como string JSON; verificado quando raiz e prova estão presentes |
| `x-maivw-sub-identity` | Sub-identidade, quando aplicável |
| `x-maivw-stealth-token` | Token bilateral para rotas com modo stealth |

O schema de headers em `schemas/payload.ts` é mais restritivo que algumas verificações manuais da rota. A compatibilidade atual deve considerar o handler, até unificar a validação.

**Limitação:** o emissor atual preenche `x-maivw-intent-tx` com `"0x" + "ab".repeat(32)`. Esse valor é fictício. `merkleVerified: true` comprova apenas inclusão na raiz fornecida; não comprova que essa raiz foi ancorada em um contrato.

## Envelope

```json
{
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "msgClass": "CONVERSATION",
  "to": "bob@example.org",
  "subject": "Teste de integração",
  "content": { "text": "Olá", "html": "<p>Olá</p>" },
  "signature": "0x..."
}
```

A assinatura acima é um placeholder; substitua pelo resultado real do algoritmo abaixo. `subIdentityId` e `content.attachments` são opcionais. O schema de anexos contém `id`, `filename`, `size`, `mimeType`, `sha256` e `url`; veja [anexos na API](/api/gateway/).

## Serialização assinada

O protocolo atual usa EIP-191 (`signMessage`), sem hash manual adicional. A ordem das propriedades e a normalização de HTML vazio importam.

```typescript
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";

const content = { text: "Olá", html: "<p>Olá</p>" };
const message = JSON.stringify({ text: content.text, html: content.html || "" });
const account = privateKeyToAccount(process.env.DOMAIN_PRIVATE_KEY as `0x${string}`);
const signature = await account.signMessage({ message });
// Em produção, obtenha este endereço pelo Registry do domínio remetente.
const expectedAddress = account.address;
const valid = await verifyMessage({ address: expectedAddress, message, signature });
```

`DOMAIN_PRIVATE_KEY` é uma variável apenas deste exemplo. O Gateway usa a carteira do domínio no cofre, com fallback para seu assinante configurado.

Não assine `JSON.stringify(content)` diretamente: anexos, ordem de campos ou ausência de `html` podem gerar bytes diferentes. A assinatura atual **não inclui** `subject`, `to`, `messageId`, `msgClass`, `subIdentityId` nem anexos. Também não oferece um nonce criptográfico de mensagem.

## Respostas

| Status | Interpretação |
| --- | --- |
| `202` | Aceite pelo Gateway e persistência da mensagem |
| `400` | Campos ou prova malformados |
| `401` | Assinatura ou prova rejeitada |
| `404` | Pode ocorrer por política stealth |
| `406` | Classe bloqueada pela política do receptor |
| `429` | Limite aplicado ao remetente |
| `500` | Falha no processamento |

O corpo de aceite inclui `status: "accepted"`, `messageId`, `senderDomain`, `subIdentityId`, `merkleVerified` e `message`. Não há promessa de tempo máximo, leitura pelo usuário ou validade jurídica do aceite.
