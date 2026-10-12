---
title: Registry, Lens e governança
description: Contratos, estados, permissões e implantação por ambiente.
---

O repositório contém `MAIVWRegistry.sol` e `MAIVWRegistryLens.sol`. O Registry é implantado atrás de proxy UUPS: configure no Gateway o endereço do **proxy**, não o da implementação nem o da Lens.

## Estados e permissões

Os estados incluem `ACTIVE`, `SUSPENDED`, `SLASHED` e `REVOKED`, além do estado inicial sem registro. `publicKey` é o endereço EVM do assinante operacional; `adminKey` administra a identidade. O contrato permite separar essas chaves, mas alguns fluxos de onboarding atribuem o mesmo endereço às duas — não há separação física automática.

A governança inclui owner, guardian, oráculo, pausa e operações com timelocks. Consulte `contracts/SECURITY.md`, o código e os testes de governança. Atualizabilidade e poderes administrativos devem fazer parte do modelo de confiança.

Tiers `STARTUP`, `GROWTH` e `ENTERPRISE` definem caução, volume e penalidade conforme configuração. Não representam SLA de infraestrutura. Recuperação, slashing, retiradas e espelhamento possuem pré-condições próprias.

## Função da Lens

A Lens oferece `getCompanies`, `getAllCompanies` e `getEnrichedProfiles`: paginação, agregação e leitura enriquecida. A herança hierárquica de subdomínios está no `LedgerService` do Gateway. A variável `BASE_REGISTRY_LENS_ADDRESS` não é consumida pela configuração atual do Gateway.

## Redes e endereços

| Ambiente | Chain ID | Orientação |
| --- | --- | --- |
| Anvil | `31337` | Rede e deploy automáticos no Compose local; o RPC não é um explorer |
| Base Sepolia | `84532` | Exemplo em `.env.testnet.example` |
| Arbitrum Sepolia | `421614` | Integrações de espelhamento a validar |
| Polygon Amoy | `80002` | Integrações de espelhamento a validar |
| Base Mainnet | `8453` | Exige validação de produção; não é o padrão deste guia |

Esta documentação não certifica endereços de deploy público. Obtenha o endereço e a evidência de implantação da rede desejada ou faça seu próprio deploy de teste.

## Deploy local

O caminho recomendado implanta automaticamente após o Anvil ficar saudável:

```bash
docker compose up -d --build
docker compose logs contracts-deployer
docker compose exec contracts-deployer cat /deploy-output/contract-address.txt
```

Para executar manualmente com Foundry, inicie um Anvil e, a partir de `contracts/`:

```bash
forge build
# DEPLOYER_PRIVATE_KEY deve estar exportada no ambiente deste processo.
forge script script/Deploy.s.sol:DeployScript --rpc-url http://localhost:55443 --broadcast
```

O script local define o deployer como oráculo. O Compose usa a conta pública #0 do Anvil para ambos e rejeita essa chave fora do ambiente local. A rede local tem taxas e saldos artificiais.

Para Testnet, implante conscientemente com RPC, saldo e chave próprios, copie o endereço do **proxy** para `.env.testnet` e use `compose.testnet.yml`. Para produção, revise `DeployMainnet.s.sol`, `config/mainnet.json`, governança, permissões e auditoria antes de transmitir qualquer transação. Não replique os parâmetros locais.

`registerIntentBatch` existe no contrato, mas o envio atual não o invoca para produzir o header de intenção. Veja a [especificação P2P](/developers/p2p-handshake-spec/).
