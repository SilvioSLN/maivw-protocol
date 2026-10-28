import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const plan = JSON.parse(readFileSync(resolve(import.meta.dirname,'../../../../releases/production/bootstrap-closure-manifest.json'),'utf8'));
test('AWS-053: production closure remains pending until live evidence and human sign-off', () => {
  assert.equal(plan.evidenceType,'PLAN_ONLY');
  assert.equal(plan.allGatesApproved,false);
  assert.equal(plan.closureStatus,'PENDING_LIVE_OPERATIONAL_CONFIRMATION');
  for (const gate of ['gateF4','gateF5']) assert.equal(plan.gates[gate].status,'PENDING_LIVE_EVIDENCE');
  assert.equal(plan.pilotAcceptance.status,'PENDING_LIVE_EVIDENCE');
  assert.deepEqual(plan.pilotAcceptance.acceptedCohorts,{});
});
test('AWS-053: cleanup declarations are targets for verification, not revocation evidence', () => {
  assert.equal(plan.temporaryAccessAndResourceCleanup.auditStatus,'PENDING_REMOTE_VERIFICATION');
  assert.ok(plan.temporaryAccessAndResourceCleanup.revokedItems.every(item=>item.action==='TO_VERIFY'));
});
