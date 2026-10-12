---
title: Enviando seu Primeiro E-mail Soberano
description: Aprenda como enviar e-mails pela interface do WebMaivw, via API REST e via código com TypeScript ou Python.
---

Com o nó do MAIVW ativo e configurado, você pode enviar e-mails de três formas diferentes: através da interface gráfica, via API REST ou integrando seus sistemas legados.

---

## 🖥️ 1. Enviando via Interface Web (WebMaivw)

1. Acesse o WebMaivw no seu navegador (ex: `http://localhost:3002` ou seu domínio corporativo).
2. Faça login com suas credenciais corporativas.
3. No painel lateral, clique no botão **"Novo E-mail"** (ou atalho `C`).
4. O **Composer Modal** será aberto:
   - **Para:** Digite o e-mail do destinatário (ex: `contato@empresa-parceira.com.br`).
   - **Assunto:** Informe o título da mensagem.
   - **Categoria (`msgClass`):** Selecione entre as classes disponíveis: `TX_CODE` (código/2FA), `TX_RECEIPT` (fatura/recibo), `SUPPORT` (suporte), `CONVERSATION` (conversa direta), `MARKETING` (newsletter) ou `COLD_OUTREACH` (prospecção).
   - **Corpo:** Utilize o editor visual rico para formatar o texto, adicionar links e anexar arquivos.
5. Clique no botão **"Enviar"**.
6. A mensagem é assinada pela chave do seu nó e despachada diretamente para o Gateway do destinatário em menos de 1 segundo.

---

## 💻 2. Enviando via API REST (cURL)

Você pode integrar sistemas de backend ou scripts de automação enviando uma requisição HTTP `POST` para o seu Gateway local:

```bash
curl -X POST http://localhost:3001/api/v1/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_API_TOKEN" \
  -d '{
    "from": "notificacoes@meudominio.com.br",
    "to": "diretoria@parceiro.com.br",
    "subject": "Relatório Financeiro Q3 - Assinado",
    "msgClass": "CONVERSATION",
    "content": {
      "text": "Segue em anexo o fechamento do terceiro trimestre.",
      "html": "<h3>Fechamento Q3</h3><p>Segue em anexo o relatório trimestral auditado.</p>"
    }
  }'
```

### Resposta de Sucesso (HTTP 200 OK):
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

## 📦 3. Enviando via TypeScript / Node.js

Para integrar em aplicações Next.js, Fastify ou Node.js tradicional:

```typescript
import axios from "axios";

interface SendEmailParams {
  from?: string;
  to: string;
  subject: string;
  msgClass: "TX_CODE" | "TX_RECEIPT" | "SUPPORT" | "CONVERSATION" | "MARKETING" | "COLD_OUTREACH";
  html: string;
  text?: string;
}

async function sendSovereignEmail({ from, to, subject, msgClass, html, text }: SendEmailParams) {
  const GATEWAY_URL = process.env.MAIVW_GATEWAY_URL || "http://localhost:3001";
  
  try {
    const response = await axios.post(`${GATEWAY_URL}/api/v1/send`, {
      from,
      to,
      subject,
      msgClass,
      content: {
        text: text || html.replace(/<[^>]*>?/gm, ""),
        html,
      },
    });

    console.log(`[MAIVW] E-mail entregue com sucesso! ID: ${response.data.messageId}`);
    return response.data;
  } catch (error: any) {
    console.error("[MAIVW] Falha no envio:", error.response?.data || error.message);
    throw error;
  }
}

// Exemplo de uso para envio de código de segurança
sendSovereignEmail({
  from: "seguranca@meudominio.com.br",
  to: "cliente@outrodominio.com.br",
  subject: "Código de Verificação 2FA",
  msgClass: "TX_CODE",
  html: "<p>Seu código de acesso é: <strong>928-104</strong></p>",
});
```

---

## 🔍 4. O que Acontece nos Bastidores?

Quando você aciona o envio, o Gateway executa os seguintes passos em milissegundos:
1. **Resolução de Domínio:** O Gateway consulta o contrato na blockchain para descobrir o endpoint e a chave pública de `outrodominio.com.br`.
2. **Assinatura Digital:** O Gateway gera o hash criptográfico do conteúdo e assina com a chave privada do seu domínio (padrão EIP-191).
3. **Handshake P2P:** Uma conexão HTTPS direta é aberta com o endpoint remoto `https://mw.outrodominio.com.br/api/v1/inbox`.
4. **Recebimento & Validação:** O nó remoto valida a assinatura contra a chave do contrato na blockchain, persiste a mensagem na caixa postal do usuário e retorna a confirmação de aceitação (`202 Accepted`).
