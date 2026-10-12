---
title: Diretrizes de Contribuição
description: Boas práticas, convenções de código, regras de segurança criptográfica e processo de Pull Request no MAIVW Protocol.
---

Agradecemos o seu interesse em contribuir para o **MAIVW Protocol**! Como um projeto de infraestrutura crítica voltado para a soberania de dados e privacidade, mantemos padrões rigorosos de segurança e qualidade técnica.

---

## 🧭 1. Princípios de Desenvolvimento

Toda contribuição para o protocolo aberto deve respeitar os seguintes princípios:

1. **Privacidade e Soberania em Primeiro Lugar**: Nenhuma alteração deve introduzir dependências obrigatórias de terceiros centralizados, telemetria invasiva ou vazamento de metadados em texto puro.
2. **Determinismo Criptográfico**: Qualquer manipulação de envelopes de e-mail, assinaturas ou chaves deve seguir especificações matemáticas comprovadas e ser amplamente testada.
3. **Compatibilidade Gradual**: Melhorias no protocolo P2P não devem quebrar o suporte à interoperabilidade SMTP com o ecossistema existente da internet.

---

## 🔒 2. Segurança e Boas Práticas Estritas

> [!CAUTION]
> **NUNCA submeta chaves privadas, mnemônicos ou segredos nos commits.**
> Commits com credenciais, mesmo que revertidos em seguida, exigem invalidação imediata e rotação de chaves.

- **Variáveis de Ambiente**: Todas as configurações sensíveis devem ser lidas exclusivamente de variáveis de ambiente (`process.env`).
- **Validação de Entradas**: Qualquer endpoint público que receba requisições externas deve validar rigorosamente o schema (Zod ou JSON Schema) antes de qualquer processamento criptográfico.
- **Sanitização de HTML**: Qualquer exibição de e-mail deve passar por isolamento estrito via iframe ou sanitizadores (DOMPurify) para impedir vetores de XSS.

---

## 🌿 3. Fluxo de Trabalho Git (Git Workflow)

1. Crie um fork do repositório no GitHub.
2. Crie uma branch específica para sua funcionalidade ou correção:
   ```bash
   git checkout -b feat/nome-da-feature
   # ou
   git checkout -b fix/descricao-do-bug
   ```
3. Mantenha os commits pequenos, atômicos e claros.
4. Execute os testes antes de abrir o Pull Request:
   ```bash
   # Testes dos contratos na blockchain
   cd contracts && forge test -vvv

   # Testes automatizados do Gateway
   cd gateway && npm test
   ```

---

## 📝 4. Convenção de Commits (Conventional Commits)

Utilizamos o padrão **Conventional Commits** para manter o changelog organizado e legível:

- `feat(gateway)`: Adiciona novo recurso no Gateway (ex: suporte a novo algoritmo de assinatura).
- `fix(contracts)`: Corrige um problema nos contratos inteligentes.
- `docs(protocol)`: Alterações na documentação ou tutoriais.
- `refactor(webmaivw)`: Refatoração de código sem alteração de comportamento externo.
- `test(gateway)`: Adição ou correção de testes automatizados.
- `chore(deps)`: Atualização de dependências ou rotinas de build.

### Exemplo de mensagem de commit:
```
feat(gateway): implement automatic exponential backoff for p2p retry

Implements an exponential backoff mechanism when dispatching P2P
packets to remote nodes with transient connection errors.
```

---

## 📋 5. Checklist para Pull Requests

Antes de submeter seu Pull Request para revisão:

- [ ] Os testes unitários existentes continuam passando com sucesso.
- [ ] Foram adicionados novos testes para cobrir a funcionalidade ou o bug corrigido.
- [ ] O código segue as convenções de tipagem estrita do TypeScript (sem `any` desnecessário).
- [ ] A documentação em `docs/` foi atualizada caso haja mudanças de API, novas rotas ou configurações.
- [ ] Não há `console.log` de depuração ou credenciais hardcoded.
