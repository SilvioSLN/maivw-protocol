---
title: Fluxos e responsabilidades do Gateway
description: Detalhes de descoberta, assinatura, persistência e integrações.
---

A [visão geral](/architecture/overview/) apresenta os componentes. Esta página detalha as decisões do código.

## Descoberta e roteamento

`LedgerService` consulta `REGISTRY_CONTRACT_ADDRESS` usando `RPC_URL`. As configurações `BASE_*` são usadas em caminhos multichain e não são aliases universais das primeiras.

A herança de subdomínios é implementada em `LedgerService.getParentDomain()` e nas consultas recursivas do Gateway. Ela usa uma heurística de sufixos, não uma Public Suffix List completa. Não garante herança automática de todos os dados de reputação local, caixas postais ou permissões. Registre explicitamente subdomínios que precisem de chave e administração próprias.

A `MAIVWRegistryLens` fornece paginação e perfis enriquecidos; não implementa essa resolução hierárquica. Pools e regras de roteamento podem encaminhar tráfego por nós configurados, portanto a topologia não é necessariamente uma conexão exclusiva entre dois servidores finais.

## Mensagens e assinatura

O emissor monta `messageId`, `msgClass`, `to`, `subject`, `content`, `signature` e, quando aplicável, `subIdentityId`. A assinatura cobre apenas a serialização de `content.text` e `content.html`. Veja os bytes lógicos e exemplos na [especificação P2P](/developers/p2p-handshake-spec/).

O corpo e os anexos não são cifrados por uma camada E2EE. AES-256-GCM aparece no cofre de chaves e em credenciais protegidas em repouso, com segredo do servidor. Não deve ser confundido com confidencialidade de mensagens contra o administrador.

## Persistência e aceite

Mensagens são persistidas no PostgreSQL; uploads ficam no diretório de anexos do Gateway. A resposta `202` representa aceite do endpoint. Falhas subsequentes, leitura pelo usuário e retenção não são atestadas por essa resposta.

O parâmetro `recipients` participa da construção da árvore Merkle, mas o envio atual não implementa fan-out completo para cada destinatário. Não o use como garantia de CC/BCC ou entrega em lote.

## Dependências externas

DNS, blockchain, oráculo remoto, SMTP e juiz semântico dependem da configuração. Para produção, a revisão de acesso e os testes de integração indicados no [estado dos recursos](/status/) são pré-requisitos.
