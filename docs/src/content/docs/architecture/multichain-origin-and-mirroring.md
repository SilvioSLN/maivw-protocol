---
title: Origem e espelhamento multichain
description: Arquitetura para registrar domínios em EVM ou Solana e espelhar seu estado entre redes.
---

## Status da decisão

**Aceita para implementação inicial em 13 de outubro de 2026.**

Esta arquitetura substitui a hipótese de que a Base seria sempre a origem. A origem é escolhida por domínio: Base, Arbitrum, Polygon ou Solana podem manter o estado canônico, enquanto as demais redes recebem mirrors.

## Decisões

1. Cada domínio possui exatamente uma rede de origem ativa.
2. A origem é escolhida durante a prova DNS e não muda no MVP.
3. A rede de origem executa todo o ciclo econômico e de governança do domínio.
4. Um mirror é somente leitura para identidade e reputação; apenas atestações da origem podem atualizá-lo.
5. O oráculo e o catálogo global serializam a escolha inicial da origem.
6. Chaves são valores tipados. Uma Pubkey Solana não é convertida em endereço EVM fictício.
7. Epoch e sequence monotônicas ordenam atualizações em todas as redes.

## Por que o catálogo de origem é necessário

Base e Solana não compartilham execução atômica. Sem coordenação, duas pessoas poderiam tentar registrar o mesmo domínio nas duas redes antes que um relayer observasse qualquer uma delas.

O fluxo de registro começa com uma reserva no catálogo:

1. O cliente solicita um desafio para `dominio.com` e escolhe a rede de origem.
2. O oráculo fornece um valor DNS TXT de uso único.
3. Depois de validar DNS, o serviço abre uma transação no catálogo.
4. Uma constraint única em `domainHash` garante uma única reserva ativa.
5. O oráculo emite `OriginClaimV1` vinculado à rede, registry, registrante e prazo.
6. A transação de registro consome o claim na rede escolhida.
7. O recibo confirmado ativa a origem; claims não consumidos expiram.

O catálogo não substitui a propriedade on-chain. Ele impede concorrência entre ledgers que não conseguem consultar um ao outro durante a mesma transação. Todas as decisões e transições do catálogo precisam permanecer auditáveis.

As regras transacionais, de expiração e de recuperação estão em [Catálogo de origem e concorrência](/architecture/origin-catalog-and-concurrency/).

## Identificadores

### DomainId

`DomainId` continua compatível com o Registry EVM:

```text
domainCanonical = lowercase(asciiPunycode(domain))
domainHash = keccak256(utf8(domainCanonical))
```

A validação on-chain deve rejeitar maiúsculas, Unicode não convertido, labels inválidos e nomes acima dos limites DNS.

### NetworkId

O Gateway usa identificador textual com namespace explícito:

```text
evm:8453
evm:421614
evm:80002
solana:<cluster-genesis-hash>
```

O programa armazena a representação binária versionada equivalente. `chainId` não deve ser usado como campo universal porque clusters Solana não têm chain ID EVM.

### RegistryId

`RegistryId` contém:

- `networkId`;
- família `EVM` ou `SOLANA`;
- endereço de 20 bytes do contrato EVM ou Pubkey de 32 bytes do programa Solana;
- versão do protocolo.

### KeyDescriptor

```text
KeyDescriptor {
  algorithm: SECP256K1_EVM_ADDRESS | ED25519_SOLANA_PUBKEY | ED25519_RAW,
  keyBytes: bytes,
}
```

Os tamanhos aceitos são determinados pelo algoritmo. Padding, truncamento e derivação de alias são proibidos.

### TxReference

- EVM: chain ID, block number, block hash, transaction hash e log index.
- Solana: cluster genesis hash, slot, signature e instruction index. Quando a referência precisa caber em `bytes32`, usa-se `SHA-256(base58_decode(signature))`; aplicar SHA-256 ao texto base58 produziria outra referência e é proibido.

## Estado canônico e estado espelhado

| Dado/operação | Origem | Mirror |
| --- | --- | --- |
| Nome, hash, endpoint e TLS | grava e governa | replica |
| Chaves operacional e administrativa | grava e rotaciona | replica como `KeyDescriptor` |
| Status, epoch e sequence | determina | valida monotonicidade e replica |
| Stake e vault | custodia e movimenta | não custodia; pode exibir valor atestado |
| Provider, tier, strikes e limite | determina e pune | replica estado agregado |
| Warning e slashing | executa | recebe resultado final |
| Recovery e reclaim | executa | recebe novo epoch e invalida estado anterior |
| Intent batch | registra na origem | replicação opcional conforme política futura |
| Admin local do mirror | inexistente | não pode mudar identidade |
| Pause da rede | pausa operações locais | não muda a origem global |

## Registry Solana

O programa Solana não é apenas um mirror. `DomainRecord.recordKind` define dois comportamentos:

### `ORIGIN`

- exige `OriginClaimV1`;
- recebe taxa e stake;
- permite provider, warnings, slashing, recovery e reclaim;
- emite eventos para fan-out aos mirrors;
- usa admin Ed25519/Solana como autoridade on-chain;
- pode manter uma chave operacional de algoritmo diferente da chave administrativa.

### `MIRROR`

- exige `StateAttestationV1` emitida para o programa e cluster de destino;
- não possui stake gastável local;
- rejeita instruções administrativas do domínio;
- só aceita `sync_mirror` e `revoke_mirror` com origem idêntica e sequence crescente;
- mantém tombstone após revogação.

## Compatibilidade no Registry EVM

O `CompanyProfile` atual usa `address` para `publicKey` e `adminKey`. Isso não representa uma Pubkey Solana de 32 bytes.

O upgrade EVM deve adicionar storage, sem reordenar campos existentes, para:

- tipo e bytes da chave operacional externa;
- tipo e bytes da chave administrativa externa;
- network/registry de origem;
- `globalDomainEpoch` e `originSequence`;
- referência da última atualização.

`registerMirrorV2` e `syncMirrorV2` usam esses campos. O Gateway consulta a chave tipada para validar mensagens; não utiliza endereço EVM sintético.

## Ordenação, finalidade e replay

Cada domínio de origem mantém:

- `globalDomainEpoch`: incrementa em reclaim ou troca de titularidade por recovery;
- `originSequence`: incrementa em toda alteração replicável;
- `attestationNonce`: identifica a autorização específica;
- `deadline`: limita a janela de consumo.

Um destino aceita atualização somente quando:

```text
attestation.originRegistry == mirror.originRegistry
attestation.domainHash == mirror.domainHash
attestation.globalDomainEpoch >= mirror.globalDomainEpoch
attestation.originSequence > mirror.originSequence
attestation.destinationRegistry == this registry
attestation.deadline >= current time
attestation nonce ainda não consumido
```

Se o epoch aumentar, estados pendentes do epoch anterior são inválidos. Se epoch for igual, a sequence deve crescer estritamente. Atualizações idênticas já confirmadas são tratadas como sucesso idempotente pelo relayer, sem nova mutação.

### Finalidade inicial

- EVM: número configurável de confirmações por rede, seguido de releitura no bloco confirmado.
- Solana: commitment `finalized`, seguido de releitura da conta e da transação.

Os valores operacionais ficam em configuração, não no protocolo de atestação. O relayer grava o ponto exato de origem usado.
O observer EVM persiste bloco, eventos e cursor atomicamente, limita a leitura a `head - confirmations` e retoma do mesmo bloco após falha ou reinício.

### Reorg

Eventos ainda não finalizados não geram atestação. Se um provedor RPC apresentar história incompatível, o observer pausa aquele caminho e reconcilia com outro endpoint. Uma atualização já finalizada só é compensada por nova atestação com sequence superior; mirrors nunca fazem rollback silencioso.
Ao detectar mudança no hash do último bloco persistido, o observer mantém a ramificação anterior como `ORPHANED`, recua até o ancestral comum e refaz o backfill da nova ramificação.

## Atestações

### OriginClaimV1

Autoriza a primeira criação canônica e inclui:

- versão e tipo de mensagem;
- domain hash;
- origin network e origin registry;
- registrante e chaves tipadas;
- provider/tier pretendidos;
- claim ID, nonce e deadline;
- hash do desafio DNS validado.

### StateAttestationV1

Autoriza criação, sincronização ou revogação de mirror e inclui:

- versão, ação e domain hash;
- origin network/registry e destination network/registry;
- epoch e sequence;
- hash do estado canônico serializado;
- referência da transação de origem;
- nonce e deadline.

Os codecs Rust, TypeScript e Solidity devem compartilhar vetores de teste. Para o MVP, o signer permanece secp256k1 para compatibilidade com o KMS atual; na Solana a transação usa o precompile secp256k1 e o programa inspeciona a instrução de verificação.

## Economia Solana

A política econômica do MVP está definida em [Economia do Registry Solana](/architecture/solana-economics/). Em resumo: taxa e caução usam um único mint SPL fixado por versão; SOL fica restrito a transaction fees e rent; mirrors não recebem stake local; e o relayer paga a criação inicial das contas de mirror.

## Falhas e confiança

- Oráculo indisponível: novos registros, recoveries e mirrors aguardam; estado existente continua consultável.
- Relayer indisponível: origem continua válida; mirrors ficam atrasados e devem exibir lag.
- Catálogo indisponível: novos OriginClaims param para evitar dupla origem.
- Um destino indisponível não bloqueia fan-out aos outros destinos.
- Conflito de origem detectado aciona circuit breaker; o sistema não escolhe automaticamente um vencedor.
- A governança de cada rede pode pausar seu Registry, mas não alterar a origem de um domínio em outra rede.

## Demonstração prática dos dois sentidos (Devnet e Testnets EVM)

O protocolo suporta e valida em testnets públicas o registro canônico com espelhamento bidirecional completo em quatro redes configuradas pelo próprio operador em `.env.testnet`:
- **Solana Devnet** (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`)
- **Base Sepolia** (`evm:84532`)
- **Arbitrum Sepolia** (`evm:421614`)
- **Polygon Amoy** (`evm:80002`)

### 1. Sentido Solana (Origem) → Mirrors EVM

Neste fluxo, o registrante escolhe a Solana como rede de origem canônica de um domínio (por exemplo, `origin-example.test`):
1. **Registro na Origem (Solana Devnet)**: O programa `maivw_registry` implantado pelo operador (`SOLANA_PROGRAM_ID`) cria o `DomainRecord` com `record_kind = ORIGIN`, chaves nativas Ed25519 e custódia de taxas/stake via SPL Token mint (`SOLANA_ASSET_MINT`).
   - **Envelope de execução**: Utiliza Address Lookup Table (ALT) para transações versionadas v0 abaixo da MTU IPv6 de 1.232 bytes (~1.046 bytes e ~170k Compute Units, bem abaixo do orçamento de 450.000 CU).
2. **Fan-out e Atestação**: O observador Solana detecta a finalização do slot e emite `StateAttestationV1` assinada pelo signer configurado do operador (local em Testnet ou KMS).
3. **Criação de Mirrors nos Contratos EVM**:
   - **Base Sepolia, Arbitrum Sepolia e Polygon Amoy**: O relayer submete `registerMirrorV2` nos proxies `MAIVWMirrorRegistryV2` implantados pelo operador em cada rede destino.
4. **Preservação de Chaves**: A chave operacional Ed25519 de 32 bytes é gravada no storage EVM com `keyType = ED25519_SOLANA_PUBKEY` (algoritmo 2). Nenhuma derivação sintética de endereço EVM é aplicada.

### 2. Sentido EVM (Origem) → Mirror Solana

Neste fluxo, o domínio é registrado canonicamente numa rede EVM e espelhado na Solana:
1. **Origens EVM registradas**: O titular executa `registerCompany` no contrato canônico `MAIVWRegistry` da rede EVM escolhida (Base Sepolia, Arbitrum Sepolia ou Polygon Amoy).
2. **Espelhamento no Programa Solana**: Após confirmação finalizada na rede de origem, o relayer constrói a instrução `register_mirror` precedida pela verificação secp256k1 nativa e cria o `DomainRecord` espelhado na Solana.
3. **Preservação de Chaves**: O endereço secp256k1 EVM de 20 bytes é armazenado no `DomainRecord` Solana como `KeyDescriptor` com `algorithm = 1` (`SECP256K1_EVM_ADDRESS`).

### 3. Roteiro de Demonstração e Verificação (Demo Flow)

Para executar sua própria bateria em Testnet (usando suas credenciais e contratos em `.env.testnet`, `contracts/deployments/testnets.json` e `solana/deployments/devnet.json`) e auditar o estado consolidado:

```bash
# 1. Executar o ensaio E2E no seu próprio ambiente Testnet (gera evidência local ignorada pelo Git)
npm --prefix protocol/gateway run testnet:e2e:sm080

# 2. Em um Gateway com catálogo/indexadores configurados, consultar a visão consolidada
curl -s http://localhost:3001/api/v1/multichain/status/origin-example.test | jq .
```

```bash
# 3. Exercitar localmente a lógica de reconciliação (estados sintéticos)
npm --prefix protocol/gateway run test:sm086

# 4. Gerar o relatório local de prontidão e seus gates pendentes
npm --prefix protocol/gateway run test:sm087
```

### 4. Delimitação de Escopo e Alegações Corretas

Para manter estrita fidelidade técnica e evitar alegações indevidas:
- **Autoridade Única**: O espelhamento **não** transforma o MAIVW numa rede multi-master. Cada domínio possui apenas uma rede de origem soberana; mirrors são réplicas criptograficamente atestadas para leitura rápida e resolução de e-mails em cada ecossistema.
- **Não-Custódia em Mirrors**: Mirrors nunca retêm stake nem movimentam ativos econômicos. Slashing e penalidades acontecem exclusivamente na origem.
- **Finalidade Assíncrona**: O tempo de sincronização entre Solana e EVM reflete a finalidade real dos blocos e os batches de L2. As metas p95 de 60s/90s são objetivos operacionais ainda sem janela estatística de produção; não há promessa de finalidade síncrona instantânea.
- **Limites de Prontidão**: A evidência atual comprova testnets públicas e regressões automatizadas. Auditoria externa, handoff das authorities para multisig, canário on-chain contínuo e medição de SLO em janela operacional continuam como gates de produção.

## Fora do MVP

- Transferência de origem entre redes.
- Ponte trustless/light-client entre EVM e Solana.
- Promoção automática de mirror após falha da origem.
- Wallet Solana obrigatória para usuário quando o relayer puder patrocinar a operação.
