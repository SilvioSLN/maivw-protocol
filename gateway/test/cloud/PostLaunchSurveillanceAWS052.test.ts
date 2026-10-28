import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const plan = JSON.parse(readFileSync(resolve(import.meta.dirname,'../../../../releases/production/post-launch-surveillance-manifest.json'),'utf8'));
test('AWS-052: surveillance windows are configured, not presented as measured observations', () => {
  assert.equal(plan.evidenceType,'PLAN_ONLY');
  for (const window of Object.values(plan.windows) as any[]) {
    assert.equal(window.status,'PENDING_LIVE_EVIDENCE');
    assert.ok(Object.keys(window.metrics).every(k=>!k.startsWith('observed')));
  }
  assert.equal(plan.cellCapacityModel.readyForPilotScale,false);
});
