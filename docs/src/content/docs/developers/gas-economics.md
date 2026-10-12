---
title: Economia de Gas & Modelo de Custo Zero
description: Entenda como o MAIVW viabiliza bilhões de mensagens corporativas com custo de gas zero e taxas quase nulas na Base L2.
---

Um erro comum ao avaliar protocolos Web3 é supor que cada mensagem enviada gera uma transação de blockchain e consome taxas de rede (*gas*). No **MAIVW Protocol**, isso **não acontece**.

---

## ⚡ 1. Arquitetura "Zero-Gas" para Mensageria P2P

O envio de mensagens no MAIVW é **completamente off-chain e peer-to-peer**:
- O transporte de dados ocorre diretamente entre o Gateway do remetente e o Gateway do destinatário via HTTPS/TLS.
- As mensagens são assinadas criptograficamente off-chain (EIP-191).
- **Resultado:** Disparar 10 e-mails ou disparar 100 milhões de e-mails custa exatamente **R$ 0,00 em gas de blockchain**.

```
┌────────────────────────────────────────────────────────┐
│  ENVIO DE MENSAGENS DIÁRIAS (P2P HTTPS)                │
│  • Volume: Ilimitado                                   │
│  • Custo de Gas da Blockchain: ZERO                    │
│  • Velocidade: Latência HTTP (sub-segundo)             │
└────────────────────────────────────────────────────────┘
```

---

## ⛽ 2. Onde o Gas é Efetivamente Utilizado?

A blockchain (Base L2) é utilizada exclusivamente como **Camada de Identidade e Cartório de Registro (Registry & Discovery)**. O gas só é consumido em eventos administrativos raros:

| Ação Administrativa | Frequência Típica | Consumo de Gas (Base L2) | Custo Estimado (USD)* |
| :--- | :--- | :--- | :--- |
| **Registrar Domínio** (`registerCompany`) | Uma única vez | ~85.000 gas | **< $0,002** |
| **Atualizar Endpoint** (`updateEndpoint`) | Apenas ao trocar de servidor/IP | ~35.000 gas | **< $0,001** |
| **Rotacionar Chave Pública** (`updatePublicKey`) | Anual ou sob auditoria | ~45.000 gas | **< $0,001** |
| **Consulta Lens** (`getCompanyProfile`) | Milhões de vezes por dia | **0 (View Call Local)** | **GRÁTIS** |

*\*Valores estimados considerando gas price típico da Base L2 (0,005 - 0,05 gwei) e ETH a US$ 3.000.*

---

## 💰 3. Comparativo de Custo: Provedores SaaS vs. MAIVW

Provedores proprietários de e-mail cobram mensalidades por licença de usuário ou faturam por milhar de mensagens enviadas. Veja a comparação para uma empresa com 50 colaboradores enviando 500.000 e-mails por mês:

| Item de Custo | Provedor Tradicional (Ex: Google / SendGrid) | Nó Soberano MAIVW Protocol |
| :--- | :--- | :--- |
| **Licenças de Usuário** | R$ 35 - R$ 120 / usuário / mês (~R$ 3.500/mês) | **R$ 0** (usuários ilimitados no seu nó) |
| **Disparo Transacional** | US$ 89 - US$ 150 / mês para alto volume | **R$ 0** em taxas de entrega |
| **Servidor do Nó** | Incluso no plano do provedor | R$ 30 - R$ 80 / mês (VPS básica Hetzner/AWS) |
| **Custo On-Chain** | Inexistente | Menos de R$ 0,05 por ano em manutenções L2 |
| **Economia Anual** | Custo estimado de **R$ 45.000+ / ano** | Custo estimado de **~R$ 600 / ano** |

---

## 🔒 4. Modelo Econômico Anti-Spam (Staking por Tiers)

Para remetentes corporativos de alto volume e provedores multi-tenant, o protocolo suporta um modelo de **Caução de Integridade (Staking de Tier)** no contrato na blockchain:
- A organização deposita uma garantia colateral (ex: ETH) correspondente ao seu Tier (`STARTUP`, `GROWTH`, `ENTERPRISE`).
- O saldo garante um limite diário proporcional de mensagens seguras e cobre eventuais penalidades por infração validada.
- Se a empresa for condenada por envio massivo de phishing ou quebra de taxonomia, uma fração da caução sofre *slashing* via contrato na blockchain e é redistribuída aos denunciantes e ao tesouro do protocolo.
