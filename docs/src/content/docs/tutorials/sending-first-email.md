---
title: Primeiro envio no piloto
description: Envie uma mensagem com API key e confira o resultado no receptor.
---

Prepare um domínio registrado, sua carteira no cofre e uma caixa postal. Para P2P, o destino precisa de nó acessível e registro compatível. Para SMTP, configure um provedor. Use dados e destinatários de teste controlados.

## Pela interface

Entre com a conta da caixa postal em `/inbox`, componha uma mensagem, escolha destinatário e classe e envie. A conta administrativa é usada para gestão; não é automaticamente uma caixa postal. Não há prazo de entrega garantido.

## Pela API

Gere uma chave na área de desenvolvedor ou siga [contas e API keys](/api/accounts/). Configure `MAIVW_API_TOKEN` no seu ambiente sem colocá-la no código-fonte.

```bash
curl -sS http://localhost:51443/api/v1/send   -H "Authorization: Bearer $MAIVW_API_TOKEN"   -H 'Content-Type: application/json'   -d '{"from":"alice@example.com","to":"bob@example.org","subject":"Teste","msgClass":"CONVERSATION","content":{"text":"Mensagem de teste"}}'
```

Os endereços são exemplos: substitua por contas do piloto. Confira `success`, `messageId` e `route` na resposta e verifique a mensagem no receptor.

## Node.js / TypeScript

O exemplo usa `fetch` nativo, sem dependência adicional:

```typescript
const token = process.env.MAIVW_API_TOKEN;
if (!token) throw new Error("Configure MAIVW_API_TOKEN");
const base = process.env.MAIVW_GATEWAY_URL || "http://localhost:51443";
const response = await fetch(`${base}/api/v1/send`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    from: "alice@example.com", to: "bob@example.org", subject: "Teste",
    msgClass: "CONVERSATION", content: { text: "Mensagem de teste" },
  }),
});
const result = await response.json();
if (!response.ok || !result.success) throw new Error(JSON.stringify(result));
console.log(result.messageId, result.route);
```

Essas variáveis são do cliente de exemplo, não do Gateway. Um timeout não prova que a mensagem não chegou; antes de repetir, confira os registros e o receptor. Não há chave de idempotência documentada nesse envio.

Para anexos, use o upload JSON/Base64 descrito na [API](/api/gateway/). Para lotes, não suponha que `recipients` entrega cópias a todos os endereços: essa parte do fluxo está incompleta.
