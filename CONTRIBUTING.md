# Contributing to MAIVW Protocol

Thank you for your interest in contributing to MAIVW Protocol! MAIVW is an open-source decentralized B2B hybrid email and identity protocol.

We welcome contributions from everyone, including bug fixes, documentation improvements, new features, and test coverage expansions.

---

## Code of Conduct

All contributors and maintainers are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Please report any unacceptable behavior according to our [Security & Contact Policy](SECURITY.md).

---

## Repository Structure

The MAIVW Protocol codebase is organized into modular directories:

- **`contracts/`**: EVM Smart Contracts (Solidity) built and tested with Foundry. Includes Registry, Mirror Registry V2, UUPS proxies, and token economics.
- **`gateway/`**: Fastify REST API, cryptographic P2P node, ledger service, oracles, and asynchronous workers (TypeScript / Node.js).
- **`solana/`**: Solana Anchor program (`maivw-registry`), IDL definitions, and Rust test suites.
- **`webmaivw/`**: Next.js 15 sovereign corporate webmail client with sandboxed email rendering.
- **`dashboard/`**: Next.js admin observability and registry monitoring interface.
- **`docs/`**: Official technical documentation built with Astro Starlight.

---

## Development Setup

### Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0`
- **Docker & Docker Compose**: For local services (PostgreSQL, Redis, Anvil).
- **Rust & Cargo**: `>= 1.75.0` (required for Solana program verification).
- **Foundry (`forge`)**: For compiling and running EVM smart contract tests.

### Initial Installation

```bash
# Clone the repository
git clone https://github.com/SilvioSLN/maivw-protocol.git
cd maivw-protocol

# Install root dependencies
pnpm install

# Start local infrastructure (Postgres, Redis, Anvil)
docker compose up -d
```

---

## Running Verification Tests

Before submitting a Pull Request, verify that all relevant test suites pass locally:

### Gateway & Cloud Integrations
```bash
cd gateway
pnpm install
pnpm test
```

### Solana Rust Workspace
```bash
cd solana
cargo test --workspace --locked
```

### EVM Smart Contracts
```bash
cd contracts
forge test --summary
```

### Documentation Consistency
```bash
cd docs
pnpm check:docs
pnpm build
```

---

## Secrets & Security Rules

To protect the integrity of the open-source repository and maintainer safety:

1. **NEVER commit secrets or real credentials**: This includes private keys, mnemonic seed phrases, AWS access keys, API keys, or live service account JSONs.
2. **Use configuration templates**:
   - For environment variables, use `.env.example` and `.env.testnet.example`.
   - For testnet deployment addresses, use `contracts/deployments/testnets.example.json` and `solana/deployments/devnet.example.json`.
3. Tracked files must only contain synthetic placeholders (e.g., `0x0000...`, `CHANGE_ME_...`, or Anvil default local keys).

---

## Commit Guidelines & PR Workflow

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` A new feature or capability.
- `fix:` A bug fix.
- `docs:` Documentation-only changes.
- `refactor:` Code restructuring without behavioral changes.
- `test:` Adding or updating tests.
- `chore:` Maintenance, dependency updates, or configuration adjustments.

### Pull Request Steps

1. Create a descriptive feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your commits adhering to Conventional Commits.
3. Run the local test suites to ensure zero regressions.
4. Push your branch and open a Pull Request against `main`.
5. Fill in the provided [Pull Request Template](.github/pull_request_template.md).
