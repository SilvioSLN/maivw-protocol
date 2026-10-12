# MAIVW Protocol

Registro EVM de domínios, Gateway de mensagens P2P/SMTP e Webmail para operação própria.

**Em desenvolvimento: use piloto controlado.** O fluxo atual assina o corpo da mensagem, mas não fornece E2EE, assinatura completa do envelope ou autorização uniforme em toda a API. Leia o [estado dos recursos](docs/src/content/docs/status.md) antes de instalar.

## Começar

- [Instalação com Docker](docs/src/content/docs/users/quickstart-docker.md): exige contrato, RPC e assinante configurados; o Compose não faz deploy da blockchain.
- [Desenvolvimento local](docs/src/content/docs/contributors/local-setup.md): Node.js, Prisma, Anvil e interfaces.
- [API](docs/src/content/docs/api/gateway.md) e [inventário de rotas](docs/src/content/docs/api/routes.md).
- [Backup e operação](docs/src/content/docs/self-hosting/operations.md).
- [Checklist de correções e pendências](docs/IMPLEMENTATION-CHECKLIST.md).

## Organização

| Diretório | Conteúdo |
| --- | --- |
| `contracts/` | Registry e Lens Solidity/Foundry |
| `gateway/` | API Fastify, armazenamento e integrações |
| `webmaivw/` | Webmail Next.js |
| `dashboard/` | Interface de consultas e telemetria |
| `docs/` | Site Astro/Starlight |

Cada aplicação tem dependências próprias. Siga o setup antes dos comandos de validação:

```bash
(cd gateway && npm test && npm run build)
(cd contracts && forge test)
(cd docs && npm run check:docs && npm run build)
```

Não versione `.env`, dados de runtime ou backups. A licença da raiz está em [LICENSE](LICENSE); dependências e arquivos com cabeçalhos próprios devem ser considerados conforme suas licenças.
