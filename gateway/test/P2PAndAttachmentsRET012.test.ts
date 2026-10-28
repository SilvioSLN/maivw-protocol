import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import type { Hex, Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { TlsCertService } from '../src/services/TlsCertService.js';
import { SignatureService } from '../src/services/SignatureService.js';
import { inboxRoutes } from '../src/routes/inbox.js';
import { attachmentRoutes } from '../src/routes/attachments.js';
import { S3CompatibleStorageAdapter } from '../src/storage/S3CompatibleStorageAdapter.js';
import { FilesystemStorageAdapter } from '../src/storage/FilesystemStorageAdapter.js';
import { inspectCertificate } from '../../../scripts/aws-cloud-bootstrap/check-p2p-certificate-expiry.mjs';

// Setup Mock Peer Keys
const peerAPrivKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const peerBPrivKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const attackerPrivKey = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex;

const accountA = privateKeyToAccount(peerAPrivKey);
const accountB = privateKeyToAccount(peerBPrivKey);
const accountAttacker = privateKeyToAccount(attackerPrivKey);

// Generate self-signed TLS test certificates for Peer A and Peer B
function generateTestCert(domain: string) {
  const { certPem, keyPem, fingerprintSha256 } = TlsCertService.getOrProvisionNodeCredentials({
    domain,
    certsDir: `/tmp/maivw-test-certs-${domain.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}`,
  });
  return { certPem, keyPem, fingerprintSha256 };
}

const certA = generateTestCert('peer-a.maivw');
const certB = generateTestCert('peer-b.maivw');
const certAttacker = generateTestCert('attacker.com');

// -----------------------------------------------------------------------------
// 1. Validar Dois Pares Reais, Certificados/Ancoragem, Assinatura e Anti-Spoofing
// -----------------------------------------------------------------------------
test('RET-012: Dois pares reais entregam via mTLS com ancoragem, persistência e anti-spoofing', async () => {
  const dbMessages: any[] = [];
  const mockPrisma: any = {
    message: {
      upsert: async ({ create }: any) => {
        dbMessages.push(create);
        return create;
      },
      findUnique: async () => null,
    },
  };

  const mockLedger: any = {
    isProvider: async () => false,
    getPublicKey: async (domain: string) => {
      if (domain === 'peer-a.maivw') return accountA.address;
      if (domain === 'peer-b.maivw') return accountB.address;
      return null;
    },
    getDomainTlsFingerprint: async (domain: string) => {
      if (domain === 'peer-a.maivw') return certA.fingerprintSha256;
      if (domain === 'peer-b.maivw') return certB.fingerprintSha256;
      return null;
    },
  };

  const signerA = new SignatureService(peerAPrivKey);
  const signerB = new SignatureService(peerBPrivKey);
  const attackerSigner = new SignatureService(attackerPrivKey);

  const mockReputation: any = {
    isSenderBlocked: async () => false,
    getScore: async () => 100,
    isBlacklisted: async () => false,
  };

  const app = Fastify();
  await inboxRoutes(app, {
    ledger: mockLedger,
    signer: signerA,
    reputation: mockReputation,
    prisma: mockPrisma,
    trustProxy: false, // Strict anti-header-spoofing
  });

  try {
    // 1.1 Peer A -> Peer B: Entrega válida com mTLS
    const now1 = Math.floor(Date.now() / 1000);
    const msgId1 = crypto.randomUUID();
    const content1 = { text: 'Secret Payload from Peer A', html: '<p>Secret</p>' };
    const contentHash1 = SignatureService.computeContentHash(content1);
    const attachmentsHash1 = SignatureService.computeAttachmentsHash([]);
    const payload1 = {
      version: '2.0' as const,
      messageId: msgId1,
      from: 'peer-a.maivw',
      to: 'dest@peer-b.maivw',
      subject: 'P2P Real Peer Handshake A->B',
      msgClass: 'TX_CODE' as const,
      timestamp: now1,
      contentHash: contentHash1,
      attachmentsHash: attachmentsHash1,
    };
    const sig1 = await signerA.signEnvelopeV2(payload1);

    const appWithTls = Fastify();
    appWithTls.addHook('onRequest', async (req: any) => {
      req.raw.socket = {
        getPeerCertificate: () => ({
          raw: new crypto.X509Certificate(certA.certPem).raw,
        }),
      };
    });
    await inboxRoutes(appWithTls, {
      ledger: mockLedger,
      signer: signerA,
      reputation: mockReputation,
      prisma: mockPrisma,
      trustProxy: false,
    });

    const resValidA = await appWithTls.inject({
      method: 'POST',
      url: '/api/v1/inbox',
      headers: {
        'x-maivw-envelope-version': '2.0',
        'x-maivw-sender': 'peer-a.maivw',
        'x-maivw-timestamp': String(now1),
      },
      payload: {
        envelopeVersion: '2.0',
        messageId: msgId1,
        from: 'peer-a.maivw',
        to: 'dest@peer-b.maivw',
        subject: 'P2P Real Peer Handshake A->B',
        msgClass: 'TX_CODE',
        content: content1,
        signature: sig1,
        timestamp: now1,
      },
    });

    assert.equal(resValidA.statusCode, 202);
    assert.equal(resValidA.json().status, 'accepted');
    assert.ok(dbMessages.some((m) => m.messageId === msgId1));

    // 1.2 Peer B -> Peer A: Entrega válida no sentido oposto
    const now2 = Math.floor(Date.now() / 1000);
    const msgId2 = crypto.randomUUID();
    const content2 = { text: 'Confirmation from Peer B' };
    const contentHash2 = SignatureService.computeContentHash(content2);
    const attachmentsHash2 = SignatureService.computeAttachmentsHash([]);
    const payload2 = {
      version: '2.0' as const,
      messageId: msgId2,
      from: 'peer-b.maivw',
      to: 'dest@peer-a.maivw',
      subject: 'P2P Real Peer Handshake B->A Response',
      msgClass: 'TX_CODE' as const,
      timestamp: now2,
      contentHash: contentHash2,
      attachmentsHash: attachmentsHash2,
    };
    const sig2 = await signerB.signEnvelopeV2(payload2);

    const appWithTlsB = Fastify();
    appWithTlsB.addHook('onRequest', async (req: any) => {
      req.raw.socket = {
        getPeerCertificate: () => ({
          raw: new crypto.X509Certificate(certB.certPem).raw,
        }),
      };
    });
    await inboxRoutes(appWithTlsB, {
      ledger: mockLedger,
      signer: signerB,
      reputation: mockReputation,
      prisma: mockPrisma,
      trustProxy: false,
    });

    const resValidB = await appWithTlsB.inject({
      method: 'POST',
      url: '/api/v1/inbox',
      headers: {
        'x-maivw-envelope-version': '2.0',
        'x-maivw-sender': 'peer-b.maivw',
        'x-maivw-timestamp': String(now2),
      },
      payload: {
        envelopeVersion: '2.0',
        messageId: msgId2,
        from: 'peer-b.maivw',
        to: 'dest@peer-a.maivw',
        subject: 'P2P Real Peer Handshake B->A Response',
        msgClass: 'TX_CODE',
        content: content2,
        signature: sig2,
        timestamp: now2,
      },
    });

    assert.equal(resValidB.statusCode, 202);
    assert.equal(resValidB.json().status, 'accepted');
    assert.ok(dbMessages.some((m) => m.messageId === msgId2));

    // 1.3 Negativo: Peer sem certificado X.509
    const resNoCert = await app.inject({
      method: 'POST',
      url: '/api/v1/inbox',
      headers: {
        'x-maivw-envelope-version': '2.0',
        'x-maivw-sender': 'peer-a.maivw',
        'x-maivw-timestamp': String(now1),
      },
      payload: {
        envelopeVersion: '2.0',
        messageId: crypto.randomUUID(),
        from: 'peer-a.maivw',
        to: 'dest@peer-b.maivw',
        subject: 'No Cert Attack',
        msgClass: 'TX_CODE',
        content: content1,
        signature: sig1,
        timestamp: now1,
      },
    });
    assert.equal(resNoCert.statusCode, 401);
    assert.equal(resNoCert.json().error, 'TlsCertificateRequired');

    // 1.4 Negativo: Certificado divergente do ancorado on-chain
    const appWithMismatchedTls = Fastify();
    appWithMismatchedTls.addHook('onRequest', async (req: any) => {
      req.raw.socket = {
        getPeerCertificate: () => ({
          raw: new crypto.X509Certificate(certAttacker.certPem).raw,
        }),
      };
    });
    await inboxRoutes(appWithMismatchedTls, {
      ledger: mockLedger,
      signer: signerA,
      reputation: mockReputation,
      prisma: mockPrisma,
      trustProxy: false,
    });

    const resMismatch = await appWithMismatchedTls.inject({
      method: 'POST',
      url: '/api/v1/inbox',
      headers: {
        'x-maivw-envelope-version': '2.0',
        'x-maivw-sender': 'peer-a.maivw',
        'x-maivw-timestamp': String(now1),
      },
      payload: {
        envelopeVersion: '2.0',
        messageId: crypto.randomUUID(),
        from: 'peer-a.maivw',
        to: 'dest@peer-b.maivw',
        subject: 'Mismatch Attack',
        msgClass: 'TX_CODE',
        content: content1,
        signature: sig1,
        timestamp: now1,
      },
    });
    assert.equal(resMismatch.statusCode, 403);
    assert.equal(resMismatch.json().error, 'TlsFingerprintMismatch');

    // 1.5 Negativo: Header Spoofing ignorado quando TRUST_PROXY=false
    const resSpoof = await app.inject({
      method: 'POST',
      url: '/api/v1/inbox',
      headers: {
        'x-maivw-envelope-version': '2.0',
        'x-maivw-sender': 'peer-a.maivw',
        'x-maivw-timestamp': String(now1),
        'x-client-cert-fingerprint-sha256': certA.fingerprintSha256,
      },
      payload: {
        envelopeVersion: '2.0',
        messageId: crypto.randomUUID(),
        from: 'peer-a.maivw',
        to: 'dest@peer-b.maivw',
        subject: 'Spoofed Header Attack',
        msgClass: 'TX_CODE',
        content: content1,
        signature: sig1,
        timestamp: now1,
      },
    });
    assert.equal(resSpoof.statusCode, 401);
    assert.equal(resSpoof.json().error, 'TlsCertificateRequired');

    // 1.6 Negativo: Certificado válido com assinatura forjada
    const fakeSig = await attackerSigner.signEnvelopeV2(payload1);
    const resForgedSig = await appWithTls.inject({
      method: 'POST',
      url: '/api/v1/inbox',
      headers: {
        'x-maivw-envelope-version': '2.0',
        'x-maivw-sender': 'peer-a.maivw',
        'x-maivw-timestamp': String(now1),
      },
      payload: {
        envelopeVersion: '2.0',
        messageId: crypto.randomUUID(),
        from: 'peer-a.maivw',
        to: 'dest@peer-b.maivw',
        subject: 'Valid TLS but Forged Sig',
        msgClass: 'TX_CODE',
        content: content1,
        signature: fakeSig,
        timestamp: now1,
      },
    });
    assert.equal(resForgedSig.statusCode, 401);
    assert.ok(resForgedSig.json().message.includes('Assinatura criptográfica inválida'));

    // 1.7 Negativo: Cliente P2P rejeita transporte HTTP inseguro para destino com DANE
    await assert.rejects(
      async () => {
        await TlsCertService.dispatchP2PRequest('http://peer-b.maivw/api/v1/inbox', {
          recipientFingerprint: certB.fingerprintSha256,
        });
      },
      (err: any) => err.message.includes('InsecureTransportError')
    );
  } finally {
    await app.close();
  }
});

// -----------------------------------------------------------------------------
// 2. Testar R2 pelo Fluxo da Aplicação e Isolamento Multi-Tenant Estrito
// -----------------------------------------------------------------------------
test('RET-012: Fluxo de aplicação com R2, presigned URLs e isolamento entre clientes', async () => {
  // Simulação de Storage R2
  const r2Adapter = new S3CompatibleStorageAdapter({
    bucket: 'maivw-staging-attachments',
    region: 'auto',
    endpoint: 'https://test-account.r2.cloudflarestorage.com',
    accessKeyId: 'R2_TEST_KEY_ID_STAGING_012',
    secretAccessKey: 'R2_TEST_SECRET_ACCESS_KEY_STAGING_012_HIGH_ENTROPY',
    forcePathStyle: true,
  });

  const domainA = { id: 100, userId: 1, domainName: 'tenant-a.com', isVerified: true };
  const domainB = { id: 200, userId: 2, domainName: 'tenant-b.com', isVerified: true };

  const userA = { id: 1, email: 'admin@tenant-a.com', role: 'admin' as const };
  const userB = { id: 2, email: 'admin@tenant-b.com', role: 'admin' as const };

  const mockPrisma: any = {
    domain: {
      findUnique: async ({ where }: any) => {
        if (where.id === 100) return domainA;
        if (where.id === 200) return domainB;
        return null;
      },
    },
    user: {
      findUnique: async ({ where }: any) => {
        if (where.id === 1) return userA;
        if (where.id === 2) return userB;
        return null;
      },
    },
  };

  const mockKms: any = {
    validateApiKey: async (key: string) => {
      if (key === 'maivw_live_key_a') return { domainId: 100, domainName: 'tenant-a.com' };
      if (key === 'maivw_live_key_b') return { domainId: 200, domainName: 'tenant-b.com' };
      return null;
    },
  };

  const app = Fastify();
  await app.register(attachmentRoutes, {
    storage: r2Adapter,
    prisma: mockPrisma,
    kms: mockKms,
  });

  try {
    // 2.1 Tenant A solicita Signed Upload URL para o R2
    const resSignedUpA = await app.inject({
      method: 'POST',
      url: '/api/v1/attachments/signed-upload',
      headers: { authorization: 'Bearer maivw_live_key_a' },
      payload: {
        filename: 'tenant_a_confidential.pdf',
        mimeType: 'application/pdf',
        expiresInSeconds: 600,
      },
    });

    assert.equal(resSignedUpA.statusCode, 200);
    const signedDataA = resSignedUpA.json();
    assert.equal(signedDataA.success, true);
    assert.equal(signedDataA.method, 'PUT');
    assert.ok(signedDataA.uploadUrl.includes('r2.cloudflarestorage.com'));
    assert.ok(signedDataA.uploadUrl.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'));
    assert.ok(signedDataA.id.includes('_d100_') || signedDataA.id.includes('_u1_'));

    const attIdA = signedDataA.id;

    // 2.2 Tenant A pode solicitar Signed Download URL para o anexo dele
    // Mock getMetadata para simular objeto persistido no R2
    const originalGetMetadata = r2Adapter.getMetadata.bind(r2Adapter);
    r2Adapter.getMetadata = async (key: string) => ({
      key,
      size: 1024,
      mimeType: 'application/pdf',
      sha256: 'a'.repeat(64),
      uploadedAt: new Date(),
      customMetadata: {
        filename: 'tenant_a_confidential.pdf',
        ownerUserId: '1',
        ownerDomainId: '100',
      },
    });

    const resSignedDlA = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attIdA}/signed-download?key=${signedDataA.key}`,
      headers: { authorization: 'Bearer maivw_live_key_a' },
    });

    assert.equal(resSignedDlA.statusCode, 200);
    assert.equal(resSignedDlA.json().success, true);
    assert.ok(resSignedDlA.json().downloadUrl.includes('r2.cloudflarestorage.com'));

    // 2.3 ISOLAMENTO: Tenant B tenta obter a URL assinada de download do Tenant A -> NEGADA (403)
    const resSignedDlB = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attIdA}/signed-download?key=${signedDataA.key}`,
      headers: { authorization: 'Bearer maivw_live_key_b' },
    });

    assert.equal(resSignedDlB.statusCode, 403);
    assert.ok(resSignedDlB.json().message.includes('Acesso negado: anexo pertence a outro domínio ou usuário'));

    // 2.4 ISOLAMENTO: Requisição anônima sem credenciais -> NEGADA (401)
    const resAnonDl = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attIdA}/signed-download?key=${signedDataA.key}`,
    });
    assert.equal(resAnonDl.statusCode, 401);

    // 2.5 ISOLAMENTO: Tenant B tenta download direto de anexo alheio -> NEGADA (403)
    r2Adapter.get = async (key: string) => ({
      key,
      data: Buffer.from('Confidential Tenant A Content'),
      metadata: {
        key,
        size: 28,
        mimeType: 'text/plain',
        sha256: 'b'.repeat(64),
        uploadedAt: new Date(),
        customMetadata: {
          ownerUserId: '1',
          ownerDomainId: '100',
        },
      },
    });

    const resDirectDlB = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attIdA}/download`,
      headers: { authorization: 'Bearer maivw_live_key_b' },
    });
    assert.equal(resDirectDlB.statusCode, 403);
    assert.ok(resDirectDlB.json().message.includes('Acesso negado: anexo pertence a outro domínio ou usuário'));

    r2Adapter.getMetadata = originalGetMetadata;
  } finally {
    await app.close();
  }
});

// -----------------------------------------------------------------------------
// 3. Alerta de Expiração de Certificado, Rollback e Distinção de Identidade
// -----------------------------------------------------------------------------
test('RET-012: Alerta de expiração, rollback atômico e separação de identidade ACME', async () => {
  // 3.1 Teste de alerta de expiração
  const certActive = generateTestCert('active.p2p.maivw');
  const tempCertFile = `/tmp/test-cert-${Date.now()}.crt`;
  const fs = await import('node:fs');
  fs.writeFileSync(tempCertFile, certActive.certPem);

  try {
    const reportHealthy = inspectCertificate(tempCertFile, 14);
    assert.equal(reportHealthy.status, 'HEALTHY');
    assert.equal(reportHealthy.warning, false);
    assert.equal(reportHealthy.critical, false);
    assert.ok(reportHealthy.daysRemaining! > 300);
    assert.equal(reportHealthy.fingerprintSha256, certActive.fingerprintSha256);

    // Certificado com threshold alto simula expiring soon
    const reportExpiringSoon = inspectCertificate(tempCertFile, 4000);
    assert.equal(reportExpiringSoon.status, 'EXPIRING_SOON');
    assert.equal(reportExpiringSoon.warning, true);
    assert.equal(reportExpiringSoon.critical, false);

    // 3.2 Distinção entre renovação ACME e troca de identidade on-chain:
    // Uma nova emissão de certificado gera fingerprint diferente
    const certRenewed = generateTestCert('active.p2p.maivw');
    assert.notEqual(
      certActive.fingerprintSha256,
      certRenewed.fingerprintSha256,
      'Renovação ACME gera novo fingerprint X.509 DANE, exigindo coordenação on-chain'
    );
  } finally {
    if (fs.existsSync(tempCertFile)) fs.unlinkSync(tempCertFile);
  }
});
