<p align="center">
  <a href="https://docs.maivw.com" target="_blank" rel="noopener noreferrer">
    <img src="src/assets/brand/monogram-badge.png" alt="Logotipo da Documentação do MAIVW Protocol" width="100" height="100" />
  </a>
</p>

<h1 align="center">Documentação do MAIVW Protocol</h1>

<p align="center">
  <strong>Portal Oficial de Documentação Técnica do MAIVW Protocol</strong>
</p>

<p align="center">
  Código-fonte do portal de documentação publicado em <a href="https://docs.maivw.com"><strong>docs.maivw.com</strong></a>, desenvolvido com <a href="https://astro.build">Astro</a> e <a href="https://starlight.astro.build">Starlight</a>.
</p>

<p align="center">
  <a href="README.md">English</a> | 🌐 <strong>Português (Brasil)</strong>
</p>

<p align="center">
  <a href="https://docs.maivw.com"><img src="https://img.shields.io/badge/Docs-docs.maivw.com-6366f1?style=for-the-badge&logo=astro&logoColor=white" alt="Documentação Online" /></a>
  <a href="https://maivw.com"><img src="https://img.shields.io/badge/Website-maivw.com-0ea5e9?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Site Oficial MAIVW" /></a>
  <a href="https://app.maivw.com"><img src="https://img.shields.io/badge/Cloud-app.maivw.com-10b981?style=for-the-badge&logo=googlecloud&logoColor=white" alt="MAIVW Cloud" /></a>
  <a href="https://www.youtube.com/watch?v=6uFptIQzlBI"><img src="https://img.shields.io/badge/V%C3%ADdeo-YouTube%20(PT--BR)-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="Vídeo Explicativo PT-BR" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Astro-7.2-BC52EE?style=flat-square&logo=astro&logoColor=white" alt="Astro 7.2" />
  <img src="https://img.shields.io/badge/Starlight-0.42-6366F1?style=flat-square&logo=starlight&logoColor=white" alt="Starlight 0.42" />
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 20+" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.8" />
  <a href="../LICENSE"><img src="https://img.shields.io/badge/Licen%C3%A7a-MIT-yellow?style=flat-square" alt="Licença MIT" /></a>
</p>

---

## 📖 Portal Online

A documentação oficial, interativa e completa com busca global está disponível em:

👉 **[https://docs.maivw.com](https://docs.maivw.com)**

### Conteúdo abordado:
- **Começando & Quickstart:** Onboarding rápido, configuração via Docker e envio do primeiro e-mail.
- **Arquitetura do Protocolo:** Roteamento híbrido SMTP/P2P, handshakes P2P via DANE mTLS e modelo multichain de identidade.
- **Contratos Inteligentes:** Registry EVM (Base, Arbitrum, Polygon) em Solidity e programa Registry Solana em Anchor/Rust.
- **Referência de API & Inventário de Rotas:** Especificação de endpoints HTTP, métodos de autenticação e catálogo sincronizado diretamente com o código do Gateway.
- **Guia de Auto-Hospedagem (Self-Hosting):** Deploy de produção com Docker Compose, configuração de variáveis de ambiente e papéis de execução.
- **Segurança e Matriz de Ameaças:** Limites criptográficos de confiança, políticas de autoridade de chaves e auditoria operacional.

---

## 🛠️ Manutenção e Desenvolvimento Local

Este diretório contém a fonte da documentação estática oficial construída com [Starlight](https://starlight.astro.build) sobre a plataforma [Astro](https://astro.build).

### Pré-requisitos
- **Node.js** `20.x` ou superior (recomendado LTS)
- **npm** `10.x` ou superior

### Comandos de Desenvolvimento

Na pasta `docs/`:

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor local de desenvolvimento interativo (disponível em http://localhost:4321)
npm run dev

# 3. Validar consistência técnica e integridade de links
npm run check:docs

# 4. Regenerar inventário de rotas a partir do código do Gateway (quando houver novas rotas)
npm run docs:routes

# 5. Gerar build estático otimizado de produção (salvo em dist/)
npm run build

# 6. Pré-visualizar localmente o build gerado
npm run preview
```

---

## 🔍 Validação Mecânica de Consistência (`check:docs`)

A documentação conta com um validador automatizado rigoroso ([scripts/check-docs.mjs](scripts/check-docs.mjs)) acionado por:

```bash
npm run check:docs
```

Esse gate mecânico assegura que:
1. **Nenhum Link Quebrado:** Valida todos os links internos em Markdown/MDX e referências a arquivos estáticos.
2. **Navegação Completa na Barra Lateral:** Garante que toda página criada esteja registrada no `sidebar` de `astro.config.mjs`.
3. **Sincronia do Inventário de Rotas:** Confere se as rotas documentadas refletem com precisão as rotas Fastify registradas em `protocol/gateway/src/routes`.
4. **Cobertura de Variáveis de Ambiente:** Comprova que toda variável declarada no schema do Gateway (`protocol/gateway/src/config.ts`) possui documentação detalhada em `self-hosting/env-vars.md`.

---

## 📁 Estrutura de Arquivos

```text
docs/
├── astro.config.mjs          # Configuração do Starlight, tema, analítica e menu lateral
├── package.json              # Dependências e scripts de build
├── public/                   # Arquivos estáticos e favicons
├── scripts/
│   └── check-docs.mjs        # Validador de integridade técnica e gerador de rotas
└── src/
    ├── assets/brand/         # Ativos visuais oficiais e logotipos
    ├── content/docs/         # Conteúdo das páginas (Markdown / MDX)
    │   ├── api/              # Referência de APIs do Gateway e inventário de rotas
    │   ├── architecture/     # Especificações de arquitetura do protocolo
    │   ├── contracts/        # Documentação dos smart contracts (EVM e Solana)
    │   ├── contributors/     # Guias para mantenedores e desenvolvedores core
    │   ├── developers/       # Especificações técnicas, custos de gas e segurança
    │   ├── self-hosting/     # Guias de Docker, variáveis e operações em produção
    │   ├── tutorials/        # Tutoriais passo a passo e migrações
    │   └── users/            # Guias para usuários de Webmail e DNS
    └── styles/
        └── custom.css        # Estilos customizados da identidade visual
```

---

## 🤝 Diretrizes de Contribuição

Contribuições para a documentação técnica são muito bem-vindas!

- Antes de abrir um Pull Request, execute `npm run check:docs` e `npm run build` para validar links e páginas.
- Ao alterar rotas do Gateway, execute `npm run docs:routes` para manter `src/content/docs/api/routes.md` atualizado.
- Consulte nossas [Diretrizes de Contribuição](../CONTRIBUTING.md) e [Código de Conduta](../CODE_OF_CONDUCT.md).

---

## 📄 Licença e Proteção de Marca

O texto e os exemplos de código da documentação são distribuídos sob a licença [MIT](../LICENSE).

> **Aviso de Marca Registrada e Identidade Visual:**
> O nome **MAIVW**, o logotipo e os ativos de identidade visual em `src/assets/brand/` são marcas e propriedades exclusivas do projeto MAIVW e NÃO estão licenciados para uso comercial enganoso ou rebranding não autorizado. Consulte o arquivo [LICENSE](../LICENSE) para obter todos os detalhes.
