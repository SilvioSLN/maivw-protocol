import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { createChallenge, validChallenge } from '../src/services/OnboardingChallenge.js';
process.env.JWT_SECRET = 'access-control-test-secret-only';
const {authRoutes} = await import('../src/routes/auth.js');
const {onboardingRoutes} = await import('../src/routes/onboarding.js');
const secret = process.env.JWT_SECRET;
const user = {id:1,email:'ann@example.com',role:'user'};
const admin = {id:1,email:'admin@example.com',role:'admin'};
const headers = (claims: any) => ({authorization:`Bearer ${jwt.sign(claims,secret)}`});
const methods = [
  {method:'GET',url:'/api/v1/inbox/messages?email=victim@example.com'},
  {method:'PATCH',url:'/api/v1/inbox/messages/1',payload:{isRead:true}},
  {method:'PATCH',url:'/api/v1/inbox/messages/1/restore'},
  {method:'DELETE',url:'/api/v1/inbox/messages/1?permanent=true'},
  {method:'DELETE',url:'/api/v1/inbox/trash/empty?email=victim@example.com'},
] as const;
async function mailboxFixture(active = true, storedUser: any = user, to = 'joann@example.com') {
  const reads: any[] = [], writes: any[] = [];
  const message = {id:1,messageId:'message-1',to,from:'sender@example.net',status:'trash'};
  const prisma: any = {
    user:{findUnique:async()=>storedUser},emailAccount:{findFirst:async()=>active?{id:1}:null},
    message:{findFirst:async()=>message,findMany:async(args:any)=>{reads.push(args);return [];},count:async(args:any)=>{reads.push(args);return 0;},update:async(args:any)=>{writes.push(args);return {...message,...args.data};},delete:async(args:any)=>{writes.push(args);return message;},deleteMany:async(args:any)=>{writes.push(args);return {count:0};}},
  };
  const app=Fastify(); await app.register(authRoutes,{prisma,kms:{} as any});
  return {app,reads,writes};
}
test('mailbox operations reject anonymous, malformed sessions, disabled accounts and administrators',async()=>{
  for(const scenario of ['anonymous','malformed','disabled','admin','deleted']) {
    const {app,writes,reads}=await mailboxFixture(scenario!=='disabled',scenario==='deleted'?null:scenario==='admin'?admin:user);
    try {
      for(const operation of methods) {
        const response=await app.inject({...operation,headers:scenario==='anonymous'?{}:headers(scenario==='malformed'?{email:user.email}:scenario==='admin'?admin:user)});
        assert.equal(response.statusCode,['anonymous','malformed'].includes(scenario)?401:403,`${scenario} ${operation.url}`);
      }
      assert.equal(writes.length+reads.length,0);
    } finally {await app.close();}
  }
});
test('mailbox mutations reject another address containing the session address',async()=>{
  const {app,writes}=await mailboxFixture();
  try {
    for(const operation of methods.slice(1,4)) assert.ok([403,404].includes((await app.inject({...operation,headers:headers(user)})).statusCode));
    assert.equal(writes.length,0);
  } finally {await app.close();}
});
test('listing, counts and empty-trash use exact session address, ignoring supplied email',async()=>{
  const {app,reads,writes}=await mailboxFixture();
  try {
    for(const folder of ['inbox','sent','spam','trash']) assert.equal((await app.inject({method:'GET',url:`/api/v1/inbox/messages?folder=${folder}&email=victim@example.com`,headers:headers(user)})).statusCode,200);
    assert.equal((await app.inject({...methods[4],headers:headers(user)})).statusCode,200);
    for(const query of [...reads,...writes]) {
      const text=JSON.stringify(query);
      assert.ok(text.includes('"equals":"ann@example.com"'));
      assert.ok(!text.includes('contains')&&!text.includes('victim'));
    }
    assert.equal((await app.inject({method:'GET',url:'/api/v1/inbox/messages?limit=-1',headers:headers(user)})).statusCode,400);
  } finally {await app.close();}
});
test('active owner can update, restore and delete; unknown status is rejected',async()=>{
  const {app,writes}=await mailboxFixture(true,user,user.email);
  try {
    for(const operation of methods.slice(1,4)) assert.equal((await app.inject({...operation,headers:headers(user)})).statusCode,200);
    assert.equal(writes.length,3);
    assert.equal((await app.inject({method:'PATCH',url:'/api/v1/inbox/messages/1',headers:headers(user),payload:{status:'sent'}})).statusCode,400);
  } finally {await app.close();}
});
test('DNS challenges expire and bind domain, user and signing secret',()=>{
  const now=Date.now(), token=createChallenge('example.com',1,secret,now);
  assert.equal(validChallenge(token,'example.com',1,secret,now),true);
  assert.equal(validChallenge(token,'other.example',1,secret,now),false);
  assert.equal(validChallenge(token,'example.com',2,secret,now),false);
  assert.equal(validChallenge(token,'example.com',1,'wrong',now),false);
  assert.equal(validChallenge(token,'example.com',1,secret,now+1800000),false);
  assert.equal(validChallenge('fake','example.com',1,secret,now),false);
});
async function onboardingFixture({owner=1,validReceipt=false,dns=false,local=false}:{owner?:number,validReceipt?:boolean,dns?:boolean,local?:boolean}={}) {
  const writes:any[]=[]; let token='';
  const domain={id:1,userId:owner,domainName:'example.com',isVerified:false}, key=`0x${'1'.repeat(40)}`;
  const prisma:any={user:{findUnique:async()=>admin},domain:{findUnique:async()=>domain,upsert:async(args:any)=>{writes.push(args);return domain;},update:async(args:any)=>{writes.push(args);return domain;}},walletVault:{findUnique:async()=>({publicKey:key})}};
  const app=Fastify();
  await app.register(onboardingRoutes,{prisma,kms:{provisionWalletForDomain:async()=>({publicKey:key})} as any,oracle:{getOracleAddress:()=>key,generateRegistrationProof:async()=>'proof',registerCompanyOnChain:async()=>`0x${'2'.repeat(64)}`} as any,ledger:{isDomainRegistered:async()=>false,getOracleNode:async()=>key,getContractAddress:()=>key,verifyRegistration:async()=>validReceipt} as any,config:{JWT_SECRET:secret,CHAIN_ID:31337,RPC_URL:local?'http://anvil:8545':'https://rpc.example.com',MAIVW_CORE_DOMAIN:'example.com',DEFAULT_P2P_ENDPOINT:local?'http://gateway:3001/api/v1/inbox':undefined} as any,resolveTxt:async()=>dns?[[`maivw-verification=${token}`]]:[]});
  token=createChallenge('example.com',1,secret);
  return {app,writes,token};
}
test('onboarding rejects anonymous callers, account/domain substitution, simulation and wrong chains',async()=>{
  for(const owner of [1,2]) {
    const {app,writes,token}=await onboardingFixture({owner});
    try {
      for(const route of ['challenge','check-dns','verify-and-register','claim-proof','finalize-web3-registration','complete']) assert.equal((await app.inject({method:'POST',url:`/api/v1/onboarding/${route}`,payload:{}})).statusCode,401);
      for(const extra of [{userId:2},{simulate:true},{simulateDns:true},{targetChainId:1},{token:'forged'},{endpointUrl:'http://gateway:3001/api/v1/inbox'}]) {
        const res=await app.inject({method:'POST',url:'/api/v1/onboarding/verify-and-register',headers:headers(admin),payload:{domainName:'example.com',userId:1,token,...extra}});
        assert.ok([400,403].includes(res.statusCode));
      }
      assert.equal(writes.length,0);
    } finally {await app.close();}
  }
});
test('proof issuance requires DNS and never marks domain verified',async()=>{
  for(const dns of [false,true]) {
    const {app,writes,token}=await onboardingFixture({dns});
    try {
      const res=await app.inject({method:'POST',url:'/api/v1/onboarding/claim-proof',headers:headers(admin),payload:{domainName:'example.com',userId:1,token,callerAddress:`0x${'3'.repeat(40)}`,targetChainId:31337}});
      assert.equal(res.statusCode,dns?200:400,res.body);
      if(dns) assert.equal(writes[0].create.isVerified,false); else assert.equal(writes.length,0);
    } finally {await app.close();}
  }
});
test('local Anvil demo bypasses public DNS and permits its internal HTTP endpoint',async()=>{
  const {app,writes,token}=await onboardingFixture({local:true,dns:false});
  try {
    const mode=await app.inject({method:'GET',url:'/api/v1/onboarding/node-mode'});
    assert.equal(mode.statusCode,200);
    assert.equal(mode.json().dnsMode,'local-demo');
    assert.equal(mode.json().defaultEndpoint,'http://gateway:3001/api/v1/inbox');

    const dnsResult=await app.inject({method:'POST',url:'/api/v1/onboarding/check-dns',headers:headers(admin),payload:{domainName:'example.com',token}});
    assert.equal(dnsResult.statusCode,200,dnsResult.body);
    assert.equal(dnsResult.json().localBypass,true);

    const proof=await app.inject({method:'POST',url:'/api/v1/onboarding/claim-proof',headers:headers(admin),payload:{domainName:'example.com',userId:1,token,callerAddress:`0x${'3'.repeat(40)}`,endpointUrl:'http://gateway:3001/api/v1/inbox',targetChainId:31337}});
    assert.equal(proof.statusCode,200,proof.body);
    assert.equal(writes.some(write=>write.data?.isVerified===true),false);
  } finally {await app.close();}
});
test('activation requires matching receipt in finalization and relayer flows',async()=>{
  for(const validReceipt of [false,true]) for(const route of ['finalize-web3-registration','verify-and-register']) {
    const {app,writes,token}=await onboardingFixture({validReceipt,dns:true});
    try {
      const payload=route==='verify-and-register'?{domainName:'example.com',userId:1,token}:{domainId:1,txHash:`0x${'2'.repeat(64)}`};
      const res=await app.inject({method:'POST',url:`/api/v1/onboarding/${route}`,headers:headers(admin),payload});
      assert.equal(res.statusCode,validReceipt?(route==='verify-and-register'?201:200):409,res.body);
      assert.equal(writes.some(w=>w.data?.isVerified===true),validReceipt);
    } finally {await app.close();}
  }
});
test('legacy provisioning endpoints cannot create domains or keys',async()=>{
  const {app,writes}=await mailboxFixture();
  try {assert.equal((await app.inject({method:'POST',url:'/api/v1/domains',payload:{domainName:'example.com',userId:1,isVerified:true}})).statusCode,410);assert.equal(writes.length,0);} finally {await app.close();}
  const onboard=await onboardingFixture();
  try {assert.equal((await onboard.app.inject({method:'POST',url:'/api/v1/onboarding/fulfill-registration',payload:{domain:'example.com',userId:1}})).statusCode,503);assert.equal(onboard.writes.length,0);} finally {await onboard.app.close();}
});
