---
title: Oráculo, DNS e disputas
description: Papel do assinante autorizado, dependências DNS e julgamento semântico.
---

O Registry confia no oráculo autorizado pela governança do contrato. Ter vários nós consultando esse oráculo não equivale a consenso descentralizado de vários oráculos.

## Registro DNS

O onboarding gera um desafio TXT em `_maivw-verify.<dominio>`, com valor `maivw-verification=<token>`. O Gateway verifica DNS e solicita uma prova EIP-712. Dependendo de sua autoridade e rede, emite a prova localmente ou consulta `MAIVW_ORACLE_URL`.

As rotas de registro usam consulta ao DNS-over-HTTPS do Google; outras etapas também usam resolução DNS do sistema. Não descrevemos esse processo como consulta direta à ICANN, aos TLDs ou como redundância garantida.

O contrato valida os campos definidos na prova, incluindo nonce/deadline conforme o tipo de operação. Não presuma que cada campo HTTP, como endpoint, esteja assinado sem conferir o tipo EIP-712 correspondente.

Há caminhos de simulação DNS e de finalização Web3 que ainda precisam de endurecimento. Mantenha o onboarding em ambiente restrito até concluir a revisão descrita em [estado dos recursos](/status/).

## Arbitragem

`POST /api/v1/dispute` e seu alias `/api/v1/report-spam` recebem `senderDomain`, `payload`, `reporterAddress` e opcionalmente `subIdentityId`. O payload deve preservar o conteúdo e assinatura originais.

O juiz pode ser heurístico local ou remoto, configurado por `ORACLE_AI_JUDGE_URL` e `ORACLE_AI_JUDGE_TOKEN`. Ao habilitar o juiz remoto, avalie a transferência do conteúdo da denúncia para esse serviço. Uma classificação heurística ou de IA pode errar.

Penalidades dependem do resultado, do tipo de domínio, das permissões do oráculo e do estado/configuração do contrato. O Registry inclui advertências, suspensão, slashing e timelocks; não se deve prometer bloqueio instantâneo em todos os nós nem tratar cada denúncia como condenação automática.

Consulte [contratos e governança](/contracts/registry/) para as fronteiras de autorização e recuperação.
