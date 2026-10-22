---
title: Planejador de implantação e escala
description: Visão interativa das responsabilidades, unidades de deploy e evolução da infraestrutura MAIVW.
---

O planejador transforma o inventário de rotas em uma visão operacional: calcula uma carga indicativa, recomenda a topologia por faixa de clientes e mostra o que deve ficar em VPS, GKE, serverless, object storage ou no serviço global do oráculo.

<a class="sl-link-button primary" href="/architecture-planner/">Abrir o planejador interativo</a>

## O que a visualização responde

- quais serviços podem começar juntos e quais precisam nascer isolados;
- quando uma VPS deixa de ser suficiente e o GKE passa a trazer benefício real;
- quais cargas combinam com serverless e quais exigem processos contínuos;
- como separar PostgreSQL, Redis, anexos e material criptográfico;
- como uma instalação open source mantém os dados locais enquanto consome apenas o oráculo central;
- quais métricas, além da contagem de clientes, determinam a próxima etapa.

As estimativas são parâmetros de planejamento e não constituem benchmark ou promessa de SLO. Antes de provisionar produção, substitua as premissas pelos volumes, retenção e picos medidos no piloto.
