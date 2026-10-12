---
title: Contas, domínio e onboarding
description: Contratos de entrada e sequência de cadastro no piloto.
---

Estas rotas estão inventariadas em [rotas do Gateway](/api/routes/). O fluxo atual não tem autorização uniforme; use piloto restrito e não interprete um ID numérico como prova de propriedade.

## Cadastro e sessão

`POST /api/v1/auth/register` recebe `email`, `password` (12 a 128 caracteres), `registrationToken` e `displayName` opcional. Retorna `201` com `id`, `email`, `role`, `displayName`, `token` e `message`; e-mail duplicado retorna `409`.

`POST /api/v1/auth/login` recebe `email` e `password`. Use o token retornado no cabeçalho Bearer. `GET /api/v1/auth/me` lê a sessão autenticada. `POST /api/v1/auth/google` exige `idToken` Firebase válido, não revogado, com e-mail verificado e provedor Google ou GitHub. E-mail/nome enviados pelo cliente não comprovam identidade. Novos administradores também precisam de `registrationToken`; contas existentes não precisam de convite. Configure seu próprio projeto Firebase.

```bash
curl -sS http://localhost:51443/api/v1/auth/login   -H 'Content-Type: application/json'   -d '{"email":"admin@example.com","password":"SENHA_DO_PILOTO"}'
```

O cadastro administrativo fica fechado quando `ADMIN_REGISTRATION_TOKEN` não está configurado. O operador gera um segredo de pelo menos 32 caracteres (por exemplo, `openssl rand -hex 32`), configura o Gateway, entrega o convite por canal privado e remove a variável após o cadastro, reiniciando o serviço. O convite é reutilizável enquanto configurado.

Senhas novas usam scrypt com salt aleatório (N=32768, r=8, p=3). Hashes SHA-256 antigos são migrados após login correto; senhas antigas menores que 12 caracteres continuam aceitas no login. JWT não significa autorização automática em todas as rotas. Limitação de tentativas e isolamento completo das rotas permanecem pendentes.

## Onboarding

| Etapa | Rota POST | Entrada principal |
| --- | --- | --- |
| Desafio | `/api/v1/onboarding/challenge` | `domainName`, `userId` opcional |
| DNS | `/api/v1/onboarding/check-dns` | `domainName`, `token` |
| Registro por relayer | `/api/v1/onboarding/verify-and-register` | `domainName`, `userId`, `token`, `endpointUrl`, `targetChainId` |
| Prova para carteira | `/api/v1/onboarding/claim-proof` | Mesmos dados e `callerAddress`; `publicKey` opcional |
| Finalização Web3 | `/api/v1/onboarding/finalize-web3-registration` | `domainId`, `txHash`, `endpointUrl`, `targetChainId` |
| Caixa inicial | `/api/v1/onboarding/complete` | `domainId`, `localPart`, `password`, `displayName` opcional, `purpose` |

A etapa `/complete` exige JWT administrativo e domínio verificado pertencente ao administrador. Não redefine senhas de usuários existentes. As etapas anteriores ainda precisam do endurecimento descrito abaixo.

Todas as etapas POST acima exigem JWT de administrador existente. `userId`, quando enviado, deve corresponder à sessão. O desafio é vinculado ao domínio e usuário e expira em 30 minutos. Renove o desafio e atualize o TXT após expirar. `simulate` e `simulateDns` com valor `true` são rejeitados.

`GET /api/v1/onboarding/node-mode` informa modo e `chainId` do nó. O onboarding aceita somente a rede configurada em `CHAIN_ID`; omitir `targetChainId` usa essa rede. A emissão de prova exige que o nó seja a autoridade do Registry. A delegação antiga ao oráculo remoto foi suspensa até existir autenticação entre serviços. `purpose` aceita `webmail`, `api` ou `both`.

Emitir prova não ativa o domínio: o registro local começa com `isVerified=false`. A ativação verifica rede RPC, recibo com sucesso, endereço do Registry, evento `CompanyRegistered` para domínio/chave e chave/endpoint atuais no contrato. Não aceita chaves diferentes do cofre local. A verificação usa uma confirmação; política de finalização e reorganizações ainda exige validação integrada.

Se o relayer transmitir a transação mas não confirmar em 15 segundos, retorna `409` com `txHash` e `domainId`. Consulte novamente por `/finalize-web3-registration` com o mesmo endpoint; não transmita outra transação sem conferir a anterior.

`POST /api/v1/onboarding/fulfill-registration` retorna `503`: provisionamento por pagamento suspenso até vincular pedido autenticado, titularidade DNS e confirmação on-chain. PIX, cartão e voucher não estão disponíveis no onboarding atual.

## Domínios, caixas e API keys

`GET /api/v1/domains` exige administrador e lista seus domínios. O legado `POST /api/v1/domains` retorna `410` e não provisiona carteira nem API key; use o onboarding autenticado.

`POST /api/v1/auth/accounts` recebe `localPart`, `password`, `displayName` e `domainId` opcional. Listagem e exclusão ficam em `GET /api/v1/auth/accounts` e `DELETE /api/v1/auth/accounts/:id`; os handlers incluem verificação administrativa.

Para gerar API key, envie JWT administrativo:

```bash
curl -sS http://localhost:51443/api/v1/api-keys   -H "Authorization: Bearer $MAIVW_ADMIN_TOKEN"   -H 'Content-Type: application/json'   -d '{"domainId":1,"name":"Integracao piloto","environment":"staging"}'
```

Substitua `domainId` pelo domínio pertencente à conta. O retorno `201` inclui `apiKey`, exibida uma vez. `environment` aceita `production` ou `staging`; isso seleciona o prefixo, não cria ambientes isolados. Liste metadados com `GET /api/v1/api-keys` e revogue com `DELETE /api/v1/api-keys/:id`.
