---
title: Cartório On-Chain & Identidade Descentralizada
description: Arquitetura dos contratos inteligentes de registro, governança e resolução implantados na blockchain.
---

O protocolo MAIVW utiliza contratos na blockchain na rede **Base (Ethereum L2)** e redes compatíveis para ancorar a identidade de domínios, chaves públicas criptográficas, endpoints de entrega e reputação anti-fraude.

## Contratos na Blockchain

### 1. Contrato Central de Cartório (Registry)
Contrato mestre na blockchain (padrão UUPS Upgradeable) que mantém o registro canônico de todos os domínios corporativos e provedores da rede.

#### Estados de um Domínio (`DomainStatus`)
- **`ACTIVE` (1)**: Domínio verificado e apto a enviar e receber mensagens na rede.
- **`SUSPENDED` (2)**: Suspenso temporariamente por falta de caução/saldo (reativável via `topUpBalance`).
- **`SLASHED` (3)**: Penalizado por violações graves comprovadas de spam ou phishing (`slashDomain`).
- **`REVOKED` (4)**: Desativado administrativamente ou mirror cancelado.

#### Modelo de Segurança de Chaves Duplas
Cada domínio registrado possui separação estrita de chaves:
- **`publicKey` (Hot Key)**: Chave operacional utilizada pelo Gateway para assinar envelopes de mensagens e responder a handshakes P2P.
- **`adminKey` (Cold Key)**: Chave administrativa (geralmente uma hardware wallet ou multisig) com permissão exclusiva para alterar endpoints (`updateEndpoint`), rotacionar chaves de operação (`updatePublicKey`) ou transferir a titularidade do domínio.

#### Tiers de Provedores (`ProviderTier`)
Para provedores multi-tenant que operam múltiplos domínios ou alto volume:
- **`STARTUP`**: Caução de entrada para pequenas organizações.
- **`GROWTH`**: Limite diário expandido de mensagens com caução intermediária.
- **`ENTERPRISE`**: SLA e limites corporativos para envio massivo confiável.

#### Escalabilidade via Merkle Trees On-Chain
Para remetentes que disparam mensagens para múltiplos destinatários, o contrato suporta **`registerIntentBatch`**:
- O remetente registra apenas a raiz da Merkle Tree (32 bytes) na blockchain com custo mínimo de gas.
- O envelope de cada destinatário inclui sua prova Merkle individual, validada matematicamente pelo nó receptor.

### 2. Contrato de Consulta e Resolução (RegistryLens)
Contrato auxiliar de visualização sem custo de gas (*view-only*).

- Permite que Gateways realizem **consultas em lote (batch)** de múltiplos domínios e chaves em uma única chamada RPC.
- Executa a **resolução hierárquica e herança wildcard** de subdomínios.
- Reduz a latência de verificação no handshake P2P para menos de 50ms.

---

## Redes & Deployments

| Rede | Chain ID | Finalidade | Explorer |
| :--- | :--- | :--- | :--- |
| **Base Sepolia (Testnet)** | `84532` | Rede de Testes Primária | [sepolia.basescan.org](https://sepolia.basescan.org) |
| **Base Mainnet** | `8453` | Produção / L2 Oficial | [basescan.org](https://basescan.org) |
| **Arbitrum Sepolia** | `421614` | Espelhamento Multi-Chain | [sepolia.arbiscan.io](https://sepolia.arbiscan.io) |
| **Polygon Amoy** | `80002` | Espelhamento Multi-Chain | [amoy.polygonscan.com](https://amoy.polygonscan.com) |
| **Anvil Local** | `31337` | Desenvolvimento Local | `http://localhost:8545` |
