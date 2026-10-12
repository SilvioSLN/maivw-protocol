# Documentação do MAIVW Protocol

A documentação oficial e completa do **MAIVW Protocol** está disponível online em:

👉 **[https://docs.maivw.com](https://docs.maivw.com)**

Para consultar guias de instalação, referência de APIs, contratos inteligentes e arquitetura, acesse o link acima.

---

## 🛠️ Manutenção e Desenvolvimento Local

Este diretório contém a fonte da documentação oficial construída com [Astro](https://astro.build) e [Starlight](https://starlight.astro.build).

### Pré-requisitos
- Node.js 20+
- npm 10+

### Comandos de Desenvolvimento

Na pasta `docs/`:

```bash
# 1. Instalar dependências
npm install

# 2. Executar validação de consistência técnica
npm run check:docs

# 3. Gerar build estático de produção
npm run build

# 4. Pré-visualizar localmente o build gerado
npm run preview
```

Para executar o servidor de desenvolvimento interativo:

```bash
npm run dev
```

### Diretrizes de Contribuição na Documentação

- Mantenha a documentação estritamente fiel às funcionalidades implementadas no código.
- Após alterar rotas ou variáveis de ambiente no Gateway, execute sempre `npm run check:docs` para verificar a consistência de links, rotas e inventários.
- Para acompanhar os marcos técnicos e o status de implementação, consulte o [IMPLEMENTATION-CHECKLIST.md](IMPLEMENTATION-CHECKLIST.md).
