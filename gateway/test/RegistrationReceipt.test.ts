import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import { LedgerService } from '../src/services/LedgerService.js';
const registry=`0x${'1'.repeat(40)}` as const;
const key=`0x${'2'.repeat(40)}` as const;
const hash=`0x${'3'.repeat(64)}` as const;
const endpoint='https://mail.example.com/api/v1/inbox';
const abi=parseAbi(['event CompanyRegistered(bytes32 indexed domainHash, string domain, address publicKey, address adminKey, bool isProvider, uint256 feePaid, uint256 timestamp)']);
function receipt(domain='example.com',publicKey=key) {
  return {status:'success',to:registry,logs:[{address:registry,topics:encodeEventTopics({abi,eventName:'CompanyRegistered',args:{domainHash:hash}}),data:encodeAbiParameters([{type:'string'},{type:'address'},{type:'address'},{type:'bool'},{type:'uint256'},{type:'uint256'}],[domain,publicKey,key,false,1n,1n])}]};
}
test('registration receipt checks chain, success, Registry, exact domain/key and current endpoint',async()=>{
  for(const scenario of ['valid','chain','reverted','recipient','emitter','domain','key','missing-event','current-key','endpoint','pending']) {
    const ledger=new LedgerService({RPC_URL:'http://localhost:8545',CHAIN_ID:31337,REGISTRY_CONTRACT_ADDRESS:registry} as any);
    const data:any=receipt(scenario==='domain'?'foreign.example':'example.com',scenario==='key'?registry:key);
    if(scenario==='reverted') data.status='reverted';
    if(scenario==='recipient') data.to=key;
    if(scenario==='emitter') data.logs[0].address=key;
    if(scenario==='missing-event') data.logs=[];
    (ledger.getAdapter(ledger.getPrimaryNetworkId()) as any).client={getChainId:async()=>scenario==='chain'?1:31337,waitForTransactionReceipt:async()=>{if(scenario==='pending') throw new Error('timeout');return data;},readContract:async({functionName}:any)=>functionName==='getPublicKey'?(scenario==='current-key'?registry:key):(scenario==='endpoint'?'https://other.example':endpoint)};
    if(scenario==='pending') await assert.rejects(ledger.verifyRegistration(hash,'example.com',key,endpoint));
    else assert.equal(await ledger.verifyRegistration(hash,'example.com',key,endpoint),scenario==='valid',scenario);
  }
});
