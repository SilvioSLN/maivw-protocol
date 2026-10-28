import type { RelayBroadcastAdapter } from './RelaySubmission.js';
import type { PreparedRelayTransactionSigner } from './RelayFanout.js';
import { defaultLedgerWriteGate, type LedgerWriteGate } from './LedgerWriteGate.js';

export function policyBoundBroadcaster(networkId: string, adapter: RelayBroadcastAdapter, gate: LedgerWriteGate = defaultLedgerWriteGate): RelayBroadcastAdapter {
  return {
    broadcast: async input => { gate.assertCanWrite(networkId, 'broadcast'); return adapter.broadcast(input); },
    checkFinality: input => adapter.checkFinality(input),
  };
}
export function policyBoundSigner(signer: PreparedRelayTransactionSigner, gate: LedgerWriteGate = defaultLedgerWriteGate): PreparedRelayTransactionSigner {
  return { sign: async input => { gate.assertCanWrite(input.networkId, 'sign'); return signer.sign(input); } };
}
