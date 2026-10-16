# MAIVW Chain-Agnostic Network Model V1

Gateway code identifies a deployment with an explicit family plus canonical
`NetworkId`; an EVM `chainId` is never used as a universal network identifier.

- EVM: `evm:{chainId}` plus a 20-byte contract address normalized to a
  32-byte `RegistryId`;
- Solana: `solana:{clusterGenesisHash}` plus the program Pubkey encoded as the
  32-byte `RegistryId`.

Each immutable network definition also types:

- the Registry protocol version and RPC endpoint;
- explorer URL templates for transactions, addresses and blocks/slots;
- the settlement asset as native, ERC-20 or SPL, including decimals and token
  address/mint where applicable;
- finality as EVM confirmation count/reorg margin or Solana `finalized`
  commitment/slot margin;
- independent `origin` and `mirror` capabilities.

Constructors validate family-specific identifiers, URLs, assets and finality.
`NetworkCatalog` rejects duplicate network or Registry identifiers and only
resolves exact canonical values, preventing implicit casts between EVM and
Solana.

