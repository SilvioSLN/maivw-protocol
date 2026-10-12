---
title: Estado dos recursos e limitações
description: O que está implementado e o que ainda exige desenvolvimento e validação.
---

Esta documentação descreve o código deste repositório. A existência de um recurso no código não significa auditoria independente, disponibilidade de um serviço remoto ou validação para produção.

| Recurso | Estado atual | Limite relevante |
| --- | --- | --- |
| Registro de domínio e governança EVM | Implementado nos contratos | Requer deploy, rede, taxas, oráculo e permissões corretos |
| Envio P2P e fallback SMTP | Implementado | Exige configuração e testes entre nós; SMTP depende de provedor |
| Assinatura EIP-191 | Implementada | Assina somente `text` e `html`, não o envelope completo |
| Cofre de chaves AES-256-GCM | Implementado no Gateway | O servidor consegue decifrar chaves; não cifra mensagens ponta a ponta |
| E2EE / PGP no cliente | Não implementado | Gateway e banco têm acesso ao conteúdo das mensagens |
| Herança de subdomínios | Implementada no Gateway | Resolução por heurística de domínio pai, não por Lens nem lista completa de sufixos públicos |
| Merkle de destinatários | Experimental | Prova local de inclusão não comprova registro de intenção na blockchain |
| Intenção on-chain no fluxo de envio | Integração incompleta | O header de transação do emissor ainda contém valor fictício |
| Rotas privadas / stealth | Implementadas | Token compartilhado não equivale a mTLS |
| mTLS gerenciado pelo protocolo | Não implementado | Exige configuração externa e integração do cliente de saída |
| Autenticação e isolamento entre organizações | Parcial | Não há proteção uniforme em todas as rotas |
| Onboarding DNS / Web3 | Experimental | Sessão administrativa, desafio DNS com expiração e recibo conferido; integração remota/pagamento suspensa, testes integrados pendentes |
| Sandbox e proxy de imagens | Implementados | Não garantem anonimato, ausência de rastreamento ou imunidade a ataques |
| Health de dependências | Implementado | Não comprova entrega, configuração SMTP ou segurança do nó |

## Uso recomendado nesta revisão

Utilize ambiente de desenvolvimento ou piloto controlado. As portas do Compose ficam vinculadas ao loopback do host. Não exponha toda a API por um proxy público: rotas de administração, onboarding e anexos ainda precisam de revisão de autenticação e autorização.

Antes de oferecer serviço em produção, conclua a revisão de acesso por organização, assinatura de envelope, replay, onboarding e anexos; execute testes entre dois nós e restauração de backup.

## Dependências e confiança

O caminho escolhido pode consultar RPC de blockchain, DNS-over-HTTPS do Google, oráculo remoto, relay SMTP e juiz semântico remoto. O login Google usa Firebase quando habilitado. Algumas configurações do frontend ainda têm valores de fallback para serviços MAIVW; verifique-as antes de operar uma instalação independente.

Em disputas, o conteúdo submetido como evidência pode chegar ao oráculo e ao juiz remoto configurado. Self-hosting não elimina automaticamente essas dependências nem impede um administrador do servidor de ler mensagens.
