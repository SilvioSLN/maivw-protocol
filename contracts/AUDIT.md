# MAIVW Protocol — Competitive Audit Contest & Review Specification

> **Target Platform:** Sherlock Competitive Audit Contest  
> **Duration:** 7 Dias  
> **Prize Pool:** $25,000 USDC  
> **Repository:** `packages/contracts`  
> **Commit Hash:** Dinâmico (Sob demanda pré-submissão)  
> **Compiler Version:** Solidity `0.8.28` (via-ir: `true`, optimizer runs: `1`)  
> **Target Network:** Base (EVM L2, Chain ID: `8453`) & Base Sepolia (`84532`)  
> **Primary Native Asset:** `ETH`

---

## 1. Visão Geral do Protocolo

O **MAIVW** (*Mail Identity Verification & Reputation Web3 Registry*) é o protocolo canônico de notariação descentralizada de identidades de e-mail corporativo em blockchain. Ele substitui a fragilidade de cabeçalhos SPF/DKIM locais por um cartório público on-chain imutável onde:

1. Empresas depositam cauções econômicas (stakes) em ETH para emitir intenções de envio auditáveis.
2. Provedores multi-tenant (ex: SendGrid, Mailgun) operam com limite diário proporcional ao stake e estão sujeitos a advertências automáticas (*strikes*).
3. E-mails fraudulentos comprovados são punidos via **Slashing on-chain**, queimando 50% da caução para um endereço morto e redistribuindo os outros 50% entre os usuários denunciantes (*reporters*).
4. Domínios abandonados ou banidos podem ser reciclados pelo legítimo novo proprietário do domínio DNS através de provas notariais com atestação criptográfica EIP-712.

---

## 2. Escopo Técnico e Métricas (nSLOC)

Apenas os contratos em `src/` estão no escopo da auditoria. Interfaces em `src/interfaces/` e mocks em `test/` estão fora do escopo.

| Arquivo | Descrição | Linhas Totais | nSLOC | Complexidade | Foco do Auditor |
| :--- | :--- | :---: | :---: | :---: | :--- |
| [`src/MAIVWRegistry.sol`](src/MAIVWRegistry.sol) | Cartório Canônico UUPS, Solvência, Slashing & EIP-712 | 1.346 | 1.044 | Alta | Solvência estrita, UUPS, EIP-712, Slashing, Reclaim |
| [`src/MAIVWRegistryLens.sol`](src/MAIVWRegistryLens.sol) | Lens View-only para indexação e paginação sem DoS | 118 | 93 | Baixa | Paginação segura, queries estáticas |
| **TOTAL NO ESCOPO** | — | **1.464** | **1.137** | — | — |

*Comando para reprodução do cálculo:* `./script/audit-check.sh`

---

## 3. Invariantes Matemáticas Formais (Atenção Crítica)

Qualquer violação comprovável das seguintes relações matemáticas constitui vulnerabilidade de severidade **HIGH**:

### Invariante 1: Regra de Ouro da Solvência Estrita
$$\text{address(this).balance} \ge \text{totalLiabilities}()$$
Onde:
$$\text{totalLiabilities}() = \text{totalStaked} + \text{accumulatedFounderFees} + \text{accumulatedTreasuryFees} + \text{totalPendingWithdrawals}$$

* **Garantia:** Em nenhum momento fundos depositados como caução de usuários (`totalStaked`) ou recompensas de denunciantes (`totalPendingWithdrawals`) podem ser drenados por saques da tesouraria (`withdrawTreasury`) ou do fundador (`withdrawFounderFees`).
* **Testes de Referência:** [`RegistryInvariantsTest`](test/invariant/RegistryInvariants.t.sol) e [`CriticalFindingsTest.test_C01`](test/security/CriticalFindings.t.sol).

### Invariante 2: Conservação de Caução de Domínio
A caução `domainStakes[h]` só pode ser debitada exclusivamente em 3 circunstâncias:
1. Multa por strike de provedor creditada para `accumulatedTreasuryFees` via `issueWarningTicket`.
2. Slashing por fraude via `slashDomain`/`executeSlash`, onde 50% vai para `0x...dead` e 50% é creditado para `pendingWithdrawals` dos repórteres.
3. Excedente residual de caução de domínio banido creditado para o antigo administrador em `reclaimDomain` (`C-03`).

### Invariante 3: Não-Reutilização de Provas EIP-712
Uma assinatura válida do Oráculo nunca pode ser reutilizada:
- O `nonce` do domínio hash é consultado e invalidado a cada uso.
- A assinatura inclui `chainId` e `verifyingContract` (proteção contra replay cross-chain e cross-contract).
- Cada prova expira após `deadline`.

---

## 4. Premissas de Confiança e Atores Privilegiados (Trust Model)

| Papel | Endereço / Implementação | Privilégios e Escopo |
| :--- | :--- | :--- |
| **Owner** | Safe Multi-sig 2-de-3 na Base | Autoriza upgrades UUPS (`_authorizeUpgrade`), despausa (`unpause`), altera taxas (`setFees`) e saca da tesouraria (`withdrawTreasury`). Sujeito a tetos máximos imutáveis. |
| **Guardian** | Safe 1-de-3 / Chave de Plantão | Pausa de emergência imediata (`pause()`) e veto de slashes indevidos (`vetoSlash()`). **Não pode** despausar nem fazer upgrades. |
| **Oracle Node** | Chave Cloud HSM no GCP KMS | Assina atestações EIP-712 (`Register`, `Reclaim`, `Mirror`) e transmite transações de punição (`slashDomain`, `proposeSlash`, `issueWarningTicket`). |
| **Domain Admin** | EOA do Proprietário (`adminKey`) | Altera chave pública (`updatePublicKey`), endpoint (`updateEndpoint`), propõe rotação em 2 etapas (`proposeAdminKey`) e cancela recuperação forjada (`cancelRecovery`). |

---

## 5. Riscos Conhecidos e Premissas de Design (Known Issues / By Design)

Os itens a seguir são escolhas deliberadas de arquitetura e **NÃO devem ser reportados como vulnerabilidades** durante o contest:

1. **Centralização Inicial do Oráculo DNS:** O nó oráculo valida o registro DNS TXT off-chain antes de gerar a assinatura EIP-712. A descentralização com rede de oráculos federados está prevista para o Roadmap V3.
2. **Volatilidade Cambial em Taxas de ETH Fixo:** As taxas em ETH (ex.: 0.001 ETH) sofrem flutuações de valor em moeda fiduciária. O ajuste é gerido via Safe (`setFees`) sujeito aos tetos rígidos `maxStandardFee`, `maxProviderFee` e `maxMirrorFee`.
3. **Limite Gênesis (1.000 Domínios):** Os domínios gratuitos/subsidiados pelo deployer são estritamente limitados aos primeiros 1.000 registros (`genesisCount < 1000`).
4. **Isolamento de Execução de Repórteres:** Em `slashDomain`, se um contrato de repórter falhar ou consumir gás excessivo, ele não bloqueia o slashing nem quebra a execução; o valor fica disponível para saque pull-based via `withdrawPending()`.

---

## 6. Superfície de Ataque Prioritária (Onde Caçar Bugs)

Incentivamos os pesquisadores de segurança a focarem sua análise em:

1. **Colisão de Storage Layout UUPS:**
   - Adição de campos em futuras versões ou brechas no array reservado `__gap[50]`.
   - Inspeção via `forge inspect MAIVWRegistry storageLayout`.
2. **Vetores Econômicos e Drenagem de Stake:**
   - Criação de sequências de transações que façam `totalStaked` divergir de `address(this).balance`.
   - Exploração de `reclaimDomain` inflando cauções sem pagamento de ETH correspondente.
3. **Quebra de Validação EIP-712:**
   - Bypass de `ECDSA.recover` ou colisões de hash na struct EIP-712 (`abi.encode` vs `abi.encodePacked`).
   - Replay de provas entre testnet e mainnet.
4. **Manipulação de Sub-identidades e Strikes em Provedores:**
   - Exploração de `issueWarningTicket` para acumular strikes artificiais ou escapar de suspensão.

---

## 7. Quickstart para Auditores (Reprodução Local)

### Pré-requisitos
- Docker instalado (recomendado para ambiente 100% reproduzível) **OU** Foundry CLI v0.8+.

### Passo a Passo

```bash
# 1. Clonar o repositório
git clone https://github.com/maivw/maivw.git
cd maivw

# 2. Executar o script oficial de Sanity Check e Métricas
./protocol/contracts/script/audit-check.sh

# 3. Executar todos os 106 testes automatizados
docker run --rm --entrypoint /bin/sh -v $(pwd)/protocol/contracts:/contracts ghcr.io/foundry-rs/foundry:latest -c "
  cp -r /contracts /tmp/c && cd /tmp/c && forge test -vvv
"

# 4. Executar testes de Fuzzing de Invariantes (256 runs)
docker run --rm --entrypoint /bin/sh -v $(pwd)/packages/contracts:/contracts ghcr.io/foundry-rs/foundry:latest -c "
  cp -r /contracts /tmp/c && cd /tmp/c && forge test --match-contract RegistryInvariantsTest -vvv
"

# 5. Inspecionar o Storage Layout de Upgrades UUPS
docker run --rm --entrypoint /bin/sh -v $(pwd)/packages/contracts:/contracts ghcr.io/foundry-rs/foundry:latest -c "
  cp -r /contracts /tmp/c && cd /tmp/c && forge inspect MAIVWRegistry storageLayout
"
```

---

## 8. Contato de Divulgação Responsável

- **E-mail de Segurança:** `security@maivw.com`
- **SLA de Resposta Inicial:** 24 horas úteis.
