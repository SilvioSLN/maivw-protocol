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

## Matriz interna de achados e mitigações (pré-SM-084)

O repositório mantém uma matriz interna de achados conhecidos e testes de regressão. Ela demonstra que os 17 achados críticos/altos inventariados abaixo possuem mitigação coberta; não equivale a uma auditoria independente e não prova ausência de vulnerabilidades desconhecidas.

| ID | Severidade | Descrição do Achado | Mitigação Implementada | Status |
|---|---|---|---|---|
| **C-01** | Crítica | Saque indevido de stake de usuários pela governança | Invariante `balance >= totalLiabilities()` aplicada antes e após qualquer retirada | ✅ Resolvido |
| **C-02** | Crítica | Replay de provas EIP-712 e reaproveitamento de vouchers | Nonces únicos vinculados a cada domínio, separador de domínio EIP-712 e deadline | ✅ Resolvido |
| **C-03** | Crítica | Reclaim em domínios ativos e apropriação indevida de stake residual | Reclaim restrito a domínios expirados/banidos; resíduo creditado ao antigo admin | ✅ Resolvido |
| **C-04** | Crítica | Reativação indevida de provedor banido ou suspenso | Slashed é permanente; suspensão exige recomposição de 100% do stake do tier | ✅ Resolvido |
| **C-05** | Crítica | Inicialização de Registry com tiers inconsistentes ou nulos | Construtor exige ordenação estritamente crescente de stakes e limites | ✅ Resolvido |
| **C-06** | Crítica | Modificação forjada de parâmetros de domínios alheios | Permissão estrita da `adminKey` do domínio; governança não edita domínios de terceiros | ✅ Resolvido |
| **C-07** | Crítica | Inconsistência de penalidades e solvência em registros genesis | Penalidades debitadas do stake e repassadas à tesouraria sem quebrar solvência | ✅ Resolvido |
| **H-01** | Alta | Overflow no acumulador de strikes (> 255) | Teto saturado e proteção matemática contra overflow de uint8 | ✅ Resolvido |
| **H-02** | Alta | Registro concorrente sobre domínio suspenso | Rejeição fail-closed para qualquer tentativa de re-registro de domínio cadastrado | ✅ Resolvido |
| **H-03** | Alta | Publicação espúria de `IntentBatch` | Apenas oráculo, admin ou hotKey autorizada podem publicar lotes de intenção | ✅ Resolvido |
| **H-04** | Alta | Desativação indevida de registros canônicos locais via mirror | Separação explícita de invariantes entre registros de origem e projeções de mirror | ✅ Resolvido |
| **H-06** | Alta | Ausência de governança em duas etapas e pausa segura | `Ownable2Step` obrigatório; papel `guardian` de emergência para pausa sem saque | ✅ Resolvido |
| **H-07** | Alta | Vetor DoS em slashing por repórteres que revertem | Distribuição de recompensas pull-based via `pendingWithdrawals` | ✅ Resolvido |
| **H-09** | Alta | Inconsistência de stake em registros genesis sem taxa | Domínios genesis registrados sem taxa possuem stake zero auditável | ✅ Resolvido |
| **SOL-01** | Crítica | Fake account substitution em programas Anchor/Solana | Validação estrita de seeds canônicas, bumps, discriminators e owner do programa | ✅ Resolvido |
| **SOL-02** | Crítica | Custódia e solvência de vaults de SPL Token | Segregação estrita entre contas de rent e vaults de caução de staking (split 10/25/65) | ✅ Resolvido |
| **SOL-03** | Alta | Verificação de assinaturas secp256k1 em instruções Solana | Checagem de offsets, precompiles nativos do sysvar e verificação de chave de oráculo | ✅ Resolvido |

**Resultado interno reproduzível:** 0 findings críticos ou altos conhecidos permanecem abertos na matriz; 126 testes Foundry e 66 testes Rust passam. O aceite da SM-084 e o uso em produção continuam condicionados a relatório emitido por auditor independente.
