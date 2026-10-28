// Shipped with the Community package and container; no Cloud checkout is required.
export const DEFAULT_LEDGER_POLICY = {
  "version": "1.0.0",
  "networks": [
    {
      "id": "base-mainnet",
      "name": "Base Mainnet",
      "chainId": 8453,
      "writesEnabled": false,
      "readOnly": true,
      "status": "DISABLED_PENDING_AUDIT_AND_FUNDING"
    },
    {
      "id": "arbitrum-one",
      "name": "Arbitrum One",
      "chainId": 42161,
      "writesEnabled": false,
      "readOnly": true,
      "status": "DISABLED_PENDING_AUDIT_AND_FUNDING"
    },
    {
      "id": "polygon-mainnet",
      "name": "Polygon PoS",
      "chainId": 137,
      "writesEnabled": false,
      "readOnly": true,
      "status": "DISABLED_PENDING_AUDIT_AND_FUNDING"
    },
    {
      "id": "solana-mainnet",
      "name": "Solana Mainnet-Beta",
      "genesisHash": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      "writesEnabled": false,
      "readOnly": true,
      "status": "DISABLED_PENDING_AUDIT_AND_FUNDING"
    },
    {
      "id": "base-sepolia",
      "name": "Base Sepolia",
      "chainId": 84532,
      "writesEnabled": true,
      "readOnly": false,
      "status": "ACTIVE_CANARY_STAGING_ONLY"
    },
    {
      "id": "arbitrum-sepolia",
      "name": "Arbitrum Sepolia",
      "chainId": 421614,
      "writesEnabled": true,
      "readOnly": false,
      "status": "ACTIVE_CANARY_STAGING_ONLY"
    },
    {
      "id": "polygon-amoy",
      "name": "Polygon Amoy",
      "chainId": 80002,
      "writesEnabled": true,
      "readOnly": false,
      "status": "ACTIVE_CANARY_STAGING_ONLY"
    },
    {
      "id": "solana-devnet",
      "name": "Solana Devnet",
      "genesisHash": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
      "writesEnabled": true,
      "readOnly": false,
      "status": "ACTIVE_CANARY_STAGING_ONLY"
    },
    {
      "id": "ethereum-mainnet",
      "name": "Ethereum Mainnet",
      "chainId": 1,
      "writesEnabled": false,
      "readOnly": true,
      "status": "DISABLED_PENDING_AUDIT_AND_FUNDING"
    },
    {
      "id": "local",
      "name": "Local Anvil",
      "chainId": 31337,
      "writesEnabled": true,
      "readOnly": false,
      "status": "ACTIVE_LOCAL"
    },
    {
      "id": "hardhat-1337",
      "name": "Local Hardhat",
      "chainId": 1337,
      "writesEnabled": true,
      "readOnly": false,
      "status": "ACTIVE_LOCAL"
    }
  ]
};
