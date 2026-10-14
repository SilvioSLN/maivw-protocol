# Solana Mirror State V2

`register_mirror` consome uma `StateAttestationV1` com ação
`RegisterMirror`. O `payloadHash` é deliberadamente idêntico a
`MAIVWMirrorRegistryV2.hashMirrorStateV2`, permitindo que o mesmo estado
normalizado seja atestado para destinos EVM e Solana.

## Payload assinado

O programa calcula:

```text
typeHash = keccak256(
  "MirrorStateV2(uint8 publicKeyAlgorithm,bytes32 publicKeyData,uint8 adminKeyAlgorithm,bytes32 adminKeyData,bytes32 endpointHash,bytes32 tlsFingerprint,uint8 status,bool isProvider,uint8 tier,uint32 strikeCount,uint64 registrationTime,uint256 attestedStake,uint256 dailyLimit)"
)

payloadHash = keccak256(abi.encode(
  typeHash,
  operationalKey.algorithm,
  operationalKey.value,
  adminKey.algorithm,
  adminKey.value,
  keccak256(bytes(endpoint)),
  tlsFingerprint,
  status,
  isProvider,
  providerTier,
  strikes,
  registrationTime,
  attestedStake,
  attestedDailyLimit
))
```

O preimage tem 448 bytes: 14 slots ABI de 32 bytes. Inteiros são alinhados à
direita em big-endian. Os valores de status no wire seguem o enum EVM:
`Active = 1`, `Suspended = 2` e `Revoked = 3`; o enum Rust interno começa em
zero e nunca é serializado diretamente neste hash.

Vetor normativo:

```text
public/admin algorithm = 1
public/admin key       = 0x0000000000000000000000000707070707070707070707070707070707070707
endpoint               = https://mail.example
tlsFingerprint         = 0x02...02
status                 = 1
isProvider             = true
tier                   = 2
strikeCount            = 3
registrationTime       = 1700000000
attestedStake          = 1000
dailyLimit             = 10000
payloadHash            = 0x309ab981466d054d4a864fe3ce46e60fb25ed3dc4f79e419e50ba63d0f58332b
```

## Campos do envelope

O envelope V1 vincula separadamente `domainHash`, origem, destino,
`globalDomainEpoch`, `originSequence`, nonce, deadline, payload e
`evidenceHash`. Para cadastro:

- tipo deve ser `StateAttestation` e ação `RegisterMirror`;
- origem e registry devem ser não nulos e diferentes do deployment local;
- destino deve ser o network hash e program id locais;
- `evidenceHash` é a referência da transação de origem e não pode ser zero;
- nonce não nulo gera o PDA
  `['mirror-attestation', domainHash, nonce]`, impedindo replay;
- estado inicial `Revoked` é rejeitado; revogação usa a operação própria;
- a origem EVM exige chaves `Secp256k1EvmAddress` com padding canônico;
- a origem Solana aceita `Ed25519SolanaPubkey` ou `Ed25519Raw`.

## Economia e custódia

O relayer paga transaction fee e rent dos PDAs `DomainRecord` e
`MirrorAttestationReceipt`. Não há transferência SPL, `StakeVault` ou stake
local. `attestedStake` e `attestedDailyLimit` são somente informativos;
`currentStake` e `originalRegistrationAmount` permanecem zero no destino.

