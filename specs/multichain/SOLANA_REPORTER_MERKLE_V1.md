# MAIVW Solana Reporter Merkle V1

## Status

Normativo para o programa `maivw-registry` V1. Inteiros usados no endereço de
PDA seguem little-endian; inteiros usados na codificação Merkle seguem
big-endian, conforme definido abaixo.

## Objetivo

O slash não recebe uma lista variável de reporters. O oracle compromete a lista
em uma raiz Merkle e informa `reporterCount`. A execução transfere uma única vez
o valor agregado para o `ReporterPool`. Cada reporter saca sua parcela em uma
transação independente, evitando que custo computacional e tamanho da transação
cresçam linearmente com a quantidade de beneficiários.

## Limites e unicidade

- `reporterCount` está entre `0` e `65_536`.
- `reporterCount == 0` exige raiz zero e causa burn integral do stake.
- `reporterCount > 0` exige raiz não zero.
- A lista de origem MUST conter pubkeys distintas. O oracle é responsável por
  essa validação e o timelock permite auditoria/veto antes da execução.
- A prova contém no máximo 16 irmãos.
- Um `ReporterClaim` por `(ReporterPool, reporterPubkey)` impede saque duplicado,
  mesmo que uma folha seja apresentada mais de uma vez.

## Folha

Cada folha é:

```text
keccak256(
  "MAIVW_REPORTER_V1"       // 17 bytes ASCII
  || domainHash             // bytes32
  || globalDomainEpoch      // uint64 big-endian
  || caseNonce              // bytes32, não zero
  || reporterPubkey         // 32 bytes
)
```

O binding ao domínio, epoch e nonce impede que uma prova seja reutilizada em
outro registro, após reclaim ou em uma nova proposta para o mesmo epoch.

## Nós internos

As folhas são ordenadas lexicograficamente antes da construção. Os pares não
carregam orientação. Para cada nível:

```text
parent = keccak256(min(node, sibling) || max(node, sibling))
```

`min` e `max` usam comparação lexicográfica dos 32 bytes. Quando um nível contém
quantidade ímpar, seu último nó é duplicado e o par `(node, node)` produz o pai.
O processo se repete até restar uma raiz. A prova on-chain contém a sequência de
irmãos, inclusive o próprio nó nos níveis em que houve duplicação.

## PDAs

```text
SlashCase    = PDA("slash-case", domainHash, globalDomainEpoch_u64_le)
ReporterPool = PDA("reporter-pool", domainHash, globalDomainEpoch_u64_le)
ReporterClaim= PDA("reporter-claim", reporterPoolPubkey, reporterPubkey)
```

Só um pool pode ser executado por domínio/epoch. Uma proposta vetada pode ser
substituída no mesmo `SlashCase`, mas deve usar novo `caseNonce`; eventos
preservam o histórico das propostas e vetos anteriores.

## Economia

```text
cap          = min(floor(originalRegistrationAmount * 1000 / 10000), currentStake)
perReporter  = reporterCount == 0 ? 0 : floor(cap / reporterCount)
allocated    = perReporter * reporterCount
burned       = currentStake - allocated
```

O arredondamento é queimado. `execute_slash` transfere `allocated` uma vez para
o ATA do `ReporterPool`, queima `burned` via `BurnChecked` do SPL Token Program e valida a
conservação `allocated + burned == currentStake`. Tokens excedentes enviados
diretamente ao stake vault não são apropriados pelo slash.

`claim_reporter_reward` não depende de `RegistryConfig.active`: uma pausa não
pode bloquear retirada já legitimamente alocada.
