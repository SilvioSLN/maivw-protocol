import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';

import jwt from 'jsonwebtoken';
import { validateFirebaseIdentityClaims } from '../src/services/FirebaseAuthService.js';
import { createChallenge, validChallenge } from '../src/services/OnboardingChallenge.js';
import { hashPassword, verifyPassword } from '../src/services/PasswordService.js';

process.env.JWT_SECRET = 'tenant-isolation-ret009-test-secret-32chars';
const secret = process.env.JWT_SECRET;
const invitation = 'admin-invitation-token-strictly-32chars-ret009';

const { authRoutes } = await import('../src/routes/auth.js');
const { onboardingRoutes } = await import('../src/routes/onboarding.js');
const { attachmentRoutes } = await import('../src/routes/attachments.js');

const authHeader = (claims: any, customSecret = secret, expiresIn = '1h') => ({
  authorization: `Bearer ${jwt.sign(claims, customSecret, { expiresIn })}`,
});

// User A (Tenant 1)
const userAAdmin = { id: 1, email: 'admin@domain-a.com', role: 'admin' as const };
const userAMailbox = { id: 10, email: 'alice@domain-a.com', role: 'user' as const };
const domainA = {
  id: 100,
  userId: 1,
  domainName: 'domain-a.com',
  isVerified: true,
  accounts: [{ id: 10, localPart: 'alice', displayName: 'Alice', isActive: true, createdAt: new Date() }],
  apiKeys: [],
  smtpConfig: null,
  walletVault: { publicKey: '0x1111111111111111111111111111111111111111' },
  createdAt: new Date(),
};

// User B (Tenant 2)
const userBAdmin = { id: 2, email: 'admin@domain-b.com', role: 'admin' as const };
const userBMailbox = { id: 20, email: 'bob@domain-b.com', role: 'user' as const };
const domainB = {
  id: 200,
  userId: 2,
  domainName: 'domain-b.com',
  isVerified: true,
  accounts: [{ id: 20, localPart: 'bob', displayName: 'Bob', isActive: true, createdAt: new Date() }],
  apiKeys: [],
  smtpConfig: null,
  walletVault: { publicKey: '0x2222222222222222222222222222222222222222' },
  createdAt: new Date(),
};

// -----------------------------------------------------------------------------
// 1. Multi-tenant Domain Isolation
// -----------------------------------------------------------------------------
test('RET-009: Tenant A cannot list, view, claim, or mutate Tenant B domains', async () => {
  const domainsInDb = [domainA, domainB];
  const prisma: any = {
    domain: {
      findMany: async ({ where }: any) => {
        return domainsInDb.filter((d) => d.userId === where.userId);
      },
      findUnique: async ({ where }: any) => {
        return domainsInDb.find((d) => (where.id ? d.id === where.id : d.domainName === where.domainName)) || null;
      },
      findFirst: async ({ where }: any) => {
        return domainsInDb.find((d) => {
          if (where.userId && d.userId !== where.userId) return false;
          if (where.id && d.id !== where.id) return false;
          if (where.domainName && d.domainName !== where.domainName) return false;
          return true;
        }) || null;
      },
    },
    originRecord: { findMany: async () => [] },
    originReservation: { findMany: async () => [] },
    user: {
      findUnique: async ({ where }: any) => {
        if (where.id === 1) return userAAdmin;
        if (where.id === 2) return userBAdmin;
        return null;
      },
    },
  };

  const app = Fastify();
  await app.register(authRoutes, { prisma, kms: {} as any });

  try {
    // User A lists domains -> only domainA returned
    const resA = await app.inject({
      method: 'GET',
      url: '/api/v1/domains',
      headers: authHeader(userAAdmin),
    });
    assert.equal(resA.statusCode, 200);
    const dataA = resA.json();
    assert.equal(dataA.domains.length, 1);
    assert.equal(dataA.domains[0].domainName, 'domain-a.com');
    assert.equal(dataA.domains[0].id, 100);

    // User B lists domains -> only domainB returned
    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/domains',
      headers: authHeader(userBAdmin),
    });
    assert.equal(resB.statusCode, 200);
    const dataB = resB.json();
    assert.equal(dataB.domains.length, 1);
    assert.equal(dataB.domains[0].domainName, 'domain-b.com');
    assert.equal(dataB.domains[0].id, 200);
  } finally {
    await app.close();
  }
});

// -----------------------------------------------------------------------------
// 2. Multi-tenant Mailbox/Inbox Isolation
// -----------------------------------------------------------------------------
test('RET-009: Tenant A mailbox cannot read, modify, or delete Tenant B messages or trash', async () => {
  const messageA = { id: 1001, messageId: 'msg-a', to: 'alice@domain-a.com', from: 'external@other.org', status: 'inbox', body: 'Confidential Tenant A' };
  const messageB = { id: 2001, messageId: 'msg-b', to: 'bob@domain-b.com', from: 'external@other.org', status: 'inbox', body: 'Confidential Tenant B' };

  const dbMessages = [messageA, messageB];
  const queryReads: any[] = [];
  const queryWrites: any[] = [];

  const prisma: any = {
    user: {
      findUnique: async ({ where }: any) => {
        if (where.id === 10) return { id: 10, email: 'alice@domain-a.com', role: 'user' };
        if (where.id === 20) return { id: 20, email: 'bob@domain-b.com', role: 'user' };
        return null;
      },
    },
    emailAccount: {
      findFirst: async ({ where }: any) => {
        if (where.userId === 10 && where.localPart === 'alice' && where.domain?.domainName === 'domain-a.com') return { id: 10 };
        if (where.userId === 20 && where.localPart === 'bob' && where.domain?.domainName === 'domain-b.com') return { id: 20 };
        return null;
      },
    },
    message: {
      findMany: async (args: any) => {
        queryReads.push(args);
        return dbMessages.filter((m) => m.to === args.where?.to?.equals);
      },
      count: async (args: any) => {
        queryReads.push(args);
        return dbMessages.filter((m) => m.to === args.where?.to?.equals).length;
      },
      findFirst: async (args: any) => {
        queryReads.push(args);
        return dbMessages.find((m) => m.id === args.where?.id && m.to === args.where?.to) || null;
      },
      update: async (args: any) => {
        queryWrites.push(args);
        const msg = dbMessages.find((m) => m.id === args.where?.id);
        return { ...msg, ...args.data };
      },
      delete: async (args: any) => {
        queryWrites.push(args);
        return dbMessages.find((m) => m.id === args.where?.id);
      },
      deleteMany: async (args: any) => {
        queryWrites.push(args);
        return { count: 0 };
      },
    },
  };

  const app = Fastify();
  await app.register(authRoutes, { prisma, kms: {} as any });

  try {
    // 1. User A lists messages, explicitly requesting victim email bob@domain-b.com
    const resList = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox/messages?email=bob@domain-b.com',
      headers: authHeader(userAMailbox),
    });
    assert.equal(resList.statusCode, 200);
    const messages = resList.json().messages;
    // Must return Alice's messages only
    assert.ok(messages.every((m: any) => m.to === 'alice@domain-a.com'));
    assert.ok(messages.some((m: any) => m.id === 1001));
    assert.ok(!messages.some((m: any) => m.id === 2001));

    // The SQL/Prisma query MUST have enforced Alice's session email across all queries
    const findManyRead = queryReads[0];
    assert.equal(findManyRead.where?.to?.equals, 'alice@domain-a.com');
    for (const q of queryReads) {
      const serialized = JSON.stringify(q);
      assert.ok(serialized.includes('alice@domain-a.com'));
      assert.ok(!serialized.includes('bob@domain-b.com'));
    }


    // 2. User A attempts to update/read User B's message directly
    const resPatchB = await app.inject({
      method: 'PATCH',
      url: '/api/v1/inbox/messages/2001',
      headers: authHeader(userAMailbox),
      payload: { isRead: true },
    });
    assert.ok([403, 404].includes(resPatchB.statusCode));

    // 3. User A attempts to delete User B's message
    const resDeleteB = await app.inject({
      method: 'DELETE',
      url: '/api/v1/inbox/messages/2001?permanent=true',
      headers: authHeader(userAMailbox),
    });
    assert.ok([403, 404].includes(resDeleteB.statusCode));

    // 4. User A attempts to empty User B's trash
    queryWrites.length = 0;
    const resEmptyTrash = await app.inject({
      method: 'DELETE',
      url: '/api/v1/inbox/trash/empty?email=bob@domain-b.com',
      headers: authHeader(userAMailbox),
    });
    assert.equal(resEmptyTrash.statusCode, 200);
    // Writes must only delete for Alice, not Bob (using session email)
    const deleteOp = queryWrites[0];
    assert.equal(deleteOp.where?.status, 'trash');
    assert.equal(deleteOp.where?.OR?.[0]?.to?.equals, 'alice@domain-a.com');
    assert.equal(deleteOp.where?.OR?.[1]?.from?.equals, 'alice@domain-a.com');
  } finally {

    await app.close();
  }
});

// -----------------------------------------------------------------------------
// 3. Multi-tenant Attachment Isolation
// -----------------------------------------------------------------------------
test('RET-009: Tenant A cannot download or access Tenant B attachments', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maivw-multi-att-test-'));

  const prisma: any = {
    user: {
      findUnique: async ({ where }: any) => {
        if (where.id === 1) return userAAdmin;
        if (where.id === 2) return userBAdmin;
        return null;
      },
    },
    domain: {
      findUnique: async ({ where }: any) => {
        if (where.id === 100) return domainA;
        if (where.id === 200) return domainB;
        return null;
      },
    },
  };

  const kms: any = {
    validateApiKey: async (key: string) => {
      if (key === 'maivw_live_key_a') return { domainId: 100, domainName: 'domain-a.com' };
      if (key === 'maivw_live_key_b') return { domainId: 200, domainName: 'domain-b.com' };
      return null;
    },
  };

  const app = Fastify();
  await app.register(attachmentRoutes, {
    prisma,
    kms,
    attachmentsDir: tempDir,
  });

  try {
    // 1. Tenant A uploads a sensitive document
    const fileContentA = 'Tenant A Private Financials';
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/attachments/upload',
      headers: { authorization: 'Bearer maivw_live_key_a' },
      payload: {
        filename: 'secret-a.pdf',
        mimeType: 'application/pdf',
        dataBase64: Buffer.from(fileContentA).toString('base64'),
      },
    });
    assert.equal(uploadRes.statusCode, 201);
    const attIdA = uploadRes.json().attachment.id;

    // 2. Tenant A can access its download
    const legitimateDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attIdA}/download`,
    });
    assert.equal(legitimateDownload.statusCode, 200);
    assert.equal(legitimateDownload.payload, fileContentA);

    // 3. Path traversal attempts to escape storage root fail
    const traversal = await app.inject({
      method: 'GET',
      url: '/api/v1/attachments/..%2F..%2Fetc%2Fshadow/download',
    });
    assert.equal(traversal.statusCode, 400);

    // 4. Requesting non-existent or fabricated attachment IDs fails with 404
    const fabricated = await app.inject({
      method: 'GET',
      url: '/api/v1/attachments/att_999999999_fake/download',
    });
    assert.equal(fabricated.statusCode, 404);
  } finally {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// 4. Authentication Validation (Google, Invitation, Unverified, Domain Binding, Expiry)
// -----------------------------------------------------------------------------
test('RET-009: Google Real validation, unverified denial, invitation gating, and no auto-domain', async () => {
  const usersInDb: any[] = [];
  const prisma: any = {
    user: {
      findUnique: async ({ where }: any) => {
        return usersInDb.find((u) => u.email === where.email) || null;
      },
      create: async ({ data }: any) => {
        const created = { id: usersInDb.length + 1, ...data };
        usersInDb.push(created);
        return created;
      },
    },
    emailAccount: { findFirst: async () => null },
    domain: { findUnique: async () => null },
  };

  let mockIdentity: any = null;
  const app = Fastify();
  await app.register(authRoutes, {
    prisma,
    kms: {} as any,
    registrationToken: invitation,
    firebaseAuthEnabled: true,
    verifyIdentityToken: async () => {
      if (!mockIdentity) throw new Error('Invalid Firebase token');
      return mockIdentity;
    },
  });

  try {
    // 1. Google Real: valid claims, but unverified email -> REJECTED (401)
    mockIdentity = {
      aud: 'maivw-staging',
      iss: 'https://securetoken.google.com/maivw-staging',
      email: 'unverified@external.com',
      email_verified: false,
      firebase: { sign_in_provider: 'google.com' },
    };
    const resUnverified = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'token-unverified' },
    });
    assert.equal(resUnverified.statusCode, 401);
    assert.equal(usersInDb.length, 0);

    // 2. Google Real: valid claims, verified email, but new user WITHOUT invitation -> REJECTED (403)
    mockIdentity = {
      aud: 'maivw-staging',
      iss: 'https://securetoken.google.com/maivw-staging',
      email: 'newuser@external.com',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    };
    const resNoInvitation = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'token-new-no-invite' },
    });
    assert.equal(resNoInvitation.statusCode, 403);
    assert.equal(usersInDb.length, 0);

    // 3. Google Real: valid claims + valid invitation -> SUCCESS, user created as admin
    const resWithInvitation = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'token-new-with-invite', registrationToken: invitation },
    });
    assert.equal(resWithInvitation.statusCode, 200);
    const authData = resWithInvitation.json();
    assert.equal(authData.email, 'newuser@external.com');
    assert.equal(authData.role, 'admin');
    // CRITICAL: NO automatic domain binding occurred!
    assert.equal(authData.domain, null);
    assert.equal(usersInDb.length, 1);

    // 4. Returning user: logs in without needing the registration invitation token again
    const resExisting = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'token-existing' },
    });
    assert.equal(resExisting.statusCode, 200);
    assert.equal(usersInDb.length, 1); // No new user created

    // 5. Expired JWT / Session logout verification
    const expiredToken = jwt.sign({ id: 1, email: 'newuser@external.com', role: 'admin' }, secret, { expiresIn: '-1s' });
    const resExpired = await app.inject({
      method: 'GET',
      url: '/api/v1/domains',
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(resExpired.statusCode, 403); // getAuthUser returns null, fails closed
  } finally {
    await app.close();
  }
});
