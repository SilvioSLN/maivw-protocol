---
title: Handshake & Roteamento P2P
description: Como nós MAIVW se descobrem, validam identidades e trocam mensagens de forma direta e segura.
---

O roteamento no protocolo MAIVW é direto e sem servidores centrais de retransmissão obrigatórios. Quando o usuário `alice@acme.maivw` deseja enviar uma mensagem para `bob@stellar.maivw`, o processo segue 4 fases:

```
[ Alice (Nó Acme) ]                                [ Bob (Nó Stellar) ]
        |                                                   |
        |--- 1. Consulta Contrato na Blockchain ----------->|
        |<-- Retorna Endpoint: https://gateway.stellar.org -|
        |<-- Retorna Chave Pública de Criptografia ---------|
        |                                                   |
        |--- 2. Envio Direto HTTPS Cifrado + Assinatura --->|
        |       POST /api/v1/inbox autenticado via ECDSA    |
        |                                                   |
        |<-- 3. Validação de Assinatura & Aceite (202) -----|
```

## Fase 1: Descoberta de Endpoint e Chave Pública

O Gateway remetente consulta o contrato na blockchain (ou seu cache local validado) buscando os registros do domínio de destino (`stellar.maivw`):
- **Endpoint HTTPS/P2P**: URL pública do gateway do destinatário (ex: `https://mail.stellar.org/api/v1/inbox`).
- **Chave Pública do Domínio**: Chave ECDSA registrada on-chain para verificação de autoria.
- **Chave do Destinatário**: Chave pública para encapsulamento de sessão AES-256-GCM.

## Fase 2: Cifragem e Montagem do Envelope

O cliente ou gateway de Alice monta o payload:
1. O corpo da mensagem e anexos podem ser cifrados utilizando AES-256-GCM com uma chave simétrica temporária.
2. A chave simétrica é encapsulada para a chave pública do destinatário.
3. O payload é assinado digitalmente com a chave privada de Alice (`secp256k1` / EIP-191).

## Fase 3: Transmissão P2P Direta

Alice estabelece conexão TLS segura diretamente com o endpoint descoberto do gateway de Bob:
- O envelope é transmitido via requisição HTTP autenticada (`POST /api/v1/inbox`).
- O gateway de Bob valida:
  - A assinatura do envelope bate com o registro on-chain do domínio remetente?
  - A reputação do remetente atende aos critérios mínimos de spam e a categoria (`msgClass`) não está bloqueada?
  - Se aprovado, a mensagem é armazenada na caixa postal de Bob.

## Fase 4: Confirmação de Recebimento

O gateway de Bob emite uma resposta HTTP `202 Accepted` comprovando a validação e o aceite do pacote, garantindo prova técnica de entrega.
