---
title: Diagnóstico de instalação e entrega
description: Verifique configuração, dependências, DNS, transporte e persistência.
---

## Gateway não inicia

Veja `docker compose logs --tail=100 contracts-deployer gateway`. No modo local, confirme primeiro se o deployer terminou com código zero. Em Testnet, confirme os quatro segredos, Registry, `ORACLE_SIGNER_TYPE` e a chave exigida.

O Compose local não precisa de `.env`. O Compose de Testnet exige `--env-file .env.testnet`. Para desenvolvimento fora do Docker, `npm run dev` carrega o `.env` da raiz quando ele existe.

## Gateway degradado

```bash
docker compose ps
curl -i http://localhost:51443/health
curl -i http://localhost:51443/health/live
```

`503` em `/health` informa falha ou timeout em PostgreSQL, Redis ou consulta ao Registry. Verifique rede, credenciais, RPC, chain ID e endereço do proxy. `200` em `/health/live` confirma somente o processo HTTP. Saldo desconhecido do oráculo aparece como `null`, não como zero confirmado.

## Envio P2P falha

Confirme que `DEFAULT_P2P_ENDPOINT` e o endpoint on-chain correspondem ao receptor. Não existe variável `PUBLIC_ENDPOINT_URL` no Gateway. Verifique DNS, certificado, rota privada/pool, domínio ativo e chave assinadora registrada. A chave aleatória de fallback do Gateway não substitui a carteira de um domínio registrado.

Uma URL configurada não comprova acesso externo. Teste uma mensagem de outro nó controlado; uma resposta HEAD não valida esse fluxo.

## DNS não confirma

```bash
dig +short TXT _maivw-verify.example.com
```

Compare o valor integral com o token do onboarding. Evite duplicar o domínio no nome do registro. O tempo de propagação depende do TTL e do provedor; não há prazo garantido. Não use simulação DNS para ativar domínios reais.

Na demonstração local, `node-mode` informa `dnsMode: local-demo` e o check retorna `localBypass: true`; nenhuma consulta DNS é feita. Se isso ocorrer em uma Testnet, revise imediatamente `CHAIN_ID` e `RPC_URL`.

## Contrato rejeita transação

Confira rede, proxy, assinante autorizado, nonce/deadline, taxa exigida e saldo para taxa mais gas. Endereços e preços de outra rede não são intercambiáveis. As mensagens de erro do RPC ajudam a distinguir falta de saldo e pré-condições do contrato.

## Frontend aponta para servidor errado

`NEXT_PUBLIC_*` é incorporado no build. Atualize a configuração e reconstrua o frontend. Se alterar a porta externa do Gateway, atualize também sua URL pública. Dentro do navegador, `localhost` não aponta para um servidor remoto.

## Anexos e recuperação

Confira o bind mount `./data/attachments`. Arquivos de instalações antigas que ficaram apenas dentro do container precisam ser copiados antes de recriá-lo. Consulte [backup e restauração](/self-hosting/operations/).
