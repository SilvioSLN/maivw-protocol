---
title: Guia de Uso do Webmail (WebMaivw)
description: Como navegar pelo WebMaivw, gerenciar caixas postais corporativas, compor e-mails com classes de mensagem e usufruir da segurança em sandbox.
---

O **WebMaivw** é a interface webmail do protocolo MAIVW. Ele combina a facilidade de clientes de e-mail modernos (como Gmail e Superhuman) com a segurança criptográfica de um nó soberano Web3.

Acesse o cliente localmente em:
👉 **[http://localhost:3002](http://localhost:3002)**

---

## 👥 Perfis de Acesso: Administrador vs. Colaborador

O sistema possui separação estrita de papéis para garantir a segurança da infraestrutura corporativa:

### 1. Administrador da Organização (`role: "admin"`)
* Cria a conta principal no cadastro inicial (`/signup`).
* Acessa o **Console Multi-Domínio** (`/admin`).
* Adiciona e renova domínios no Cartório On-Chain.
* Cria, bloqueia e define senhas para as caixas de e-mail dos colaboradores.
* Configura rotas de Dark Endpoint, credenciais SMTP de contingência e Webhooks.

### 2. Colaborador / Usuário Corporativo (`role: "user"`)
* Acessa diretamente o **Webmail** (`/inbox`).
* Utiliza seu endereço de e-mail institucional (ex: `financeiro@minhaempresa.com.br`).
* Envia e recebe e-mails corporativos assinados com a chave criptográfica do domínio.
* Não possui permissão para alterar contratos, rotacionar chaves de infraestrutura ou deletar caixas de colegas.

---

## ✉️ Composição de Mensagens e Classes de Envio

Ao clicar em **"Nova Mensagem"**, o editor de e-mail corporativo abre com recursos avançados de formatação e segurança:

### 1. Seleção da Classe de Mensagem (`MessageClass`)
Para combater spam e garantir que mensagens prioritárias cheguem com selo de verificação imediato, o protocolo exige que o remetente defina a classe da mensagem:

| Classe (`msgClass`) | Finalidade | Exemplo de Uso |
| :--- | :--- | :--- |
| **`TX_CODE`** | Alertas urgentes de acesso e segurança | Códigos temporários, OTP, tokens de verificação 2FA. |
| **`TX_RECEIPT`** | Documentos financeiros e fiscais críticos | Recibos de pagamento, notas fiscais, faturas. |
| **`SUPPORT`** | Atendimento técnico e pós-venda | Respostas a chamados, tickets de suporte. |
| **`CONVERSATION`** | Comunicação interpessoal direta | Diálogos e alinhamentos individuais entre pessoas. |
| **`MARKETING`** | Comunicações promocionais e informativas | Campanhas de marketing, newsletters, ofertas. |
| **`COLD_OUTREACH`** | Prospecção comercial B2B | Primeiro contato de vendas com novos clientes. |

> [!NOTE]
> O Gateway audita o corpo da mensagem contra a classe selecionada. Se um remetente tentar disfarçar uma oferta promocional com o selo de `TX_CODE`, a mensagem pode sofrer soft-bounce (406) ou ser denunciada por *Tag Spoofing*.

### 2. Editor Rico & Anexos
- Formatação rica em HTML com listas, links, negrito, itálico e blocos de citação.
- Upload de anexos de até 25 MB por mensagem, mantidos criptografados em trânsito.

---

## 🚀 Roteamento Inteligente Dual-Stack: O Que Acontece ao Enviar?

Quando você clica em **Enviar**, o Gateway analisa automaticamente o domínio do destinatário:

```
                     Destinatário: bob@parceiro.com.br
                                     │
                      Consulta Cartório On-Chain (Base)
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
        [ Possui Nó MAIVW? ]                    [ E-mail Tradicional? ]
                 │                                       │
                 ▼ SIM                                   ▼ NÃO
      • Entrega Direta P2P                    • Fallback SMTP Seguro
      • Assinatura EIP-191 ECDSA              • Entrega via servidor de saída
      • Latência média: ~35ms                 • Suporte a Gmail, Outlook, etc.
      • Custo de Gas: R$ 0,00                 • Custo de Gas: R$ 0,00
      • Selo Verde: 100% Autêntico            • Tráfego legado padrão
```

Você não precisa adivinhar se a outra empresa já usa o MAIVW: o sistema escolhe a rota mais segura e rápida de forma 100% transparente.

---

## 🛡️ Leitura Segura de E-mails com Sandboxed Iframe

No e-mail convencional, abrir um e-mail HTML pode expor seu endereço IP real, baixar pixels de rastreamento invasivos ou até executar scripts nocivos.

No WebMaivw, **toda mensagem recebida é renderizada dentro de um Iframe Isolado por Sandbox**:

1. **Scripts Maliciosos Bloqueados:** O iframe não permite a execução de JavaScript arbitrário no contexto da sua aplicação web.
2. **Isolamento de Estilos:** Códigos CSS complexos de e-mails de terceiros não quebram o layout do seu Webmail nem alteram fontes da interface principal.
3. **Proxy de Imagens Seguro (`/api/proxy/image`):** Imagens e ícones de redes sociais externos são carregados através do proxy do seu nó, impedindo que o remetente descubra a localização geográfica ou o IP do usuário que leu o e-mail.

---

## 🔁 Encaminhamento e Respostas Inteligentes

- **Resposta Rápida (`Reply`):** Mantém a thread da conversa, citando o remetente original e preservando o contexto de autenticação da cadeia de mensagens.
- **Encaminhamento (`Forward`):** Mantém o cabeçalho padronizado da mensagem original (`---------- Mensagem Encaminhada ----------`), preserva o HTML rico original na íntegra e carrega automaticamente os anexos para que você possa despachá-los para o novo destinatário sem perda de qualidade.
