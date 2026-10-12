---
title: Operação, backup e recuperação
description: Procedimentos para piloto, restauração isolada e atualização controlada.
---

Antes de operar com dados importantes, conclua os testes de restauração e as pendências de [segurança](/status/).

## Rede e HTTPS

O Compose mantém as portas no loopback. Use túnel SSH ou rede privada para acessar administração e Webmail. Para P2P público, configure certificado válido no proxy e exponha apenas as rotas necessárias à federação após a revisão de segurança. Não encaminhe indiscriminadamente toda a API administrativa para a internet.

Aponte A/AAAA do hostname do Gateway ao servidor e configure o proxy para encaminhar ao serviço correto. Um proxy instalado no host acessa `127.0.0.1:51443`; um proxy em outro container deve usar a rede Docker e `gateway:3001`. HTTPS no proxy não implementa mTLS no cliente emissor.

Defina `DEFAULT_P2P_ENDPOINT` e atualize o endpoint registrado no contrato quando mudar de host. Verifique URL, DNS, cadeia de certificados, roteamento e aceite real de uma mensagem. Não use `HEAD /api/v1/inbox` como prova de que um POST funcionará.

## Backup consistente do piloto

O backup precisa conter PostgreSQL, anexos e metadados, `.env` e estado Redis quando sua continuidade for necessária. Proteja a cópia: `.env` pode permitir decifrar as chaves armazenadas no banco. Credenciais externas de KMS/Firebase e permissões IAM também precisam de um plano de recuperação separado.

Exemplo Linux, executado na raiz do repositório, com interrupção planejada do piloto. Não o execute durante tráfego que precise ser aceito continuamente:

```bash
umask 077
BACKUP_DIR="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
docker compose stop webmaivw dashboard gateway
# Qualquer falha abaixo deve ser resolvida antes de considerar o backup válido.
docker compose exec -T postgres pg_dump -U postgres -d maivw_reputation > "$BACKUP_DIR/database.sql"
cp .env "$BACKUP_DIR/config.env"
docker compose stop redis
# Diretórios do bind mount podem exigir privilégios de leitura no host.
sudo tar -C data -czf "$BACKUP_DIR/files.tgz" attachments redis
docker compose start redis gateway webmaivw dashboard
```

Verifique códigos de saída, conteúdo dos arquivos e espaço disponível. Gere checksums e copie o backup para armazenamento protegido fora do servidor. Se o dump ou o arquivo falhar, não marque o backup como concluído; retome os serviços conforme o estado real.

## Ensaio de restauração

Use **outro diretório/host**, banco vazio e portas sem conflito; não aponte o ensaio para o volume original.

1. Use a mesma revisão do código e versões de banco do backup.
2. Copie `config.env` para `.env`, preserve `MASTER_SECRET_KEY` e adapte apenas hosts/portas necessários.
3. Com os serviços parados, extraia `files.tgz` no diretório `data/` desse ambiente, preservando permissões.
4. Inicie somente PostgreSQL. Restaure **antes** de iniciar o Gateway, evitando conflito com `prisma db push`:

```bash
docker compose up -d postgres
# Aguarde postgres ficar healthy e use o caminho do backup selecionado.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d maivw_reputation < /caminho/do/backup/database.sql
```

5. Inicie Redis e Gateway; confira saúde, contas, mensagens e decifragem das credenciais.
6. Compare quantidade e SHA-256 de anexos restaurados com o backup e faça download de uma amostra.
7. Evite que o clone publique transações, envie mensagens reais ou dispute a mesma identidade do nó original. Reative tráfego somente no nó escolhido para assumir operação.

A existência deste procedimento não significa que seu backup foi testado. Registre data, revisão, resultados e tempo de recuperação.

## Atualização e rollback

Faça backup consistente, registre revisão e imagens anteriores e teste o novo schema numa cópia. Depois reconstrua os serviços e valide saúde e fluxos. Voltar apenas a imagem antiga pode não funcionar após alteração de schema; um rollback pode exigir restauração do banco e anexos compatíveis, com perda dos dados posteriores ao backup.

## Rotação de segredos

- JWT: trocar o segredo invalida sessões; avise usuários e gere novos logins.
- Chave interna e webhook: coordene emissor e receptor; invalide a anterior.
- Chave do domínio: prepare novo assinante e atualização on-chain autorizada, com plano de transição entre nós.
- `MASTER_SECRET_KEY`: **não substitua simplesmente o valor**. Chaves e credenciais existentes exigem migração de recifragem; essa ferramenta ainda não existe no projeto.
- KMS: confirme versão, permissões e endereço autorizado antes de trocar o assinante.
