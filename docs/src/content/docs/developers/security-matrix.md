---
title: Garantias e limites de segurança
description: Proteções presentes no código e limitações que precisam ser consideradas.
---

Esta matriz descreve mecanismos existentes, sem equivaler a uma auditoria independente.

| Camada | Mecanismo atual | O que não garante |
| --- | --- | --- |
| Autoria do conteúdo | EIP-191 verificado contra endereço registrado | Identidade da pessoa física, integridade de todos os campos ou proteção contra replay |
| Transporte | HTTP no Gateway; HTTPS configurável no proxy | TLS 1.3 forçado em todos os caminhos ou mTLS automático |
| Chaves em repouso | Cofre AES-256-GCM com segredo do nó | Proteção contra operador que possua banco e segredo |
| Conteúdo da mensagem | JSON e persistência no servidor | E2EE, PGP ou decifragem exclusiva no dispositivo final |
| HTML no cliente | Sanitização e iframe com sandbox | Imunidade a falhas de navegador, links maliciosos ou engenharia social |
| Imagens externas | Proxy do Webmail | Ausência de rastreamento por URL individual ou horário de requisição |
| Identidade de domínio | Registro EVM e atestação de oráculo | Segurança absoluta do DNS, oráculo, carteira e governança |
| Administração | Verificações em parte das rotas | Isolamento uniforme entre organizações |

## Assinatura não é criptografia

A implementação assina `JSON.stringify({ text: content.text, html: content.html || "" })`. Destinatário, assunto, classe, ID e anexos não estão cobertos. Uma futura ampliação precisa versionar o protocolo e prever migração entre nós; alterar apenas o exemplo documental não resolve a lacuna.

## HTTPS, rotas privadas e mTLS

O Compose escuta no loopback do host. TLS público depende de um proxy configurado pelo operador. Rotas stealth usam configuração bilateral e token compartilhado; isso não prova posse de certificado X.509. Uma implantação mTLS exige configurar tanto o proxy receptor quanto o cliente HTTP emissor e testar a integração.

## Privacidade do proxy de imagens

O proxy substitui a origem da requisição HTTP pela do servidor. URLs exclusivas ainda podem permitir correlação e o provedor da imagem observa quando recebe uma requisição. O servidor proxy também conhece a URL. A política contra SSRF, redirecionamentos e resolução DNS precisa de revisão adicional.

## Antes de exposição pública

As limitações de autenticação, onboarding, assinatura e anexos estão listadas em [estado dos recursos](/status/). A separação visual entre administrador e colaborador não substitui autorização no backend. Até concluir essa revisão, mantenha o piloto em rede restrita.

O modelo específico dos contratos está em `contracts/SECURITY.md`; sua existência não certifica a segurança do Gateway ou do Webmail.
