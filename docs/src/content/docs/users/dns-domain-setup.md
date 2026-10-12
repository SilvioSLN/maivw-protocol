---
title: Configuração de Domínio & Prova DNS TXT
description: Como comprovar a posse soberana do seu domínio e registrá-lo no Cartório On-Chain através de um registro DNS TXT.
---

No protocolo MAIVW, você nunca precisa "comprar" ou alugar um domínio dentro de uma plataforma Web3 proprietária. **O seu domínio de internet existente (ex: `.com.br`, `.com`, `.org`) é a âncora final da sua identidade soberana**.

Para conectar seu domínio ao ecossistema MAIVW, você precisa demonstrar criptograficamente a sua titularidade por meio de um mecanismo chamado **Proof of Ownership (PoO)**.

---

## 🧭 Como Funciona a Vinculação?

```
┌────────────────────────────────────────────────────────┐
│ 1. VOCÊ CONFIGURA O DNS PÚBLICO                       │
│    Adiciona uma entrada TXT no seu provedor            │
│    (Cloudflare, Registro.br, GoDaddy, Route53, etc.)   │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. O ORÁCULO MAIVW VALIDA O REGISTRO DNS              │
│    Consulta os servidores oficiais da ICANN/DNS e      │
│    assina um laudo criptográfico (Voucher ECDSA)       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. ANCORAGEM ON-CHAIN NO CARTÓRIO (Base L2)            │
│    Seu nó submete o laudo ao contrato na blockchain,   │
│    gravando seu Endpoint e Chave Pública oficial       │
└────────────────────────────────────────────────────────┘
```

Esse processo garante que **nenhuma outra pessoa possa registrar o seu domínio na blockchain**, evitando completamente ataques de sequestro de identidade (*domain squatting*).

---

## 🛠️ Passo 1: Obter as Informações no WebMaivw

1. Acesse o painel do seu nó local:
   👉 **[http://localhost:3002/onboarding](http://localhost:3002/onboarding)**
2. Digite o domínio que você deseja conectar (exemplo: `minhaempresa.com.br`).
3. O sistema gerará o token de verificação criptográfico único do domínio e exibirá os dados que você deve cadastrar no seu provedor DNS:
   - **Nome do Registro:** `_maivw-verify` (ou `_maivw-verify.minhaempresa.com.br`)
   - **Tipo:** `TXT`
   - **Valor:** `maivw-verification=a50c83f25438b8192a014e7dc2095f32` *(token exclusivo gerado pelo seu nó)*

> [!TIP]
> Esse registro funciona como a **Prova de Posse Obrigatória (PoO)**. O oráculo do MAIVW valida que apenas o detentor real da zona DNS tem autoridade para registrar ou vincular chaves àquele domínio.

---

## 🌐 Passo 2: Cadastrar o Registro TXT no seu Provedor DNS

Acesse a zona de controle DNS de onde você gerencia o domínio:

### 1. Cloudflare
1. Abra o painel do domínio na **Cloudflare** e vá em **DNS** > **Records**.
2. Clique em **Add record**.
3. Selecione o Tipo: `TXT`.
4. Em **Name**, digite: `_maivw-verify`.
5. Em **Content**, cole o valor retornado: `maivw-verification=a50c83f25438b8192a014e7dc2095f32`.
6. Deixe o **TTL** em `Auto` e clique em **Save**.

### 2. Registro.br
1. Acesse sua conta no **Registro.br** e abra o domínio.
2. Na seção **DNS**, clique em **Editar Zona**.
3. Clique em **+ Nova Entrada**.
4. No primeiro campo (Nome), preencha: `_maivw-verify`.
5. Escolha o tipo: `TXT`.
6. No campo de dados (Texto), cole o valor entre aspas: `"maivw-verification=a50c83f25438b8192a014e7dc2095f32"`.
7. Clique em **Salvar**.

### 3. AWS Route 53
1. Acesse o **Route 53** > **Hosted zones** e selecione sua zona.
2. Clique em **Create record**.
3. Em **Record name**, insira `_maivw-verify`.
4. Em **Record type**, selecione `TXT`.
5. Em **Value**, cole a string com aspas duplas: `"maivw-verification=a50c83f25438b8192a014e7dc2095f32"`.
6. Clique em **Create records**.

---

## 🔍 Passo 3: Testar a Propagação do DNS

Antes de submeter a validação, confira no seu terminal se a entrada TXT já se propagou publicamente pelo comando `dig`:

```bash
dig +short TXT _maivw-verify.minhaempresa.com.br
```

Você deverá ver como resposta a sua string de verificação:
```text
"maivw-verification=a50c83f25438b8192a014e7dc2095f32"
```

---

## 🏛️ Passo 4: Concluir a Validação e Registro On-Chain

Volte à tela do **WebMaivw** (`/onboarding`) e clique no botão **"Verificar DNS e Registrar no Cartório"**:

1. O Gateway entrará em contato com o **Oráculo MAIVW**, que fará uma consulta autoritativa no DNS mundial para ler `_maivw-verify`.
2. Uma vez confirmado o token, o Oráculo emite um atestado criptográfico (`oracleProof`).
3. O Gateway despacha a transação para o contrato na blockchain na rede **Base**.
4. Assim que a transação for minerada (geralmente menos de 2 segundos na Base L2), seu domínio estará oficialmente **ATIVO** na rede mundial MAIVW!

---

## 🔄 Passo 5: Herança Automática vs. Subdomínios Autônomos

> [!NOTE]
> **Você só precisa registrar o domínio principal uma vez para toda a organização.**

O MAIVW possui suporte nativo à **Herança Hierárquica de Subdomínios**:
- **Herança Automática:** Se você registrou `minhaempresa.com.br`, subdomínios como `suporte.minhaempresa.com.br` ou `financeiro.minhaempresa.com.br` herdam a chave pública, o endpoint e a reputação automaticamente sem que você precise pagar gas novamente na blockchain.
- **Subdomínios Autônomos com Chave e Reputação Própria:** Caso um departamento específico precise de um endpoint diferente ou de uma chave exclusiva (por exemplo, `diretoria.minhaempresa.com.br`), **basta registrar o subdomínio completo diretamente no painel e pagar as taxas de registro**. Ele passará pelo mesmo processo de validação, ganhando um painel exclusivo, par de chaves próprio e pontuação de reputação individual no protocolo.
