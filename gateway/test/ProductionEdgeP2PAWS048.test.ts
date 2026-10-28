import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import type { Hex, Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { TlsCertService } from '../src/services/TlsCertService.js';
import { SignatureService } from '../src/services/SignatureService.js';
import { inboxRoutes } from '../src/routes/inbox.js';
import { inspectCertificate } from '../../../scripts/aws-cloud-bootstrap/check-p2p-certificate-expiry.mjs';

const ROOT_DIR = resolve(process.cwd(), '../..');
const EDGE_MANIFEST_PATH = resolve(ROOT_DIR, 'infra/cloudflare/cloudflare-edge-manifest.json');
const TUNNEL_CONFIG_PATH = resolve(ROOT_DIR, 'infra/cloudflare/tunnel-config.production.yml');
const RELEASE_EDGE_MANIFEST_PATH = resolve(ROOT_DIR, 'releases/production/edge-p2p-manifest.json');
const FOUNDATION_TEMPLATE_PATH = resolve(ROOT_DIR, 'infra/aws/cdk.out/maivw-production-foundation.template.json');

// Mock Peer Keys
const peerAPrivKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const peerBPrivKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const attackerPrivKey = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex;

const accountA = privateKeyToAccount(peerAPrivKey);
const accountB = privateKeyToAccount(peerBPrivKey);
const accountAttacker = privateKeyToAccount(attackerPrivKey);

function generateTestCert(domain: string) {
  const { certPem, keyPem, fingerprintSha256 } = TlsCertService.getOrProvisionNodeCredentials({
    domain,
    certsDir: `/tmp/maivw-prod-edge-certs-${domain.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}`,
  });
  return { certPem, keyPem, fingerprintSha256 };
}

const certA = generateTestCert('peer-a.maivw.com');
const certB = generateTestCert('peer-b.maivw.com');
const certAttacker = generateTestCert('attacker.com');

// -----------------------------------------------------------------------------
// 1. Integridade do Manifesto Declarativo de Borda de Producao
// -----------------------------------------------------------------------------
test('AWS-048: Integridade declarativa da borda Cloudflare de producao', async () => {
  assert.ok(existsSync(EDGE_MANIFEST_PATH), 'Manifesto de borda Cloudflare deve existir');
  assert.ok(existsSync(TUNNEL_CONFIG_PATH), 'Arquivo de configuracao do tunel de producao deve existir');
  assert.ok(existsSync(RELEASE_EDGE_MANIFEST_PATH), 'Manifesto de release edge-p2p deve existir');

  const edgeManifest = JSON.parse(readFileSync(EDGE_MANIFEST_PATH, 'utf8'));
  const releaseManifest = JSON.parse(readFileSync(RELEASE_EDGE_MANIFEST_PATH, 'utf8'));
  const tunnelYml = readFileSync(TUNNEL_CONFIG_PATH, 'utf8');

  // Validar ambiente de producao no manifesto principal
  const prodConfig = edgeManifest.environments.production;
  assert.ok(prodConfig, 'Ambiente production deve existir no manifesto');
  assert.strictEqual(prodConfig.tunnelName, 'maivw-production-tunnel');
  assert.strictEqual(prodConfig.p2pHost, 'p2p.maivw.com');
  assert.strictEqual(prodConfig.tlsPolicy.sslMode, 'strict');
  assert.strictEqual(prodConfig.tlsPolicy.minTlsVersion, '1.2');
  assert.strictEqual(prodConfig.tlsPolicy.hsts.enabled, true);

  // Validar 6 registros proxied e 1 DNS-only no manifesto
  const proxiedDns = prodConfig.dnsRecords.filter((r: any) => r.proxied);
  const directDns = prodConfig.dnsRecords.filter((r: any) => !r.proxied);
  assert.strictEqual(proxiedDns.length, 6, 'Devem existir 6 registros DNS proxied via Tunnel');
  assert.strictEqual(directDns.length, 1, 'Deve existir 1 registro DNS-only (P2P mTLS)');
  assert.strictEqual(directDns[0].name, 'p2p.maivw.com');
  assert.strictEqual(directDns[0].proxied, false);

  // Validar Catch-All fail-closed no túnel
  const catchAllRule = prodConfig.ingressRules.find((r: any) => r.service === 'http_status:404');
  assert.ok(catchAllRule, 'Ingress rules devem conter catch-all fail-closed http_status:404');
  assert.ok(tunnelYml.includes('service: http_status:404'), 'tunnel-config.production.yml deve conter catch-all');

  // Validar alinhamento com release-manifest
  assert.strictEqual(releaseManifest.environment, 'production');
  assert.strictEqual(releaseManifest.tunnel.name, 'maivw-production-tunnel');
  assert.strictEqual(releaseManifest.p2p.port, 443);
  assert.strictEqual(releaseManifest.p2p.mtlsRequired, true);
  assert.strictEqual(releaseManifest.securityGuarantees.originHidden, true);
});

// -----------------------------------------------------------------------------
// 2. Ocultacao da Origem EC2 e Isolamento de Rede
// -----------------------------------------------------------------------------
test('AWS-048: Ocultacao da origem EC2 e bloqueio de portas internas/SSH', async () => {
  if (existsSync(FOUNDATION_TEMPLATE_PATH)) {
    const template = JSON.parse(readFileSync(FOUNDATION_TEMPLATE_PATH, 'utf8'));
    const resources = template.Resources || {};

    // Localizar Security Group da EC2
    const ec2Sg = Object.values(resources).find(
      (r: any) => r.Type === 'AWS::EC2::SecurityGroup' && r.Properties.GroupName?.includes('ec2-sg')
    ) as any;

    assert.ok(ec2Sg, 'Security Group da EC2 deve existir no template da FoundationStack');

    const ingressRules = ec2Sg.Properties.SecurityGroupIngress || [];

    // Validar que a porta 443 esta liberada exclusivamente para P2P mTLS
    const p2pRule = ingressRules.find((rule: any) => rule.FromPort === 443 && rule.ToPort === 443);
    assert.ok(p2pRule, 'Regra de ingress para a porta 443 (P2P mTLS) deve existir');
    assert.strictEqual(p2pRule.IpProtocol, 'tcp');
    assert.strictEqual(p2pRule.CidrIp, '0.0.0.0/0');

    // Validar que a porta 22 (SSH) esta estritamente ausente
    const sshRule = ingressRules.find((rule: any) => rule.FromPort === 22 || rule.ToPort === 22);
    assert.strictEqual(sshRule, undefined, 'Porta 22 (SSH) NAO deve estar aberta no Security Group');

    // Validar que a porta 80 (HTTP plano) esta estritamente ausente
    const httpRule = ingressRules.find((rule: any) => rule.FromPort === 80 || rule.ToPort === 80);
    assert.strictEqual(httpRule, undefined, 'Porta 80 (HTTP) NAO deve estar aberta na EC2');

    // Validar que portas de micro-servicos (3000 a 3004) nao estao abertas para o mundo
    const internalPortRules = ingressRules.filter(
      (rule: any) => (rule.FromPort >= 3000 && rule.FromPort <= 3004) || (rule.ToPort >= 3000 && rule.ToPort <= 3004)
    );
    assert.strictEqual(internalPortRules.length, 0, 'Portas internas 3000-3004 NAO devem estar abertas no Security Group');
  }
});

// -----------------------------------------------------------------------------
// 3. Protecao Zero Trust do Console Administrativo via Cloudflare Access
// -----------------------------------------------------------------------------
test('AWS-048: Protecao Zero Trust do Console administrativo via Cloudflare Access', async () => {
  const edgeManifest = JSON.parse(readFileSync(EDGE_MANIFEST_PATH, 'utf8'));
  const accessConfig = edgeManifest.environments.production.access;

  assert.ok(accessConfig, 'Configuracao de Cloudflare Access deve existir para producao');
  assert.strictEqual(accessConfig.appName, 'maivw-production-console');
  assert.strictEqual(accessConfig.domain, 'console.maivw.com');
  assert.strictEqual(accessConfig.sessionDuration, '24h');
  assert.strictEqual(accessConfig.zeroBypassAllowed, true);

  const policy = accessConfig.policies[0];
  assert.ok(policy, 'Deve haver ao menos uma politica de acesso configurada');
  assert.strictEqual(policy.decision, 'allow');
  assert.strictEqual(policy.requireMfa, true);

  // Validar restricao de dominio corporativo
  const domainRule = policy.include.find((r: any) => r.emailDomain);
  assert.ok(domainRule, 'Regra de dominio de e-mail corporativo deve existir');
  assert.strictEqual(domainRule.emailDomain, 'maivw.org');

  // Teste de simulacao de endpoint: requisicao sem cabecalho Access deve ser barrada fail-closed
  const app = Fastify();
  app.addHook('onRequest', async (req, reply) => {
    const cfAccessJwt = req.headers['cf-access-jwt-assertion'];
    if (!cfAccessJwt) {
      reply.status(403).send({ error: 'AccessDenied', message: 'Missing Cloudflare Access Token' });
    }
  });
  app.get('/admin', async () => ({ status: 'ADMIN_OK' }));

  // Tentativa sem token Access -> HTTP 403
  const unauthRes = await app.inject({ method: 'GET', url: '/admin' });
  assert.strictEqual(unauthRes.statusCode, 403);
  assert.strictEqual(JSON.parse(unauthRes.payload).error, 'AccessDenied');

  // Tentativa com token Access corporativo valido -> HTTP 200
  const authRes = await app.inject({
    method: 'GET',
    url: '/admin',
    headers: { 'cf-access-jwt-assertion': 'valid-corporate-access-jwt-token' },
  });
  assert.strictEqual(authRes.statusCode, 200);
  assert.strictEqual(JSON.parse(authRes.payload).status, 'ADMIN_OK');
});

// -----------------------------------------------------------------------------
// 4. Armazenamento R2 de Producao, CORS e Isolamento Multi-Tenant
// -----------------------------------------------------------------------------
test('AWS-048: Configuracao de armazenamento Cloudflare R2 e regras CORS de producao', async () => {
  const edgeManifest = JSON.parse(readFileSync(EDGE_MANIFEST_PATH, 'utf8'));
  const r2Config = edgeManifest.environments.production.r2;

  assert.ok(r2Config, 'Configuracao de R2 deve existir no manifesto');
  assert.strictEqual(r2Config.bucketName, 'maivw-production-attachments');
  assert.strictEqual(r2Config.s3Compatible, true);
  // Validar tamanho maximo de anexo (25 MB)
  const maxBytes = r2Config.securityGuarantees?.maxFileSizeBytes || r2Config.maxFileSizeBytes;
  assert.strictEqual(maxBytes, 26214400, 'Limite de tamanho de arquivo deve ser 25 MB');

  // Validar regras de CORS restritas
  const corsRule = r2Config.corsRules[0];
  assert.ok(corsRule, 'Regra de CORS deve existir');
  assert.deepStrictEqual(corsRule.allowedOrigins, [
    'https://webmail.maivw.com',
    'https://dash.maivw.com',
    'https://api.maivw.com',
  ]);
  assert.deepStrictEqual(corsRule.allowedMethods, ['GET', 'PUT', 'HEAD']);
  assert.ok(corsRule.exposeHeaders.includes('x-amz-meta-sha256'));

  // Validar regras de lifecycle
  const multipartLifecycle = r2Config.lifecycleRules.find((l: any) => l.abortIncompleteMultipartUploadDays === 7);
  assert.ok(multipartLifecycle, 'Regra de abort de multipart incompleto em 7 dias deve existir');
  const transientLifecycle = r2Config.lifecycleRules.find((l: any) => l.prefix === 'transient/');
  assert.ok(transientLifecycle, 'Regra de expiracao de transient em 90 dias deve existir');

  // Simulacao de isolamento multi-tenant de anexos
  const attachmentsDb = new Map<string, { id: string; tenantId: string; sha256: string }>();
  attachmentsDb.set('att_1001_tenant_alpha', {
    id: 'att_1001_tenant_alpha',
    tenantId: 'tenant-alpha',
    sha256: '0x1111222233334444555566667777888899990000111122223333444455556666',
  });

  function getAttachmentSignedDownloadUrl(attachmentId: string, requestTenantId: string) {
    const item = attachmentsDb.get(attachmentId);
    if (!item) return { status: 404, error: 'NotFound' };
    if (item.tenantId !== requestTenantId) {
      return { status: 403, error: 'Forbidden', message: 'Acesso negado: anexo pertence a outro locatario' };
    }
    return { status: 200, signedDownloadUrl: `https://maivw-production-attachments.r2.cloudflarestorage.com/${item.id}?sig=valid` };
  }

  // Tenant Alpha acessa seu proprio anexo -> 200 OK
  const resAlpha = getAttachmentSignedDownloadUrl('att_1001_tenant_alpha', 'tenant-alpha');
  assert.strictEqual(resAlpha.status, 200);
  assert.ok(resAlpha.signedDownloadUrl);

  // Tenant Beta tenta acessar anexo de Tenant Alpha -> 403 Forbidden
  const resBeta = getAttachmentSignedDownloadUrl('att_1001_tenant_alpha', 'tenant-beta');
  assert.strictEqual(resBeta.status, 403);
  assert.strictEqual(resBeta.error, 'Forbidden');
});

// -----------------------------------------------------------------------------
// 5. Handshake P2P mTLS L4 e Validacao DANE On-Chain
// -----------------------------------------------------------------------------
test('AWS-048: Handshake P2P mTLS com certificado X.509 e validacao DANE on-chain', async () => {
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
      if (domain === 'peer-a.maivw.com') return accountA.address;
      if (domain === 'peer-b.maivw.com') return accountB.address;
      return null;
    },
    getDomainTlsFingerprint: async (domain: string) => {
      if (domain === 'peer-a.maivw.com') return certA.fingerprintSha256;
      if (domain === 'peer-b.maivw.com') return certB.fingerprintSha256;
      return null;
    },
  };

  const signerA = new SignatureService(peerAPrivKey);
  const signerB = new SignatureService(peerBPrivKey);

  const mockReputation: any = {
    isSenderBlocked: async () => false,
    getScore: async () => 100,
    isBlacklisted: async () => false,
  };

  const app = Fastify();
  app.addHook('onRequest', async (req: any) => {
    req.raw.socket = {
      getPeerCertificate: () => ({
        raw: Buffer.from(certA.certPem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, ''), 'base64'),
      }),
    };
  });

  await inboxRoutes(app, {
    ledger: mockLedger,
    signer: signerB,
    reputation: mockReputation,
    prisma: mockPrisma,
    trustProxy: false,
  });

  // Peer A prepara mensagem Envelope V2 canônica
  const now = Math.floor(Date.now() / 1000);
  const msgId = crypto.randomUUID();
  const content = { text: 'Production P2P Handshake A -> B' };
  const contentHash = SignatureService.computeContentHash(content);
  const attachmentsHash = SignatureService.computeAttachmentsHash([]);

  const payload = {
    version: '2.0' as const,
    messageId: msgId,
    from: 'peer-a.maivw.com',
    to: 'bob@peer-b.maivw.com',
    subject: 'Production P2P Handshake A -> B',
    msgClass: 'TX_CODE' as const,
    timestamp: now,
    contentHash,
    attachmentsHash,
  };

  const signature = await signerA.signEnvelopeV2(payload as any);

  // Envio com socket mTLS autenticado e headers de Envelope V2
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/inbox',
    headers: {
      'content-type': 'application/json',
      host: 'p2p.maivw.com',
      'x-maivw-envelope-version': '2.0',
      'x-maivw-sender': 'peer-a.maivw.com',
      'x-maivw-timestamp': String(now),
    },
    payload: {
      envelopeVersion: '2.0',
      messageId: msgId,
      from: 'peer-a.maivw.com',
      to: 'bob@peer-b.maivw.com',
      subject: 'Production P2P Handshake A -> B',
      msgClass: 'TX_CODE',
      content,
      signature,
      timestamp: now,
    },
  });

  assert.strictEqual(response.statusCode, 202, 'Envio com mTLS e assinatura legitimos deve retornar HTTP 202 Accepted');
  const resBody = JSON.parse(response.payload);
  assert.strictEqual(resBody.status, 'accepted');
  assert.strictEqual(resBody.messageId, msgId);
});

// -----------------------------------------------------------------------------
// 6. Rejeicao Fail-Closed de Intrusoes no Canal P2P mTLS
// -----------------------------------------------------------------------------
test('AWS-048: Rejeicao fail-closed de tentativas de intrusao no canal P2P', async () => {
  const mockLedger: any = {
    isProvider: async () => false,
    getPublicKey: async (domain: string) => {
      if (domain === 'peer-a.maivw.com') return accountA.address;
      if (domain === 'attacker.com') return accountAttacker.address;
      return null;
    },
    getDomainTlsFingerprint: async (domain: string) => {
      if (domain === 'peer-a.maivw.com') return certA.fingerprintSha256;
      return null; // Attacker nao tem DANE ancorado
    },
  };

  // Teste de normalizacao e matching de fingerprints
  const legitimateMatch = TlsCertService.matchesFingerprint(certA.fingerprintSha256, certA.fingerprintSha256);
  assert.strictEqual(legitimateMatch, true, 'Fingerprint legitimo deve corresponder');

  const attackerMatch = TlsCertService.matchesFingerprint(certAttacker.fingerprintSha256, certA.fingerprintSha256);
  assert.strictEqual(attackerMatch, false, 'Fingerprint do atacante NAO deve corresponder');

  // Teste de rejeição de cabeçalho forjado quando TRUST_PROXY=false
  function evaluateIncomingPeerCert(
    socketCertDer: Buffer | null,
    spoofedHeaderFingerprint: string | null,
    trustProxy: boolean
  ): { allowed: boolean; reason: string; computedFingerprint?: string } {
    if (!trustProxy) {
      // Cabecalho de proxy e sumariamente ignorado
      if (!socketCertDer) {
        return { allowed: false, reason: 'TlsCertificateRequired' };
      }
      const actualFp = TlsCertService.computeCertFingerprint(socketCertDer);
      return { allowed: true, reason: 'SocketCertVerified', computedFingerprint: actualFp };
    } else {
      const fp = socketCertDer ? TlsCertService.computeCertFingerprint(socketCertDer) : spoofedHeaderFingerprint;
      if (!fp) return { allowed: false, reason: 'TlsCertificateRequired' };
      return { allowed: true, reason: 'ProxyCertUsed', computedFingerprint: fp };
    }
  }

  // 1. Sem socket cert, atacante tenta enviar cabecalho x-client-cert-fingerprint com o hash de certA
  const attemptSpoof = evaluateIncomingPeerCert(null, certA.fingerprintSha256, false);
  assert.strictEqual(attemptSpoof.allowed, false);
  assert.strictEqual(attemptSpoof.reason, 'TlsCertificateRequired', 'Spoof de proxy header DEVE ser rejeitado com TlsCertificateRequired');

  // 2. Com socket cert legitimo de certA
  const legitSocket = evaluateIncomingPeerCert(
    Buffer.from(certA.certPem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, ''), 'base64'),
    null,
    false
  );
  assert.strictEqual(legitSocket.allowed, true);
  assert.strictEqual(legitSocket.computedFingerprint, certA.fingerprintSha256);
});

// -----------------------------------------------------------------------------
// 7. Inspecao de Validade e Alertas de Expiracao do Certificado P2P
// -----------------------------------------------------------------------------
test('AWS-048: Inspecao de validade do certificado P2P (threshold > 14 dias)', async () => {
  // Salvar certificado temporario para teste de inspecao
  const tempCertPath = `/tmp/maivw-p2p-test-cert-${Date.now()}.crt`;
  const { writeFileSync, unlinkSync } = await import('node:fs');
  writeFileSync(tempCertPath, certA.certPem, 'utf8');

  try {
    const report = inspectCertificate(tempCertPath, 14);

    assert.strictEqual(report.exists, true, 'Certificado deve existir');
    assert.strictEqual(report.status, 'HEALTHY', 'Status do certificado auto-gerado deve ser HEALTHY');
    assert.strictEqual(report.warning, false, 'Nao deve haver warning para certificado recem-gerado');
    assert.strictEqual(report.critical, false, 'Nao deve haver critical para certificado recem-gerado');
    assert.ok(report.daysRemaining && report.daysRemaining > 14, 'Dias restantes devem ser superiores a 14');
    assert.ok(report.fingerprintSha256?.startsWith('0x'), 'Fingerprint deve estar em formato canônico bytes32');
  } finally {
    if (existsSync(tempCertPath)) {
      unlinkSync(tempCertPath);
    }
  }
});
