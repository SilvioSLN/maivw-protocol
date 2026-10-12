---
title: Matriz de Segurança Criptográfica & Comparativo SMTP
description: Análise comparativa entre o modelo clássico (SMTP, SPF, DKIM, DMARC) e as garantias criptográficas do MAIVW Protocol.
---

O e-mail tradicional foi concebido na década de 1980 sem nenhuma camada nativa de autenticação. Ao longo dos anos, foram adicionados remendos (*patches*) como SPF, DKIM e DMARC na tentativa de reduzir fraudes. No entanto, esses mecanismos ainda dependem de confiança em servidores intermediários, DNS não assinado e são vulneráveis a uma série de ataques modernos.

O **MAIVW Protocol** substitui a confiança presumida por **provas matemáticas verificáveis**.

---

## 📊 Matriz Comparativa: SMTP Clássico vs. MAIVW Protocol

| Vetor de Segurança | SMTP Tradicional (SPF / DKIM / DMARC) | MAIVW Protocol (On-Chain + P2P) |
| :--- | :--- | :--- |
| **Identidade da Origem** | Baseada em reputação de IP e cabeçalhos de texto (`From:`) | Chave criptográfica `secp256k1` ancorada na Base L2 |
| **Integridade da Mensagem** | DKIM cobre apenas cabeçalhos selecionados; suscetível a replaying | Assinatura completa do payload (EIP-191 / Keccak-256) |
| **Interceptação MITM** | STARTTLS vulnerável a downgrade stripping em trânsito | Conexão direta HTTPS mTLS + Criptografia E2E AES-256-GCM |
| **Resistência a Spoofing** | Parcial (requer DMARC `p=reject` estrito, raramente adotado) | **Absoluta:** Assinatura digital impossível de forjar |
| **Privacidade do Usuário** | Pixels de rastreamento expõem IP real e geolocalização do leitor | Sandboxed Iframe + Proxy de Imagem reverso nativo |
| **Dependência de Terceiros** | Provedores gigantes (Google, Microsoft) decidem quem entrega | Descentralizado; qualquer nó auditável entrega diretamente |
| **Custo por Transação** | Mensalidades caras por usuário em SaaS proprietário | **Zero gas para mensagens P2P**; gas ínfimo na L2 para registro |

---

## 🛡️ Mitigação de Ataques Cibernéticos no MAIVW

### 1. Phishing & Domain Spoofing
- **No SMTP:** Um invasor pode disparar e-mails forjando o cabeçalho `From: seguranca@banco.com.br` a partir de um servidor comprometido caso as políticas de DMARC estejam frouxas ou mal configuradas.
- **No MAIVW:** O receptor executa a recuperação da chave assinadora no momento em que o pacote chega na porta do Gateway. Se a chave resultante não corresponder rigorosamente à chave pública gravada no contrato na blockchain para aquele domínio, a requisição é **rejeitada com código 401** antes de tocar em qualquer caixa postal.

### 2. STARTTLS Stripping & Ataques Man-in-the-Middle
- **No SMTP:** Durante a negociação entre MTAs, invasores de rede podem interceptar a conexão e remover a instrução `STARTTLS`, forçando a transmissão da mensagem em texto claro desprotegido.
- **No MAIVW:** O transporte ocorre por HTTPS forçado com TLS 1.3 ou **mTLS (Mutual TLS)**. Além da camada de transporte, o próprio payload da mensagem pode estar cifrado em **AES-256-GCM** com a chave pública do nó de destino.

### 3. Tag Spoofing (Falso E-mail Transacional)
- **O Ataque:** Remetentes maliciosos etiquetam campanhas de spam/marketing como `TX_CODE` ou `TX_RECEIPT` para furar filtros de spam e obter taxa de abertura imediata.
- **Defesa do Protocolo:** Se um remetente acumular denúncias de abuso comprovado no tribunal de oráculos, o domínio acumula strikes e pode sofrer suspensão ou slashing no contrato na blockchain, acarretando perda do selo de verificação e bloqueio P2P imediato.

---

## 🔒 Proteção no Cliente: Sandboxed Iframe & Proxy de Imagens

O visualizador de e-mails (`EmailContentViewer.tsx`) implementa múltiplas barreiras de isolamento no navegador:

```
┌────────────────────────────────────────────────────────┐
│                   NAVEGADOR DO USUÁRIO                 │
├────────────────────────────────────────────────────────┤
│ Contexto WebMaivw (Sessão, Chaves de Carteira, Cookies) │
│                                                        │
│   ┌────────────────────────────────────────────────┐   │
│   │  AutoResizingIframe Isolado                    │   │
│   │  sandbox="allow-popups                         │   │
│   │           allow-popups-to-escape-sandbox       │   │
│   │           allow-same-origin"                   │   │
│   │                                                │   │
│   │  [ Conteúdo HTML do E-mail ]                   │   │
│   │  - Sem acesso ao LocalStorage da aplicação pai │   │
│   │  - Imagens carregadas via /api/proxy/image     │   │
│   │  - Sem vazamento de IP real ou cookies         │   │
│   └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

- **Isolamento de Scripts:** Nenhuma tag `<script>` presente no corpo do e-mail é autorizada a rodar no contexto de controle da aplicação.
- **Proxy de Imagens (`/api/proxy/image`):** Requisições a imagens externas são intermediadas pelo backend do próprio nó. O remetente nunca obtém o IP, User-Agent ou horário de abertura do destinatário.
- **Bypass de Bloqueios CORP:** Imagens de provedores externos que utilizam o cabeçalho `Cross-Origin-Resource-Policy: same-origin` são convertidas e entregues sem quebra de exibição.

---

## 🕶️ Dark Endpoints para Comunicação Interbancária

Para redes de alta sensibilidade (ex: liquidação financeira, comunicação entre cartórios ou judiciário), o MAIVW suporta o modo **Dark Endpoint**:
- O endereço do Gateway pode ser configurado em uma rede privada (VPN corporativa, VPC peering ou rede Tor).
- O acesso exige **mTLS (Mutual TLS)**, exigindo que o remetente apresente um certificado X.509 assinado por uma Autoridade Certificadora previamente homologada, unindo a soberania on-chain à privacidade corporativa física.
