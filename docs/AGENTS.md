# AI Agent Guidelines — MAIVW Protocol Documentation

This guide provides instructions and rules for AI assistants and automated agents working within the `@maivw/protocol-docs` package.

## Package Architecture

- **Framework:** [Astro](https://astro.build) (v7.x) + [Starlight](https://starlight.astro.build) (v0.42.x)
- **Primary Site:** [docs.maivw.com](https://docs.maivw.com)
- **Content Directory:** `src/content/docs/` (Markdown and MDX pages)
- **Configuration:** `astro.config.mjs`

---

## Commands & Workflows

Always use standard npm scripts defined in `package.json`:

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Starts interactive local development server at `http://localhost:4321`. |
| `npm run check:docs` | Runs automated integrity verification (`scripts/check-docs.mjs`). **Mandatory before committing.** |
| `npm run docs:routes` | Regenerates `src/content/docs/api/routes.md` by parsing all Fastify route files in `protocol/gateway/src/routes`. |
| `npm run build` | Compiles static production build into `dist/`. |
| `npm run preview` | Serves the built static site locally for inspection. |

---

## Critical Rules for Modifying Documentation

### 1. Verification Gate (`npm run check:docs`)
Never commit documentation changes without verifying that `npm run check:docs` succeeds with exit code 0. It asserts:
- **No broken internal links:** Every Markdown link `[text](/path/)` must point to an existing slug in `src/content/docs` or a static file in `public/`.
- **Sidebar registration:** Every content page must be present in the `sidebar` configuration inside `astro.config.mjs` (unless explicitly listed in the legacy exception set in `scripts/check-docs.mjs`).
- **Route inventory completeness:** Every HTTP route active in Gateway must be documented in `src/content/docs/api/routes.md`.
- **Environment variables completeness:** Every configuration key in `protocol/gateway/src/config.ts` must be documented in `src/content/docs/self-hosting/env-vars.md`.

### 2. Adding or Renaming Pages
When creating or renaming a file in `src/content/docs/`:
1. Use clean frontmatter:
   ```yaml
   ---
   title: Page Title
   description: Accurate summary of the page content.
   ---
   ```
2. Add the corresponding entry to the `sidebar` array in `astro.config.mjs` under the appropriate category.
3. Run `npm run check:docs` and `npm run build` to confirm.

### 3. Gateway Route Changes
When routes in `protocol/gateway/src/routes/` are added, removed, or modified:
1. Run `npm run docs:routes`.
2. Inspect `src/content/docs/api/routes.md` to confirm the route table and policy summary are consistent.
3. Run `npm run check:docs`.

### 4. Language & Editorial Standards
- The current documentation site content is written primarily in Brazilian Portuguese (`pt-BR`). Keep terminology precise and consistent across files (e.g., *atestações*, *âncora on-chain*, *chave autorizada*, *caução de staking*).
- Root readmes (`README.md` and `README.pt-BR.md`) are bilingual.

---

## Reference Documentation

- [Astro Documentation](https://docs.astro.build)
- [Starlight Documentation](https://starlight.astro.build)
- [Starlight Frontmatter Reference](https://starlight.astro.build/reference/frontmatter/)
