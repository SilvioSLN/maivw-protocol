---
title: Domínio e DNS
description: Desafio TXT, endpoint P2P e distinção de DNS para e-mail legado.
---

O TXT é uma etapa do registro de identidade. Ele não cria um servidor de e-mail nem torna um Gateway acessível automaticamente.

## Antes de começar

Prepare nó e contrato na mesma rede e cadastre a conta administrativa. Nesta versão, a emissão de prova funciona no nó configurado como autoridade do Registry; o fluxo remoto está suspenso. Defina uma URL concreta em `DEFAULT_P2P_ENDPOINT`. O onboarding também aceita endpoint explícito; confirme o endereço que será enviado à transação.

## Publicar o desafio

1. Abra `/onboarding` no Webmail e informe o domínio.
2. Copie o valor retornado pelo desafio. Ele vale por 30 minutos e é vinculado ao seu usuário e domínio; se expirar, gere outro e atualize o TXT.
3. No provedor DNS, crie:

| Campo | Valor |
| --- | --- |
| Tipo | `TXT` |
| Nome | `_maivw-verify` na zona do domínio |
| Conteúdo | `maivw-verification=TOKEN` (redes EVM) ou `maivw-origin-v1=ID.TOKEN` (origem Solana) |
| TTL | Conforme sua política de DNS |

Cloudflare, Registro.br e Route 53 usam interfaces diferentes. Confira se o painel adiciona automaticamente o sufixo do domínio; evite criar `_maivw-verify.example.com.example.com`. Use a representação de aspas exigida pelo seu provedor, preservando o conteúdo do TXT.

```bash
dig +short TXT _maivw-verify.example.com
```

Volte ao onboarding e solicite verificação real. O registro pode seguir o caminho de relayer ou carteira Web3; confirme rede, taxa e transação. Simulação DNS é rejeitada. O domínio só é ativado após conferir recibo, contrato, domínio, chave e endpoint. PIX/cartão/voucher e delegação remota estão suspensos; veja [contrato de onboarding](/api/accounts/).

## Endpoint P2P

Configure A/AAAA do hostname do Gateway, proxy e certificado HTTPS. O TXT de posse e o registro on-chain não configuram esses elementos. Uma URL em rede privada só funciona se o emissor tiver conectividade e configuração compatíveis.

## SMTP e coexistência

MX, SPF, DKIM e DMARC pertencem ao caminho legado. Siga a configuração do provedor realmente contratado. Não substitua os registros existentes por sugestões genéricas do onboarding sem validar o serviço de entrada. O Compose não fornece MTA escutando na porta 25.

Subdomínios podem usar a resolução de domínio pai do Gateway; isso não cria caixas automaticamente nem garante herança de toda a reputação. Registre explicitamente um subdomínio que precise de identidade independente.
