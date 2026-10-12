# Documentação do MAIVW

Site estático em Astro/Starlight. O conteúdo público fica em `src/content/docs/`; o menu é definido em `astro.config.mjs`.

## Manutenção

Na pasta `docs/`:

```bash
npm install
npm run check:docs
npm run build
npm run preview
```

Para o servidor de desenvolvimento, siga `AGENTS.md`: `npx astro dev --background`; consulte `npx astro dev status`, `logs` e `stop` para gerenciá-lo.

O build gera `dist/`. O domínio configurado em `site` define URLs canônicas e sitemap; gerar o build não publica o site.

## Consistência com o código

- Documente o comportamento implementado, separando recursos experimentais e pendências em `status.md`.
- Não anuncie E2EE, mTLS automático, assinatura integral, auditoria concluída ou métricas sem evidência.
- Atualize configuração e referência quando mudar variáveis de ambiente.
- Após alterar rotas, execute `npm run docs:routes`, revise o inventário e atualize exemplos/autenticação manualmente.
- `check:docs` verifica links locais entre páginas, navegação, rotas literais e variáveis do schema. Não testa links externos, autenticação, âncoras nem execução dos exemplos.
- As páginas antigas de setup, DNS e handshake mantêm URLs e encaminham ao conteúdo canônico; não duplique procedimentos nelas.

O trabalho em andamento está em [IMPLEMENTATION-CHECKLIST.md](IMPLEMENTATION-CHECKLIST.md), fora da coleção pública.
