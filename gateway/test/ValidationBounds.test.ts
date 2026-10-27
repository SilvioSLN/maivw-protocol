import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { MirrorJobRequestBodySchema } from '../src/multichain/MultichainApiSchema.js';

test('constrained arrays reject oversized input before traversing elements', () => {
  let reads = 0;
  const oversized = new Array(100_000);
  Object.defineProperty(oversized, 0, { get() { reads++; return 'value'; } });
  const parsed = z.array(z.string()).max(2).safeParse(oversized);
  assert.equal(parsed.success, false);
  assert.equal(reads, 0, 'oversized input must not be traversed or create one error per element');
  if (!parsed.success) assert.equal(parsed.error.issues.length, 1);
});

test('mirror API applies the destination limit before parsing destination entries', () => {
  let reads = 0;
  const destinations = new Array(17);
  Object.defineProperty(destinations, 0, { get() { reads++; return 'evm:84532'; } });
  const parsed = MirrorJobRequestBodySchema.safeParse({ domain: 'example.com', destinationNetworkIds: destinations });
  assert.equal(parsed.success, false);
  assert.equal(reads, 0);
});
