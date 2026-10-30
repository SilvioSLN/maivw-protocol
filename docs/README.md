<p align="center">
  <a href="https://docs.maivw.com" target="_blank" rel="noopener noreferrer">
    <img src="src/assets/brand/monogram-badge.png" alt="MAIVW Protocol Documentation Logo" width="100" height="100" />
  </a>
</p>

<h1 align="center">MAIVW Protocol — Documentation</h1>

<p align="center">
  <strong>Official Technical Documentation Portal for the MAIVW Protocol</strong>
</p>

<p align="center">
  Source code for the documentation portal deployed at <a href="https://docs.maivw.com"><strong>docs.maivw.com</strong></a>, built with <a href="https://astro.build">Astro</a> and <a href="https://starlight.astro.build">Starlight</a>.
</p>

<p align="center">
  🌐 <strong>English</strong> | <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

<p align="center">
  <a href="https://docs.maivw.com"><img src="https://img.shields.io/badge/Docs-docs.maivw.com-6366f1?style=for-the-badge&logo=astro&logoColor=white" alt="Live Documentation" /></a>
  <a href="https://maivw.com"><img src="https://img.shields.io/badge/Website-maivw.com-0ea5e9?style=for-the-badge&logo=googlechrome&logoColor=white" alt="MAIVW Website" /></a>
  <a href="https://app.maivw.com"><img src="https://img.shields.io/badge/Cloud-app.maivw.com-10b981?style=for-the-badge&logo=googlecloud&logoColor=white" alt="MAIVW Cloud" /></a>
  <a href="https://www.youtube.com/watch?v=nizLF3wB8TM"><img src="https://img.shields.io/badge/Video-YouTube%20(EN)-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube EN" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Astro-7.2-BC52EE?style=flat-square&logo=astro&logoColor=white" alt="Astro 7.2" />
  <img src="https://img.shields.io/badge/Starlight-0.42-6366F1?style=flat-square&logo=starlight&logoColor=white" alt="Starlight 0.42" />
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 20+" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.8" />
  <a href="../LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" /></a>
</p>

---

## 📖 Live Portal

The full, searchable, and interactive documentation is hosted at:

👉 **[https://docs.maivw.com](https://docs.maivw.com)**

### What is covered:
- **Getting Started & Quickstart:** Rapid onboarding, Docker setup, and first email dispatch.
- **Protocol Architecture:** Hybrid SMTP/P2P routing, DANE mTLS peer-to-peer handshakes, multi-chain identity model.
- **Smart Contracts:** EVM Registry (Base, Arbitrum, Polygon) in Solidity and Solana Registry program in Anchor/Rust.
- **API Reference & Route Inventory:** Complete HTTP API specifications, authentication methods, and endpoint catalogs synchronized directly with Gateway code.
- **Self-Hosting Guide:** Production deployment with Docker Compose, environment configuration, and runtime roles.
- **Security & Threat Model:** Cryptographic trust boundaries, key authority policies, and operational auditing.

---

## 🛠️ Local Development & Maintenance

This directory contains the complete static documentation website generated via [Starlight](https://starlight.astro.build) on top of [Astro](https://astro.build).

### Prerequisites
- **Node.js** `20.x` or higher (LTS recommended)
- **npm** `10.x` or higher

### Development Workflow

Inside the `docs/` folder:

```bash
# 1. Install dependencies
npm install

# 2. Run the interactive development server (available at http://localhost:4321)
npm run dev

# 3. Validate documentation consistency and link integrity
npm run check:docs

# 4. Regenerate API route inventory from Gateway source code (when routes change)
npm run docs:routes

# 5. Build static production site (outputs to dist/)
npm run build

# 6. Preview the compiled production build locally
npm run preview
```

---

## 🔍 Mechanical Validation Gate (`check:docs`)

The documentation suite includes a strict consistency validator ([scripts/check-docs.mjs](scripts/check-docs.mjs)) executed via:

```bash
npm run check:docs
```

This verification gate guarantees that:
1. **Zero Broken Internal Links:** Validates every Markdown/MDX link and static asset reference.
2. **Sidebar Completeness:** Ensures every content page is properly registered in the navigation sidebar in `astro.config.mjs`.
3. **Gateway Route Inventory Sync:** Cross-checks documented API routes against active Fastify route definitions in `protocol/gateway/src/routes`.
4. **Environment Variables Coverage:** Asserts that every variable defined in the Gateway configuration schema (`protocol/gateway/src/config.ts`) is documented in `self-hosting/env-vars.md`.

---

## 📁 Content Structure

```text
docs/
├── astro.config.mjs          # Starlight integration, theme, analytics, and sidebar menu
├── package.json              # Dependencies and build scripts
├── public/                   # Static files, brand icons, and favicons
├── scripts/
│   └── check-docs.mjs        # Technical integrity & route inventory generator
└── src/
    ├── assets/brand/         # Official logo and monogram image assets
    ├── content/docs/         # Documentation content (Markdown / MDX)
    │   ├── api/              # Gateway API references and route inventory
    │   ├── architecture/     # Architecture whitepaper and specs
    │   ├── contracts/        # EVM and Solana smart contract docs
    │   ├── contributors/     # Guidelines for protocol core developers
    │   ├── developers/       # Developer specs, gas economics, and security
    │   ├── self-hosting/     # Docker setup, env vars, and operational guides
    │   ├── tutorials/        # Step-by-step guides and migrations
    │   └── users/            # Webmail user guides and DNS setup
    └── styles/
        └── custom.css        # Custom CSS styling for Starlight
```

---

## 🤝 Contributing to Documentation

We welcome improvements and translations for the documentation!

- Before submitting changes, always run `npm run check:docs` and `npm run build` to confirm there are no broken links or missing sidebar entries.
- If you add or modify Gateway routes, run `npm run docs:routes` to update `src/content/docs/api/routes.md`.
- Read our [Contributing Guidelines](../CONTRIBUTING.md) and [Code of Conduct](../CODE_OF_CONDUCT.md).

---

## 📄 License & Trademark Notice

The documentation text and code examples are open source under the [MIT License](../LICENSE).

> **Trademark & Brand Protection Notice:**
> The name **MAIVW**, the logo, and the brand identity assets in `src/assets/brand/` are exclusive marks of the MAIVW project and are NOT licensed under the MIT License for commercial re-use or misleading re-branding. See [LICENSE](../LICENSE) for complete terms.
