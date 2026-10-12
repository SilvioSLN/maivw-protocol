---
title: Oráculos de Verificação & Sistema de Arbitragem
description: Funcionamento dos oráculos descentralizados, atestação de posse de DNS e resolução de disputas com slashing de reputação.
---

O MAIVW integra a infraestrutura de nomes de domínio da internet (DNS) com a governança da Web3 por meio de contratos na blockchain. Para garantir que ninguém possa registrar um domínio que não lhe pertença, a rede utiliza **Oráculos de Atestação Criptográfica**.

---

## 🔮 1. O Papel do Oráculo de Verificação DNS

Quando o operador de um nó solicita o registro do seu domínio, o contrato na blockchain exige um laudo confiável assinado pelo oráculo comprovando que o proprietário do DNS autorizou aquele par de chaves e endpoint.

```
┌─────────────────┐       1. Publica TXT       ┌────────────────────┐
│ Operador do Nó  │ ─────────────────────────> │ Servidores DNS TLD │
│                 │                            │ (Registro.br/ICANN)│
└────────┬────────┘                            └─────────┬──────────┘
         │                                               │
         │ 2. Solicita Verificação                       │ 3. Consulta
         ▼                                               ▼    Registro TXT
┌─────────────────┐       4. Emite Voucher     ┌────────────────────┐
│ Contrato na     │ <───────────────────────── │ Oráculo do Nó /    │
│ Blockchain (L2) │     (oracleProof)          │ Juiz de Atestação  │
└─────────────────┘                            └────────────────────┘
```

### Fluxo de Validação de Posse (Proof of Ownership):
1. O assistente de onboarding gera o registro `_maivw-verify.<dominio>` do tipo `TXT` com o valor `maivw-verification=<token>`.
2. O Gateway solicita ao Oráculo a validação do domínio (`/api/v1/onboarding/claim-proof`).
3. O Oráculo executa consultas DNS recursivas e redundantes via DNS-over-HTTPS (DoH).
4. Ao confirmar a correspondência do token, o Oráculo assina uma atestação criptográfica (`oracleProof`) com prazo de expiração (`deadline`).
5. O Gateway despacha a transação `registerCompany(domain, endpointUrl, publicKey, adminKey, isProvider, deadline, oracleProof)` para o contrato na blockchain.
6. O domínio é ativado com status **`ACTIVE`** no cartório global da rede.

---

## ⚖️ 2. Sistema de Reputação & Arbitragem com IA

Ao contrário do SMTP tradicional — onde um remetente de spam pode facilmente trocar de IP ou criar novos subdomínios para burlar filtros —, no MAIVW o histórico de conduta fica associado à identidade criptográfica do domínio.

### A. Classes de E-mail e Quebra de Contrato
Toda mensagem é categorizada com uma classe formal (`msgClass`):
- `TX_CODE` (Segurança, códigos 2FA e OTP).
- `TX_RECEIPT` (Financeiro, faturas e recibos).
- `SUPPORT` (Atendimento e suporte ao cliente).
- `CONVERSATION` (Comunicação interpessoal direta).
- `MARKETING` (Campanhas comerciais e informativas).
- `COLD_OUTREACH` (Prospecção comercial B2B).

Se um remetente etiquetar uma campanha massiva de vendas como `TX_CODE` para contornar filtros prioritários, ele comete **falsidade ideológica de protocolo (Tag Spoofing)**.

### B. Tribunal do Oráculo e Juiz de IA Remoto
Quando um nó receptor identifica mensagens com suspeita de abuso, pode submeter uma denúncia via endpoint `/api/v1/dispute`:
- O payload completo e assinado é submetido como evidência irrefutável.
- O oráculo avalia o conteúdo utilizando o **Juiz Semântico** (`ISemanticJudge`), operando em modo heurístico local ou através de cluster de IA dedicado (`ORACLE_AI_JUDGE_URL`).
- O laudo do julgamento (`OracleReportService`) determina se houve violação de taxonomia, phishing ou conteúdo nocivo.

### C. Penalidades e Slashing no Contrato na Blockchain
Quando uma denúncia comprovada é julgada procedente:
1. **Advertência e Strikes:** O contrato emite um ticket de advertência (`issueWarningTicket`) e incrementa o contador de infrações (`strikeCount`).
2. **Redução de Reputação Local:** Nós participantes degradam o score local do remetente na tabela de reputação do banco de dados, podendo aplicar quarentena ou bloqueio imediato.
3. **Slashing e Suspensão On-Chain:** Em casos reiterados ou fraudes severas, a função `slashDomain` do contrato na blockchain é executada:
   - A caução depositada (*staking*) sofre confisco (*burn* e redistribuição aos denunciantes).
   - O domínio é alterado para status `SUSPENDED` ou `SLASHED`.
   - A partir deste momento, todos os nós da rede mundial passam a rejeitar qualquer pacote P2P originado daquele domínio.
