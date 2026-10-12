import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(docs, '..');
const content = resolve(docs, 'src/content/docs');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]);
const routeFiles = [resolve(repo, 'gateway/src/index.ts'), ...walk(resolve(repo, 'gateway/src/routes')).filter((p) => p.endsWith('.ts'))];
const routes = routeFiles.flatMap((p) => [...readFileSync(p, 'utf8').matchAll(/app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)].map((m) => ({
  method: m[1].toUpperCase(), path: m[2], file: relative(repo, p),
}))).sort((a, b) => `${a.file} ${a.path} ${a.method}`.localeCompare(`${b.file} ${b.path} ${b.method}`));
const inventory = resolve(content, 'api/routes.md');
if (process.argv.includes('--write-routes')) {
  let body = `---\ntitle: Inventário de rotas\ndescription: Métodos e caminhos registrados no código do Gateway, agrupados por módulo.\n---\n\n`;
  body += `Inventário estático de **${routes.length} rotas**. Gerado por \`npm run docs:routes\`; não equivale a uma especificação OpenAPI nem a uma auditoria de autorização. O link de cada módulo aponta para seu código no repositório.\n\n`;
  body += `Consulte [mensagens e anexos](/api/gateway/), [contas e onboarding](/api/accounts/) e [SMTP e administração](/api/operations/) para entradas e limites.\n\n`;
  body += `## Política de acesso por área\n\n| Área | Situação atual |\n| --- | --- |\n| Contas, API keys e configurações | Autorização parcial; mensagens exigem usuário/caixa ativa, criação local de domínio retorna 410 |\n| Send | API key de domínio verificado ou JWT de caixa ativa; remetente vinculado à credencial |\n| Inbox P2P | Assinatura de conteúdo e políticas do receptor; não usa sessão do Webmail |\n| Onboarding | JWT administrativo, domínio próprio, desafio DNS e recibo; fulfill-registration suspenso (503) |\n| Anexos | Não há autorização de proprietário no handler atual |\n| Routing | JWT admin ou chave interna; isolamento entre organizações a revisar |\n| Webhook | Segredo compartilhado só exigido quando configurado |\n| Multichain | Proteção específica em fulfill-mirror; não há proteção uniforme do módulo |\n| Stealth, economics, node e oracle | Sem proteção uniforme de sessão; manter administração privada |\n\n`;
  for (const file of [...new Set(routes.map((r) => r.file))]) {
    body += `## ${file.split('/').at(-1)}\n\n[Fonte: ${file}](https://github.com/SilvioSLN/maivw-protocol/blob/main/${file})\n\n| Método | Caminho |\n| --- | --- |\n`;
    body += routes.filter((r) => r.file === file).map((r) => `| \`${r.method}\` | \`${r.path}\` |`).join('\n') + '\n\n';
  }
  writeFileSync(inventory, body);
}
const pages = walk(content).filter((p) => ['.md', '.mdx'].includes(extname(p)));
const slugs = new Set(pages.map((p) => relative(content, p).replace(/\.mdx?$/, '')));
slugs.add('');
const errors = [];
for (const file of pages) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\]\((\/[^\s)]*)\)|^\s+link:\s*(\/\S+)/gm)) {
    const url = m[1] || m[2];
    const slug = url.split(/[?#]/)[0].replace(/^\/|\/$/g, '');
    if (!slugs.has(slug) && !existsSync(resolve(docs, 'public', slug))) errors.push(`${relative(docs, file)}: link ausente ${url}`);
  }
}
const sidebar = [...readFileSync(resolve(docs, 'astro.config.mjs'), 'utf8').matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]);
for (const slug of sidebar) if (!slugs.has(slug)) errors.push(`Sidebar: página ausente ${slug}`);
const legacy = new Set(['architecture/p2p-handshake', 'tutorials/node-setup', 'tutorials/dns-configuration']);
for (const slug of slugs) if (slug && !sidebar.includes(slug) && !legacy.has(slug)) errors.push(`Página sem navegação: ${slug}`);
const documented = new Set([...readFileSync(inventory, 'utf8').matchAll(/\| `(GET|POST|PUT|PATCH|DELETE)` \| `([^`]+)` \|/g)].map((m) => `${m[1]} ${m[2]}`));
const actual = new Set(routes.map((r) => `${r.method} ${r.path}`));
for (const route of actual) if (!documented.has(route)) errors.push(`Rota não inventariada: ${route}`);
for (const route of documented) if (!actual.has(route)) errors.push(`Rota removida ainda documentada: ${route}`);
const config = readFileSync(resolve(repo, 'gateway/src/config.ts'), 'utf8').split('export type EnvConfig')[0];
const envs = [...config.matchAll(/^  ([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
const envdoc = readFileSync(resolve(content, 'self-hosting/env-vars.md'), 'utf8');
for (const name of envs) if (!envdoc.includes(`\`${name}\``)) errors.push(`Variável sem referência: ${name}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`OK: ${pages.length} páginas, ${actual.size} rotas e ${envs.length} variáveis do schema; links locais e navegação consistentes.`);
}
