# MAIVW Protocol — Security Policy & Threat Model (v2)

## 1. Visão Geral da Arquitetura de Segurança

O `MAIVWRegistry` v2 opera como o cartório público descentralizado do protocolo MAIVW, gerenciando identidades corporativas de e-mail, reputação, stakes de garantia e punições (slashing).

A v2 implementa as seguintes garantias de segurança auditadas:
1. **Solvência Estrita**: O saldo em ETH mantido pelo contrato é estritamente maior ou igual à soma de todos os passivos (`balance >= totalLiabilities()`). Nenhuma taxa de fundador ou tesouraria pode ser retirada se invadir o stake depositado pelos usuários.
2. **EIP-712 Structured Proofs**: Todas as autorizações do Nó Oráculo (registro, espelhamento, recuperação e reciclagem) utilizam EIP-712 com validação de `nonce` por domínio e `deadline` contra ataques de repetição temporal ou cross-contract.
3. **Máquina de Estados de Domínio**: Estados explícitos (`ACTIVE`, `SUSPENDED`, `SLASHED`, `REVOKED`) gerenciam o ciclo de vida do domínio com separação entre chave fria de governança (`adminKey`) e chave quente de assinatura (`publicKey`).
4. **Governança Two-Step & Timelocks**: O contrato utiliza `Ownable2Step`, `Pausable` com papel dedicado de emergência (`guardian`), e timelocks parametrizáveis (`slashDelay`, `recoveryDelay`).
5. **Prevenção de DoS em Slashing**: A distribuição de bounties para denunciantes é pull-based (`withdrawPending()`) e exige repórteres estritamente ordenados sem repetição.

---

## 2. Atores e Papéis de Governança

| Ator | Privilégios | Mitigações & Controles |
|---|---|---|
| **Owner (Deployer / DAO)** | Atualização de parâmetros (`setFees`, `setDelays`, `setOracleNode`, etc.), transferência em duas etapas via `Ownable2Step`, despausar. | Não pode alterar chaves de domínios alheios, nem sacar stakes de usuários (`C-01`, `C-06`). Tetos imutáveis (`maxStandardFee`, `maxProviderFee`, `maxMirrorFee`). |
| **Guardian** | Pausa emergencial imediata (`pause()`). | Não pode despausar, não pode alterar parâmetros, não pode sacar fundos. |
| **Oracle Node** | Assinatura de provas EIP-712 (`Register`, `Reclaim`, `Mirror`, `Recovery`), execução de punições (`slashDomain`, `issueWarningTicket`). | Assinaturas vinculadas a nonces específicos e prazos curtos; veto disponível por governança/timelock. |
| **Domain Admin (`adminKey`)** | Chave fria do proprietário do domínio. Atualiza `publicKey`, `endpointUrl`, propõe rotação em 2 etapas (`proposeAdminKey`) e cancela recuperações forjadas (`cancelRecovery`). | Protegida por timelock de recuperação (`recoveryDelay`). |
| **Domain Signer (`publicKey`)** | Chave quente de emissão e assinatura de mensagens criptográficas no gateway. | Não possui poder de governança administrativa sobre o domínio. |
| **Reporters (Denunciantes)** | Endereços que reportam spam ou abuso com provas atestadas pelo Oráculo. | Recompensas creditadas via pull-based accounting (`pendingWithdrawals`), eliminando vetores de DoS. |

---

## 3. Invariantes do Sistema

1. **Invariante de Solvência**:
   $$\text{balance} \ge \text{totalLiabilities}() = \text{totalStaked} + \text{accumulatedFounderFees} + \text{accumulatedTreasuryFees} + \text{totalPendingWithdrawals}$$
2. **Invariante de Chaves**: Todo domínio com status `DomainStatus.ACTIVE` possui `publicKey != address(0)` e `adminKey != address(0)`.
3. **Invariante de Singularidade**: Não existem domínios ativos duplicados. Nomes são normalizados em minúsculas e validados no padrão DNS (RFC 1035 / Punycode).
4. **Invariante de Resíduo**: Quando um domínio banido é reciclado via `reclaimDomain()`, qualquer caução residual anterior é creditada integralmente ao antigo administrador e nunca expropriada.

---

## 4. Reporte de Vulnerabilidades (Bug Disclosure)

Para relatar vulnerabilidades ou falhas de segurança no protocolo MAIVW:
- **E-mail**: `security@maivw.com`
- **PGP Key**: Disponível no repositório oficial
- **Resposta inicial**: até 24 horas úteis.
