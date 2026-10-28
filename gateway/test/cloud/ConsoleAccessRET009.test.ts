import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Fastify from 'fastify';
process.env.JWT_SECRET='cloud-console-policy-unit-synthetic-key';
const {authRoutes}=await import('../../src/routes/auth.js');

// -----------------------------------------------------------------------------
// 5. Console & Cloudflare Access with ACME Isolation
// -----------------------------------------------------------------------------
test('RET-009: Console Cloudflare Access policy and backend deny ACME issuance emails administrative authority', async () => {
  // Read edge manifest
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(testDir, '../../../../infra/cloudflare/cloudflare-edge-manifest.json'),
    path.resolve(process.cwd(), 'infra/cloudflare/cloudflare-edge-manifest.json'),
  ];
  const manifestPath = candidatePaths.find((p) => fs.existsSync(p));
  assert.ok(manifestPath, 'Manifesto da borda Cloudflare deve ser encontrado');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));


  const access = manifest.environments.staging.access;
  assert.equal(access.domain, 'console-test.maivw.com');
  assert.equal(access.appName, 'maivw-staging-console');

  // Verify Access policy rules
  const policy = access.policies[0];
  assert.equal(policy.decision, 'allow');
  assert.equal(policy.requireMfa, true);

  // Policy allows ONLY maivw.org domain or explicitly listed maivw.org admin emails
  const allowedEmailDomains = policy.include.filter((i: any) => i.emailDomain).map((i: any) => i.emailDomain);
  const allowedSpecificEmails = policy.include.filter((i: any) => i.emails).flatMap((i: any) => i.emails);

  assert.deepEqual(allowedEmailDomains, ['maivw.org']);
  assert.ok(allowedSpecificEmails.includes('admin@maivw.org'));
  assert.ok(allowedSpecificEmails.includes('security@maivw.org'));

  // Test ACME issuance emails against Access policy:
  const acmeEmails = [
    'acme-notifications@letsencrypt.org',
    'cert-ops@zerossl.com',
    'hostmaster@maivw.com',
    'webmaster@example.com',
    'acme-issuer@cloudflare.com',
  ];

  for (const acmeEmail of acmeEmails) {
    const domain = acmeEmail.split('@')[1];
    const matchesDomain = allowedEmailDomains.includes(domain);
    const matchesSpecific = allowedSpecificEmails.includes(acmeEmail);
    assert.equal(matchesDomain, false, `ACME email ${acmeEmail} must not match allowed Access domains`);
    assert.equal(matchesSpecific, false, `ACME email ${acmeEmail} must not match allowed Access emails`);
  }

  // Application Authorization: even if an HTTP request had an ACME email, it has no JWT and no DB admin account
  const prisma: any = {
    user: {
      findUnique: async () => null, // ACME contact email does NOT exist in DB
    },
    domain: { findMany: async () => [] },
  };

  const app = Fastify();
  await app.register(authRoutes, { prisma, kms: {} as any });

  try {
    const resAcme = await app.inject({
      method: 'GET',
      url: '/api/v1/domains',
      headers: {
        'x-forwarded-email': 'acme-notifications@letsencrypt.org',
      },
    });
    // Without valid Bearer token for an existing admin user, denied with 403
    assert.equal(resAcme.statusCode, 403);
  } finally {
    await app.close();
  }
});
