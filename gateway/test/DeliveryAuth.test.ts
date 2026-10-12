import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
process.env.JWT_SECRET='delivery-test-secret-not-production';
const {sendRoutes}=await import('../src/routes/send.js');
const {contactsRoutes}=await import('../src/routes/contacts.js');
const user={id:1,email:'alice@example.com',role:'user'};
const session=jwt.sign(user,process.env.JWT_SECRET);
const payload={to:'recipient@example.net',subject:'Test',msgClass:'CONVERSATION',content:{text:'Test only'}};
async function fixture(active=true,verified=true) {
  const deliveries:any[]=[], contacts:any[]=[];
  const prisma:any={user:{findUnique:async()=>user},emailAccount:{findFirst:async()=>active?{id:1}:null},domain:{findUnique:async()=>({id:1,domainName:'example.com',isVerified:verified}),findFirst:async(args:any)=>{contacts.push(args);return {domainName:'example.com',accounts:[]};}},message:{create:async()=>({id:1}),findMany:async(args:any)=>{contacts.push(args);return [];}}};
  const app=Fastify();
  await app.register(sendRoutes,{prisma,kms:{validateApiKey:async(token:string)=>token==='maivw_live_valid'?{domainId:1,domainName:'example.com'}:null} as any,ledger:{isDomainRegistered:async(domain:string)=>domain==='example.com',getAllowedDailyVolume:async()=>0n} as any,signer:{} as any,smtp:{sendEmail:async(...args:any[])=>{deliveries.push(args);return {success:true,provider:'test'};}} as any,senderDomain:'fallback.example'});
  await app.register(contactsRoutes,{prisma,jwtSecret:process.env.JWT_SECRET!});
  return {app,deliveries,contacts};
}
test('send requires credential and rejects invalid or disabled sessions before delivery',async()=>{
  for(const token of [undefined,'invalid','maivw_live_invalid',session]) {
    const {app,deliveries}=await fixture(false);
    try {
      const res=await app.inject({method:'POST',url:'/api/v1/send',headers:token?{authorization:`Bearer ${token}`}:{},payload});
      assert.equal(res.statusCode,401,res.body); assert.equal(deliveries.length,0);
    } finally {await app.close();}
  }
});
test('session binds sender to mailbox; API key binds sender to verified domain',async()=>{
  for(const token of [session,'maivw_live_valid']) {
    const {app,deliveries}=await fixture();
    try {
      for(const extra of [{from:'attacker@foreign.example'},{senderEmail:'attacker@foreign.example'},{senderDomain:'foreign.example'},...(token===session?[{from:'bob@example.com'}]:[])]) {
        const res=await app.inject({method:'POST',url:'/api/v1/send',headers:{authorization:`Bearer ${token}`},payload:{...payload,...extra}});
        assert.equal(res.statusCode,403,res.body);
      }
      assert.equal(deliveries.length,0);
      const res=await app.inject({method:'POST',url:'/api/v1/send',headers:{authorization:`Bearer ${token}`},payload:{...payload,from:'alice@example.com'}});
      assert.equal(res.statusCode,200,res.body);
      assert.equal(deliveries.length,1);assert.equal(deliveries[0][3],'example.com');assert.equal(deliveries[0][5],user.email);
    } finally {await app.close();}
  }
  const {app,deliveries}=await fixture(true,false);
  try {assert.equal((await app.inject({method:'POST',url:'/api/v1/send',headers:{authorization:'Bearer maivw_live_valid'},payload})).statusCode,403);assert.equal(deliveries.length,0);} finally {await app.close();}
});
test('contacts require active mailbox, deny foreign directories and scope recent conversations exactly',async()=>{
  const {app,contacts}=await fixture();
  try {
    assert.equal((await app.inject({method:'GET',url:'/api/v1/contacts/autocomplete?domain=example.com'})).statusCode,401);
    assert.equal((await app.inject({method:'GET',url:'/api/v1/contacts/autocomplete?domain=foreign.example',headers:{authorization:`Bearer ${session}`}})).statusCode,403);
    assert.equal(contacts.length,0);
    assert.equal((await app.inject({method:'GET',url:'/api/v1/contacts/autocomplete',headers:{authorization:`Bearer ${session}`}})).statusCode,200);
    assert.equal(contacts[0].where.domainName,'example.com');
    assert.ok(JSON.stringify(contacts[1]).includes('"equals":"alice@example.com"'));
    assert.ok(!JSON.stringify(contacts[1]).includes('contains'));
  } finally {await app.close();}
});
