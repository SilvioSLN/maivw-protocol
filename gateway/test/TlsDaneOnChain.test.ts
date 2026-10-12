import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import type { Hex } from "viem";

import { TlsCertService } from "../src/services/TlsCertService.js";
import { SignatureService } from "../src/services/SignatureService.js";
import { inboxRoutes } from "../src/routes/inbox.js";
import { settingsRoutes } from "../src/routes/settings.js";

const JWT_SECRET = "tls-dane-test-jwt-secret-xyz";
process.env.JWT_SECRET = JWT_SECRET;

const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

function createAuthHeader(claims: any) {
  return {
    authorization: `Bearer ${jwt.sign(claims, JWT_SECRET)}`,
  };
}

function createMockPrisma() {
  const users = new Map<number, any>([
    [1, { id: 1, email: "admin@empresa.com", role: "admin" }],
    [2, { id: 2, email: "other@empresa2.com", role: "admin" }],
  ]);
  const domains = [
    { id: 1, domainName: "empresa.com", userId: 1, isVerified: true, accounts: [], smtpConfig: null },
    { id: 2, domainName: "empresa2.com", userId: 2, isVerified: true, accounts: [], smtpConfig: null },
  ];
  const messages = new Map<string, any>();

  return {
    user: {
      findUnique: async ({ where }: any) => users.get(where.id) || null,
    },
    domain: {
      findFirst: async ({ where }: any) => {
        return domains.find((d) => {
          if (where.id && d.id !== where.id) return false;
          if (where.userId && d.userId !== where.userId) return false;
          if (where.domainName && d.domainName !== where.domainName) return false;
          return true;
        }) || null;
      },
    },
    message: {
      findUnique: async ({ where }: any) => messages.get(where.messageId) || null,
      create: async ({ data }: any) => {
        messages.set(data.messageId, data);
        return data;
      },
    },
  } as any;
}

test("TlsCertService: Normalização, Cálculo e Comparação de Fingerprints SHA-256", async () => {
  // 1. Normalização de formatos
  const hex64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const formatted = `01:23:45:67:89:AB:CD:EF:${hex64.slice(16)}`;
  const canonical = TlsCertService.normalizeFingerprint(formatted);
  assert.equal(canonical, `0x${hex64}`);

  // Rejeição de fingerprint inválido
  assert.throws(() => TlsCertService.normalizeFingerprint("0xinvalidshort"), /Fingerprint inválido/);

  // 2. Provisão de credenciais locais auto-assinadas
  const tempDir = path.resolve(process.cwd(), "data/test-certs-" + Date.now());
  try {
    const creds = TlsCertService.getOrProvisionNodeCredentials({
      certsDir: tempDir,
      domain: "test.local",
    });

    assert.ok(creds.certPem.includes("BEGIN CERTIFICATE"));
    assert.ok(creds.keyPem.includes("PRIVATE KEY"));
    assert.match(creds.fingerprintSha256, /^0x[a-f0-9]{64}$/);

    // Conferência do fingerprint computado a partir do PEM
    const recomputed = TlsCertService.computeCertFingerprint(creds.certPem);
    assert.equal(recomputed, creds.fingerprintSha256);

    // Comparação matchesFingerprint
    assert.equal(TlsCertService.matchesFingerprint(creds.fingerprintSha256, recomputed), true);
    assert.equal(
      TlsCertService.matchesFingerprint(creds.fingerprintSha256, "0x0000000000000000000000000000000000000000000000000000000000000000"),
      false
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("settingsRoutes: Ancoragem de Fingerprint TLS On-Chain (DANE / S08)", async () => {
  const prisma = createMockPrisma();
  const onChainStore = new Map<string, Hex>();

  const ledger = {
    getDomainTlsFingerprint: async (domain: string) => onChainStore.get(domain.toLowerCase()) || null,
    setDomainTlsFingerprint: async (domain: string, fp: Hex) => {
      onChainStore.set(domain.toLowerCase(), fp);
      return "0xtx_fingerprint_anchored";
    },
  } as any;

  const app = Fastify();
  await settingsRoutes(app, {
    prisma,
    smtp: {} as any,
    masterKey: "master",
    ledger,
  });

  const adminAuth = createAuthHeader({ id: 1, email: "admin@empresa.com", role: "admin", domainName: "empresa.com" });
  const otherAuth = createAuthHeader({ id: 2, email: "other@empresa2.com", role: "admin", domainName: "empresa2.com" });

  // 1. Status inicial: NOT_ANCHORED
  const resGetInit = await app.inject({
    method: "GET",
    url: "/api/v1/settings/tls/empresa.com",
    headers: adminAuth,
  });
  assert.equal(resGetInit.statusCode, 200);
  const dataGetInit = JSON.parse(resGetInit.body);
  assert.equal(dataGetInit.status, "NOT_ANCHORED");
  assert.equal(dataGetInit.onChainFingerprint, null);

  // 2. Não autorizado a consultar domínio de outro admin
  const resForbidden = await app.inject({
    method: "GET",
    url: "/api/v1/settings/tls/empresa.com",
    headers: otherAuth,
  });
  assert.equal(resForbidden.statusCode, 403);

  // 3. Registrar fingerprint on-chain via POST
  const sampleFingerprint = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Hex;
  const resPost = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tls/empresa.com",
    headers: adminAuth,
    payload: { fingerprint: sampleFingerprint },
  });
  assert.equal(resPost.statusCode, 200);
  const dataPost = JSON.parse(resPost.body);
  assert.equal(dataPost.success, true);
  assert.equal(dataPost.fingerprint, sampleFingerprint);
  assert.equal(dataPost.txHash, "0xtx_fingerprint_anchored");

  // 4. Status após ancoragem reflete no GET
  const resGetAfter = await app.inject({
    method: "GET",
    url: "/api/v1/settings/tls/empresa.com",
    headers: adminAuth,
  });
  assert.equal(resGetAfter.statusCode, 200);
  const dataGetAfter = JSON.parse(resGetAfter.body);
  assert.equal(dataGetAfter.onChainFingerprint, sampleFingerprint);
  assert.equal(dataGetAfter.anchored, true);
});

test("inboxRoutes: Validação mTLS Fail-Closed com Ancoragem On-Chain (S08)", async () => {
  const signer = new SignatureService(TEST_KEY);
  const prisma = createMockPrisma();

  const domainAnchoredFp = "0xaaaa111122223333444455556666777788889999aaaabbbbccccddddeeeeffff" as Hex;

  const ledger = {
    isProvider: async () => false,
    getPublicKey: async () => signer.address,
    getDomainTlsFingerprint: async (domain: string) => {
      if (domain === "anchored-tls.com") return domainAnchoredFp;
      return null;
    },
  } as any;

  const app = Fastify();
  await inboxRoutes(app, {
    ledger,
    signer,
    reputation: { isSenderBlocked: async () => false } as any,
    prisma,
    trustProxy: true,
  });

  const now = Math.floor(Date.now() / 1000);
  const content = { text: "TLS test" };
  const contentHash = SignatureService.computeContentHash(content);

  async function createPayload(sender: string, messageId: string) {
    const signingData = {
      version: "2.0" as const,
      messageId,
      from: sender,
      to: "dest@destino.com",
      subject: "mTLS Test",
      msgClass: "TX_CODE" as const,
      timestamp: now,
      contentHash,
      attachmentsHash: "",
    };
    const signature = await signer.signEnvelopeV2(signingData);
    return {
      envelopeVersion: "2.0",
      messageId,
      msgClass: "TX_CODE",
      to: "dest@destino.com",
      subject: "mTLS Test",
      content,
      signature,
      timestamp: now,
    };
  }

  // 1. Remetente SEM ancoragem on-chain -> Aceito normalmente sem mTLS
  const p1 = await createPayload("unanchored.com", uuidv4());
  const resUnanchored = await app.inject({
    method: "POST",
    url: "/api/v1/inbox",
    headers: {
      "x-maivw-envelope-version": "2.0",
      "x-maivw-sender": "unanchored.com",
    },
    payload: p1,
  });
  assert.equal(resUnanchored.statusCode, 202);

  // 2. Remetente COM ancoragem on-chain MAS sem certificado -> 401 TlsCertificateRequired
  const p2 = await createPayload("anchored-tls.com", uuidv4());
  const resMissingCert = await app.inject({
    method: "POST",
    url: "/api/v1/inbox",
    headers: {
      "x-maivw-envelope-version": "2.0",
      "x-maivw-sender": "anchored-tls.com",
    },
    payload: p2,
  });
  assert.equal(resMissingCert.statusCode, 401);
  assert.equal(JSON.parse(resMissingCert.body).error, "TlsCertificateRequired");

  // 3. Remetente COM ancoragem on-chain MAS fingerprint divergente -> 403 TlsFingerprintMismatch
  const p3 = await createPayload("anchored-tls.com", uuidv4());
  const resMismatchCert = await app.inject({
    method: "POST",
    url: "/api/v1/inbox",
    headers: {
      "x-maivw-envelope-version": "2.0",
      "x-maivw-sender": "anchored-tls.com",
      "x-client-cert-fingerprint-sha256": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    payload: p3,
  });
  assert.equal(resMismatchCert.statusCode, 403);
  assert.equal(JSON.parse(resMismatchCert.body).error, "TlsFingerprintMismatch");

  // 4. Remetente COM ancoragem on-chain E fingerprint idêntico -> 202 Accepted
  const p4 = await createPayload("anchored-tls.com", uuidv4());
  const resMatchingCert = await app.inject({
    method: "POST",
    url: "/api/v1/inbox",
    headers: {
      "x-maivw-envelope-version": "2.0",
      "x-maivw-sender": "anchored-tls.com",
      "x-client-cert-fingerprint-sha256": domainAnchoredFp,
    },
    payload: p4,
  });
  assert.equal(resMatchingCert.statusCode, 202);
});

test("TlsCertService: Despacho P2P com verificação DANE e rejeição de transporte inseguro", async () => {
  const anchoredFp = "0xcccc111122223333444455556666777788889999aaaabbbbccccddddeeeeffff" as Hex;

  // 1. Rejeição imediata de HTTP inseguro quando destinatário exige TLS on-chain (Fail-Closed)
  await assert.rejects(
    async () => {
      await TlsCertService.dispatchP2PRequest("http://insecure-host.com/api/v1/inbox", {
        recipientFingerprint: anchoredFp,
      });
    },
    /InsecureTransportError/
  );

  // 2. Criação de servidor HTTPS de teste para validar conferência de handshake
  const tempDir = path.resolve(process.cwd(), "data/test-tls-server-" + Date.now());
  const serverCreds = TlsCertService.getOrProvisionNodeCredentials({
    certsDir: tempDir,
    domain: "localhost",
  });

  const testServer = https.createServer(
    {
      cert: serverCreds.certPem,
      key: serverCreds.keyPem,
    },
    (req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, p2pDelivered: true }));
    }
  );

  await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", () => resolve()));
  const serverPort = (testServer.address() as any).port;
  const targetHttpsUrl = `https://127.0.0.1:${serverPort}/api/v1/inbox`;

  try {
    // 3. Despacho com fingerprint divergente -> deve abortar antes da entrega
    await assert.rejects(
      async () => {
        await TlsCertService.dispatchP2PRequest(targetHttpsUrl, {
          recipientFingerprint: "0x0000000000000000000000000000000000000000000000000000000000000000",
          nodeCredentials: serverCreds,
        });
      },
      /TLS Fingerprint Mismatch/
    );

    // 4. Despacho com fingerprint correto -> conexão estabelecida com sucesso
    const successRes = await TlsCertService.dispatchP2PRequest(targetHttpsUrl, {
      recipientFingerprint: serverCreds.fingerprintSha256,
      nodeCredentials: serverCreds,
    });
    assert.equal(successRes.status, 200);
    const successData = await successRes.json();
    assert.equal(successData.p2pDelivered, true);
  } finally {
    testServer.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
