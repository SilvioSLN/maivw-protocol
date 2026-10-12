---
title: Arquitetura do Protocolo Aberto
description: Especificação técnica detalhada dos pilares de design, ciclo de vida da mensagem e desacoplamento de identidade no MAIVW Protocol.
---

O **MAIVW Protocol** é um protocolo aberto de mensageria assíncrona corporativa fundamentado em três princípios criptográficos: **Desacoplamento de Identidade**, **Roteamento Híbrido P2P** e **Ancoragem On-Chain**.

Ele elimina a necessidade de servidores centrais de controle (como Google Workspace ou Microsoft Exchange), sem forçar a quebra de compatibilidade com o ecossistema legada de e-mails da internet (SMTP).

---

## 🏛️ 1. Desacoplamento: Identidade Criptográfica vs. Localização Física

No modelo clássico de e-mail (RFC 5321/SMTP), a identidade de um domínio está atrelada ao seu apontamento DNS MX. Se o DNS for sequestrado via *DNS Poisoning* ou se o provedor do servidor bloquear a conta, a identidade corporativa é perdida.

No MAIVW, **a identidade é puramente criptográfica e imutável on-chain**:

```
┌────────────────────────────────────────────────────────┐
│  IDENTIDADE CRIPTOGRÁFICA (Base L2 - Imutável)         │
│  • Nome do Domínio: empresa.com.br                     │
│  • Chave Pública ECDSA: 0x7639...cB4F (secp256k1)      │
│  • Status On-Chain: ACTIVE                             │
│  • Chave Administrativa (Cold Key): Multisig / HW      │
└───────────────────────────┬────────────────────────────┘
                            │ Aponta dinamicamente para
                            ▼
┌────────────────────────────────────────────────────────┐
│  LOCALIZAÇÃO FÍSICA NA REDE (Mutável a qualquer hora)  │
│  • Endpoint HTTPS: https://gateway.empresa.com.br/api/v1/inbox│
│  • Nível de Segurança: Nível 1 (Clear) / Nível 2 (mTLS)│
│  • Provedor de Nuvem: AWS, Hetzner, Bare-Metal, etc.   │
└────────────────────────────────────────────────────────┘
```

Se a empresa decidir trocar de provedor de nuvem, basta seu nó emitir uma transação `updateEndpoint()` assinada por sua chave administrativa. **Nenhuma chave pública muda, nenhuma reputação é perdida e nenhum terceiro pode intervir**.

---

## 🌐 2. Resolução Wildcard e Herança de Subdomínios

Para evitar que corporações precisem pagar taxas de registro ou registrar centenas de transações para cada departamento ou filial, o protocolo implementa a **Herança Hierárquica de Resolução**:

1. Ao consultar um destinatário `alerta@notificacoes.banco.com.br`:
2. O Gateway consulta o contrato na blockchain (via camada Lens otimizada).
3. Se não houver registro específico para `notificacoes.banco.com.br`, o contrato resolve automaticamente para a raiz canônica `banco.com.br`.
4. Todos os subdomínios herdam a chave pública, o endpoint e o status de reputação da raiz automaticamente sem custo de gas.
5. Se uma filial ou departamento exigir um servidor autônomo com endpoint ou chave exclusiva (ex: `diretoria.banco.com.br`), basta registrar o subdomínio completo on-chain, pagar as taxas e ele terá um painel exclusivo, com chave própria e reputação independente.

---

## 🔄 3. Ciclo de Vida Completo de uma Mensagem

O diagrama abaixo detalha cada etapa percorrida por um pacote de dados desde a interface de emissão até a confirmação de entrega:

```
[ Remetente: Alice ]               [ Gateway Alice ]              [ Blockchain (Cartório) ]           [ Gateway Bob ]               [ Destinatário: Bob ]
        │                                  │                                  │                              │                               │
        │── 1. Compor Mensagem ───────────>│                                  │                              │                               │
        │      (HTML, Anexos, msgClass)    │                                  │                              │                               │
        │                                  │── 2. Consulta Cartório (Cache) ─>│                              │                               │
        │                                  │<── Retorna Endpoint & PubKey ────│                              │                               │
        │                                  │                                  │                              │                               │
        │                                  │── 3. Assina EIP-191 & Cifra GCM ─│─────────────────────────────>│                               │
        │                                  │      POST /api/v1/inbox (P2P)    │                              │                               │
        │                                  │                                  │                              │── 4. Valida Chave Pública ────│
        │                                  │                                  │                              │   Checa Status On-Chain       │
        │                                  │                                  │                              │   Grava na Caixa Postal       │
        │                                  │<── 5. Aceite P2P (202 Accepted) ────────────────────────────────│                               │
        │                                  │                                  │                              │                               │
        │<── 6. Notifica: Entregue (200) ──│                                  │                              │── 7. Renderiza em Sandbox ───>│
```

### Detalhamento das Etapas:

1. **Classificação & Preparação:** A aplicação define a classe da mensagem (`msgClass`: `TX_CODE`, `TX_RECEIPT`, `SUPPORT`, `CONVERSATION`, `MARKETING` ou `COLD_OUTREACH`) e gera o ID único UUIDv4 da mensagem.
2. **Resolução de Identidade:** O Gateway de Alice consulta o cache Redis local ou o contrato na blockchain. Em menos de 2 milissegundos, obtém o endpoint HTTPS e a chave pública de Bob.
3. **Cifragem de Sessão & Assinatura Digital:**
   - O corpo e os anexos são cifrados simetricamente com **AES-256-GCM**.
   - A chave de sessão é encapsulada para a chave pública de Bob.
   - O hash da mensagem (`keccak256`) é assinado pela chave privada do Gateway de Alice seguindo a norma **EIP-191**.
4. **Transporte P2P Direto:** A mensagem trafega via requisição HTTPS direta para o endpoint do Gateway de Bob (`POST /api/v1/inbox`), sem nenhum servidor intermediário.
5. **Auditoria & Verificação do Receptor:** O Gateway de Bob recupera a chave pública do remetente com `recoverMessageAddress()`, valida se o domínio está `ACTIVE` no contrato na blockchain e insere a mensagem no banco de dados local.
6. **Confirmação de Aceite:** O nó de Bob emite uma resposta HTTP `202 Accepted` confirmando a validação e o recebimento para a caixa de entrada.
7. **Consumo Seguro:** O usuário Bob abre o WebMaivw, que renderiza a mensagem dentro de um Iframe isolado (sandbox), garantindo imunidade a ataques locais.
