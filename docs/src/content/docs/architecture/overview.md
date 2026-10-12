---
title: Filosofia & Arquitetura
description: Como o protocolo MAIVW redefine a comunicação corporativa e assíncrona com descentralização e criptografia.
---

O e-mail tradicional (baseado em SMTP concebido na década de 1980) sofre de problemas crônicos estruturais:
- **Centralização oligopólica**: Mais de 70% das caixas de entrada globais estão concentradas em apenas dois provedores (Google e Microsoft), que impõem regras arbitrárias de filtragem e posse de dados.
- **Insegurança inerente**: E-mails trafegam em texto puro por padrão entre servidores intermediários, salvo quando encapsulados por TLS de salto a salto.
- **Spoofing e Phishing crônicos**: Mecanismos como SPF, DKIM e DMARC foram adicionados como remendos e continuam sujeitos a falhas e sequestro de DNS.

O **MAIVW Protocol** foi desenhado do zero para solucionar esses problemas combinando arquitetura Peer-to-Peer, criptografia ponta a ponta e verificação on-chain.

## Princípios de Design

### 1. Soberania Absoluta (Self-Sovereign)
Sua organização ou nó pessoal é dono total do banco de dados, das chaves de criptografia e da infraestrutura de roteamento. Nenhum terceiro pode revogar seu acesso, censurar suas mensagens ou analisar seus dados para anúncios.

### 2. Criptografia Ponta a Ponta por Padrão
Toda mensagem originada na rede MAIVW é:
1. Assinada pela chave privada ECDSA do remetente (garantia matemática de autoria e não-repúdio).
2. Criptografada com a chave pública PGP/ECC do destinatário antes de sair da máquina de envio.
3. Decodificada exclusivamente no dispositivo do destinatário final.

Servidores e nós intermediários visualizam apenas envelopes de roteamento opacos com metadados mínimos necessários para entrega.

### 3. Reputação Descentralizada On-Chain (Base L2)
Em vez de depender de listas de reputação centralizadas e opacas (como Spamhaus ou filtros proprietários de Big Techs), o MAIVW utiliza contratos na blockchain na rede Base:
- Nós registram seus identificadores, chaves e endpoints públicos no cartório on-chain.
- Histórico auditável e prova matemática de posse garantem proteção anti-spam sem violar a privacidade do conteúdo.

### 4. Interoperabilidade Híbrida
A rede não exige que o mundo inteiro migre para o MAIVW de um dia para o outro. Através do **Gateway Híbrido**:
- Se o destinatário estiver na rede MAIVW: o envio é 100% P2P direto, ultra-rápido e com criptografia E2E.
- Se o destinatário for um e-mail tradicional (`@gmail.com`, `@outlook.com`): o Gateway encaminha via SMTP seguro de saída, mantendo total compatibilidade retroativa.
