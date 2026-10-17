---
title: Gas, taxas e custos operacionais
description: Diferencie transporte HTTP, operações on-chain e custos de operação.
---

O transporte do conteúdo ocorre por HTTP entre Gateways ou por um provedor SMTP. No fluxo de envio atual, o Gateway não registra uma transação de intenção por mensagem. Isso deve ser lido junto à [limitação da prova de intenção](/developers/p2p-handshake-spec/), e não como comprovação de um sistema on-chain completo sem custo.

## Custos por operação

| Operação | Custos relevantes |
| --- | --- |
| Mensagem P2P atual | Servidor, armazenamento, tráfego, consultas RPC e operação |
| Fallback SMTP | Custos e limites do provedor configurado |
| Registro de domínio | Gas da transação e taxa exigida pelo contrato |
| Registro de provedor | Gas, taxa e caução conforme configuração do tier |
| Rotação de chaves, endpoint e governança | Gas quando há transação |
| Consulta `eth_call` | Sem transação paga pelo chamador; o serviço RPC pode cobrar |
| `registerIntentBatch` | Gas se a integração passar a registrar raízes on-chain |
| Disputas, espelhamento e recuperação | Gas e condições específicas de cada operação |

As taxas e tiers são parâmetros do contrato e podem mudar por governança. Consulte o contrato da rede escolhida; não use valores de Anvil como orçamento de testnet ou produção. Uma caução não deve ser tratada como mensalidade, nem confundida com a taxa não reembolsável.

## Orçamento e métricas operacionais multichain (SM-082)

Os custos, unidades de computação (CU), consumo de gas e tempos de confirmação foram medidos em redes públicas de teste (Solana Devnet, Base Sepolia, Arbitrum Sepolia e Polygon Amoy) no âmbito da especificação SM-082:

### 1. Solana (Devnet)

| Métrica | Medição Real | Limite Operacional | Margem de Segurança |
|---|---|---|---|
| **Registro de Origem (`register_domain`)** | 170.509 CU | 450.000 CU | **62,1%** |
| **Projeção de Mirror (`registerMirror`)** | 194.355 a 203.029 CU | 450.000 CU | **54,9% a 56,8%** |
| **Tamanho da Transação v0 (com ALT)** | 1.046 bytes | 1.232 bytes (MTU) | **15,1% (186 bytes livres)** |
| **Rent PDA `DomainRecord` (1.155 bytes)** | 6.517.640 lamports (0,00651764 SOL) | Rent-exempt permanente | Mínimo consultado na Devnet |
| **Rent PDA `OriginClaimReceipt` (211 bytes)** | 1.722.120 lamports (0,00172212 SOL) | Rent-exempt permanente | Mínimo consultado na Devnet |
| **Taxa Padrão SPL Token** | 1.000.000 (0,001 MAIVW) | Configuração do Registry | Solvência total |

### 2. EVM Testnets (Base, Arbitrum e Polygon)

O orçamento teto estipulado para transações de espelhamento e registro é de **500.000 gas**.

| Rede | Operação | Gas Consumido | Margem vs Teto | Latência observada no ensaio |
|---|---|---|---|---|
| **Base Sepolia (84532)** | `registerMirrorV2` (Proxy) | 365.886 gas | **26,8%** | ~6,4s |
| **Base Sepolia (84532)** | `registerCompany` (Origem) | 377.162 gas | **24,6%** | ~4,4s |
| **Arbitrum Sepolia (421614)** | `registerMirrorV2` (Proxy) | 366.010 gas | **26,8%** | ~1,2s |
| **Arbitrum Sepolia (421614)** | `registerCompany` (Origem) | 378.986 gas | **24,2%** | ~1,5s |
| **Polygon Amoy (80002)** | `registerMirrorV2` (Proxy) | 407.046 gas | **18,6%** | ~5,3s |
| **Polygon Amoy (80002)** | `registerCompany` (Origem) | 367.035 gas | **26,6%** | ~5,0s |

O ensaio apresenta margens superiores a 50% de CU em Solana e 18% a 26% de gas em redes EVM para os caminhos medidos. A amostra é suficiente para orçamento técnico inicial, mas não representa percentis estatísticos nem preço futuro do ativo de cada rede.
