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

## Volume e desempenho

Existem limites por tier, políticas locais e limites dos provedores. O repositório não apresenta benchmark que sustente volume ilimitado, latência fixa ou custo mensal garantido. Meça carga, persistência, tráfego de anexos, RPC e SMTP no seu ambiente antes de dimensionar.

A comparação com serviços comerciais deve incluir backups, manutenção, disponibilidade e pessoal. Esta página não publica preços de terceiros nem conversões fixas de ETH para moeda fiduciária.
