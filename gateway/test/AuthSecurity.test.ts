import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { hashPassword, verifyPassword, NewPasswordSchema } from '../src/services/PasswordService.js';
process.env.JWT_SECRET = 'test-secret-only-not-for-deployment';
const { authRoutes } = await import('../src/routes/auth.js');
const invitation = 'test-invitation-token-at-least-32-characters';
const password = 'a long test password';
async function fixture(identity: any = null, existing: any = null, token?: string) {
  const writes: any[] = [];
  const prisma: any = {
    user: { findUnique: async () => existing, create: async ({data}: any) => { writes.push(data); return {id:1,...data}; }, updateMany: async (data: any) => { writes.push(data); return {count:1}; } },
    emailAccount: {findFirst: async () => null}, domain: {findUnique: async () => null},
  };
  const app = Fastify();
  await app.register(authRoutes, {prisma, kms: {} as any, registrationToken: token,
    verifyIdentityToken: async () => { if (!identity) throw new Error('invalid'); return identity; }});
  return {app,writes};
}
test('password hashing uses salts, rejects wrong/malformed values and reads legacy hashes', async () => {
  const first = await hashPassword(password);
  assert.notEqual(first, await hashPassword(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong', first), false);
  assert.equal(await verifyPassword(password, 'broken'), false);
  const salt = 'a'.repeat(32);
  const legacy = `${salt}:${createHash('sha256').update(salt+password).digest('hex')}`;
  assert.equal(await verifyPassword(password, legacy), true);
  assert.equal(NewPasswordSchema.safeParse('short').success, false);
  assert.equal(NewPasswordSchema.safeParse('x'.repeat(129)).success, false);
});
test('social login rejects missing, invalid, unverified and unsupported identities without writes', async () => {
  for (const identity of [null, {email:'admin@example.com',email_verified:false,firebase:{sign_in_provider:'google.com'}}, {email:'admin@example.com',email_verified:true,firebase:{sign_in_provider:'password'}}]) {
    const {app,writes} = await fixture(identity);
    try {
      for (const body of [{email:'admin@example.com'}, {idToken:'forged',email:'admin@example.com'}]) {
        const response = await app.inject({method:'POST',url:'/api/v1/auth/google',payload:body});
        assert.equal(response.statusCode,401);
      }
      assert.equal(writes.length,0);
    } finally { await app.close(); }
  }
});
test('social login trusts verified claims only and new administrators require invitation', async () => {
  const identity = {email:'verified@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
  for (const existing of [null, {id:1,email:identity.email,role:'admin'}]) {
    const {app,writes} = await fixture(identity,existing);
    try {
      const response = await app.inject({method:'POST',url:'/api/v1/auth/google',payload:{idToken:'verified',email:'forged@example.com'}});
      assert.equal(response.statusCode,existing?200:403);
      if(existing) assert.equal(response.json().email, identity.email);
      assert.equal(writes.length,0);
    } finally { await app.close(); }
  }
});
test('administrator registration is closed by default and invitation stores scrypt', async () => {
  for (const token of [undefined, invitation]) {
    const {app,writes} = await fixture(null,null,token);
    try {
      const denied = await app.inject({method:'POST',url:'/api/v1/auth/register',payload:{email:'admin@example.com',password}});
      assert.equal(denied.statusCode,403);
      const response = await app.inject({method:'POST',url:'/api/v1/auth/register',payload:{email:'admin@example.com',password,registrationToken:invitation}});
      assert.equal(response.statusCode,token?201:403);
      if(token) assert.equal(await verifyPassword(password,writes[0].passwordHash),true);
      else assert.equal(writes.length,0);
    } finally {await app.close();}
  }
});
test('legacy password upgrades only after successful authentication', async () => {
  const salt='b'.repeat(32);
  const existing={id:1,email:'admin@example.com',role:'admin',passwordHash:`${salt}:${createHash('sha256').update(salt+password).digest('hex')}`};
  const {app,writes}=await fixture(null,existing);
  try {
    const bad=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:existing.email,password:'wrong'}});
    assert.equal(bad.statusCode,401); assert.equal(writes.length,0);
    const good=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:existing.email,password}});
    assert.equal(good.statusCode,200); assert.equal(writes.length,1);
    assert.equal(await verifyPassword(password,writes[0].data.passwordHash),true);
  } finally {await app.close();}
});
test('onboarding completion rejects anonymous access, foreign domains and existing mailboxes', async () => {
  const {onboardingRoutes} = await import('../src/routes/onboarding.js');
  const {default:jwt} = await import('jsonwebtoken');
  const token=jwt.sign({id:1,email:'admin@example.com',role:'admin'},process.env.JWT_SECRET!);
  for(const scenario of ['anonymous','foreign','existing']) {
    let writes=0;
    const app=Fastify();
    const prisma:any={domain:{findUnique:async()=>({id:1,userId:scenario==='foreign'?2:1,isVerified:true,domainName:'example.com'})},emailAccount:{findUnique:async()=>({id:1})},user:{findUnique:async()=>({id:1,email:"admin@example.com",role:"admin"}),create:async()=>{writes++;}}};
    await app.register(onboardingRoutes,{prisma,kms:{} as any,ledger:{} as any,oracle:{} as any} as any);
    try {
      const response=await app.inject({method:'POST',url:'/api/v1/onboarding/complete',headers:scenario==='anonymous'?{}:{authorization:`Bearer ${token}`},payload:{domainId:1,localPart:'mail',password,purpose:'webmail'}});
      assert.equal(response.statusCode,scenario==='anonymous'?401:scenario==='foreign'?404:409);
      assert.equal(writes,0);
    } finally {await app.close();}
  }
});
