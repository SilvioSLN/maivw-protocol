---
title: Migração e Coexistência Corporativa
description: Estratégias para migrar empresas do Google Workspace e Microsoft 365 para o MAIVW com transição suave e fallback legado.
---

Grandes empresas e departamentos jurídicos ou financeiros não precisam interromper suas operações existentes para adotar o **MAIVW Protocol**. O protocolo foi desenhado para operar em **Modo Híbrido**, permitindo transição gradual e sem atrito.

---

## 🏢 1. Arquitetura de Coexistência Híbrida

No modelo de coexistência, a empresa mantém seus e-mails legados funcionando normalmente (via Google Workspace, Microsoft Exchange ou Zimbra) enquanto ativa a camada soberana do MAIVW para comunicações críticas, B2B e contratos.

```
                    ┌─────────────────────────────────┐
                    │      Usuário Corporativo        │
                    │   (Enviando Mensagem / E-mail)  │
                    └───────────────┬─────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────┐
                    │    MAIVW Gateway Inteligente    │
                    │   (Verifica suporte do destino) │
                    └───────┬─────────────────┬───────┘
                            │                 │
              [Destino suporta MAIVW]   [Destino legado sem MAIVW]
                            │                 │
                            ▼                 ▼
          ┌───────────────────────┐     ┌───────────────────────┐
          │     P2P Criptografado │     │   Fallback SMTP / SES │
          │     • Assinado EIP-191│     │   • Google / Exchange │
          │     • Zero Custo Gas  │     │   • Entrega legado    │
          │     • Imune a Spoofing│     │   • DKIM / SPF padrão │
          └───────────────────────┘     └───────────────────────┘
```

---

## 🚦 2. Roteamento Inteligente de Saída (Outbound Fallback)

Ao enviar um e-mail através da API ou Webmail do MAIVW:
1. O Gateway consulta o contrato na blockchain para verificar se o domínio do destinatário possui nó ativo registrado.
2. **Se suportado:** A mensagem é enviada via **Canal Soberano P2P HTTPS**, garantindo autenticidade, recibo assinado e carimbo de tempo.
3. **Se NÃO suportado:** O Gateway aciona automaticamente o **Fallback Legado** configurado (Resend, SendGrid, Amazon SES ou servidor SMTP interno corporativo), entregando a mensagem normalmente na caixa de entrada do destinatário legado.

---

## 📥 3. Roteamento de Entrada (Inbound Coexistence)

Para o recebimento de mensagens:
- **Entradas MX Legadas:** Continuam apontando para os servidores do Google Workspace ou Microsoft 365 (`ASPMX.L.GOOGLE.COM` ou `outlook.office365.com`). E-mails enviados por remetentes convencionais continuam chegando lá.
- **Ancoragem no Contrato na Blockchain:** Uma vez comprovada a posse do domínio via `_maivw-verify` e registrado o nó na blockchain, remetentes que utilizam MAIVW resolvem seu endpoint público on-chain e entregam diretamente no seu nó soberano via P2P.
- **Sincronização Opcional:** O nó MAIVW sincroniza webhooks e e-mails legados do provedor configurado (ex: Resend) diretamente para a caixa unificada.

---

## 🛡️ 4. Benefícios Regulatórios e de Compliance (LGPD / SOX)

A adoção do MAIVW soluciona vulnerabilidades críticas de auditoria corporativa:
- **Não-Repúdio Incontestável:** Nem o remetente nem o destinatário podem negar o envio ou o conteúdo de um contrato enviado por e-mail, graças à assinatura digital assimétrica vinculada à chave corporativa.
- **Proteção contra BEC (Business Email Compromise):** Diretoria financeira e tesouraria ficam 100% protegidas contra golpes de alteração de dados bancários via falsificação de cabeçalho SMTP.
- **Soberania dos Dados:** O acervo de mensagens trocadas via MAIVW reside no banco de dados da própria empresa, sem depender de políticas unilaterais de retenção de grandes corporações de nuvem estrangeiras.

---

## 📋 5. Cronograma Recomendado de Migração (3 Fases)

### Fase 1: Piloto Departamental (Semana 1 - 2)
- Ativação de um nó MAIVW para os departamentos Financeiro, Jurídico e C-Level.
- Validação do domínio via entrada TXT `_maivw-verify` e registro no contrato na blockchain.
- Troca de mensagens seguras com fornecedores e parceiros chave que também possuem nós ativos.

### Fase 2: Ativação do Roteamento Híbrido (Semana 3 - 4)
- Configuração do fallback de envio para todos os colaboradores.
- Envio de notificações transacionais de alta criticidade (ex: redefinições de senha, faturas de cobrança) pela API do Gateway MAIVW.

### Fase 3: Soberania Total (Mês 2+)
- Gradual migração de caixas de correio gerais para o WebMaivw.
- Redução drástica dos custos recorrentes de licenciamento por usuário de suítes de produtividade legadas.
