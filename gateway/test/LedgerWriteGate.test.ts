import test from 'node:test';
import assert from 'node:assert/strict';
import { LedgerWriteGate } from '../src/multichain/LedgerWriteGate.js';
import { policyBoundBroadcaster, policyBoundSigner } from '../src/multichain/PolicyBoundSubmission.js';

test('shipped policy allows canonical canary IDs and rejects mainnets without Cloud files', () => {
  const gate = new LedgerWriteGate();
  for (const id of ['evm:84532', 'evm:421614', 'evm:80002', 'evm:31337', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG']) assert.doesNotThrow(() => gate.assertCanWrite(id));
  for (const id of ['evm:8453', 'evm:42161', 'evm:137', 'evm:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d']) assert.throws(() => gate.assertCanWrite(id), { code: 'MAINNET_WRITES_DISABLED' });
  assert.throws(() => gate.assertCanWrite('evm:999999'), { code: 'UNKNOWN_NETWORK' });
});

test('explicit missing/invalid policy fails closed instead of silently enabling defaults', () => {
  assert.throws(() => new LedgerWriteGate('/tmp/nonexistent-maivw-policy-test.json'));
  assert.throws(() => new LedgerWriteGate({ version: '1', networks: [] }));
});

test('a configured denial overrides the local chain policy', () => {
  const gate = new LedgerWriteGate({ version: '1', networks: [{ id: 'local', name: 'Local', chainId: 31337, readOnly: true, writesEnabled: false, status: 'PAUSED' }] });
  assert.throws(() => gate.assertCanWrite('evm:31337'), { code: 'MAINNET_WRITES_DISABLED' });
});

test('runtime wrappers reject signing and broadcasting disabled EVM/Solana destinations before touching clients', async () => {
  let calls = 0;
  for (const networkId of ['evm:8453','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d']) {
    const adapter = policyBoundBroadcaster(networkId, { broadcast: async () => { calls++; return {transactionId:'unexpected'}; }, checkFinality: async()=>({status:'PENDING'}) });
    await assert.rejects(adapter.broadcast({ signedPayload:'0x00' } as any), {code:'MAINNET_WRITES_DISABLED'});
    const signer = policyBoundSigner({sign:async()=>{calls++;return {} as any;}});
    await assert.rejects(signer.sign({networkId} as any), {code:'MAINNET_WRITES_DISABLED'});
  }
  assert.equal(calls,0);
});
