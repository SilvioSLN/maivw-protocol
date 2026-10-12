---
title: Guia do Webmail
description: Contas administrativas, caixas postais e uso do cliente no piloto.
---

Acesse o Webmail do Compose local em `http://localhost:52443`, após o Gateway ficar saudável. Leia as [limitações atuais](/status/) antes de usar dados reais.

## Contas

A conta administrativa criada em `/signup` gerencia domínios, caixas e integrações. A caixa postal de colaborador usa seu próprio login e acessa `/inbox`. O papel exibido na interface não comprova isolamento uniforme no backend; a revisão de autorização permanece pendente.

## Envio e leitura

Componha uma mensagem, preencha destinatário, assunto e conteúdo e selecione a classe adequada:

| Classe | Uso |
| --- | --- |
| `TX_CODE` | Códigos e autenticação |
| `TX_RECEIPT` | Recibos e comprovantes |
| `SUPPORT` | Atendimento |
| `CONVERSATION` | Conversa direta |
| `MARKETING` | Campanhas |
| `COLD_OUTREACH` | Prospecção |

O Gateway escolhe P2P ou caminho SMTP conforme resolução e configuração. Uma classe não garante prioridade, ausência de spam ou segurança do conteúdo. Aceite de envio não significa leitura pelo destinatário.

Anexos usam upload JSON/Base64 e armazenamento no Gateway. Há diferença entre o limite do handler e o limite HTTP; consulte [API](/api/gateway/) antes de depender de arquivos grandes.

O cliente possui composição HTML, resposta e encaminhamento. Eles não preservam automaticamente uma cadeia verificável de assinaturas dos autores anteriores. Revise remetentes e conteúdo antes de encaminhar.

## Proteções e limites

O visualizador usa sanitização e iframe isolado; imagens externas podem passar pelo proxy do nó. URLs de rastreamento ainda podem permitir correlação. O servidor tem acesso ao conteúdo e às chaves operacionais: não há E2EE no cliente.

Configuração SMTP fica em `/settings`; chaves de integração e seus registros ficam na área de desenvolvedor. Não compartilhe token administrativo ou API key por mensagem.
