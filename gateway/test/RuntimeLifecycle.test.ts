import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { startSerialPoller } from '../src/runtime/serialPoller.js';
import { GracefulShutdownManager } from '../src/runtime/shutdown.js';
import { EventListenerService } from '../src/services/EventListenerService.js';
import { RoutingPoolService } from '../src/services/RoutingPoolService.js';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
test('shutdown joins a pending poll before database disconnect and schedules no subsequent tick', async () => {
  const blocked = deferred(); let polls = 0, settled = false, disconnected = false;
  const poller = startSerialPoller(async () => { polls++; await blocked.promise; settled = true; }, 1, () => assert.fail('unexpected poll error'));
  const manager = new GracefulShutdownManager({ stopLoops: () => poller.stop(), disconnectPrisma: async () => { assert.equal(settled, true); disconnected = true; }, log: { info() {}, error() {} } as any });
  const stop = manager.initiateShutdown(); await new Promise(r => setTimeout(r, 10)); assert.equal(disconnected, false);
  blocked.resolve(); await stop; await new Promise(r => setTimeout(r, 10));
  assert.equal(disconnected, true); assert.equal(polls, 1); assert.equal(manager.getStatus(), 'stopped');
});
test('event listener joins revocation writes and ignores callbacks after stop', async () => {
  const handlers: Record<string, any> = {}, blocked = deferred(); let writes = 0, unwatched = 0;
  const ledger: any = { getContractAddress: () => `0x${'11'.repeat(20)}`, getClient: () => ({ watchContractEvent: (options: any) => { handlers[options.eventName] = options.onLogs; return () => unwatched++; } }) };
  const listener = new EventListenerService(ledger, { message: { updateMany: async () => { writes++; await blocked.promise; return { count: 1 }; } } } as any);
  listener.start(); handlers.DomainDeactivated([{ args: { domain: 'synthetic.test', timestamp: 1n } }]);
  let stopped = false; const stop = listener.stop().then(() => { stopped = true; });
  await new Promise(r => setTimeout(r, 10)); assert.equal(stopped, false);
  blocked.resolve(); await stop; handlers.DomainDeactivated([{ args: { domain: 'synthetic.test', timestamp: 1n } }]);
  assert.equal(writes, 1); assert.equal(unwatched, 5);
});
test('fresh local routing seeds only the configured local peer', async () => {
  const created: any[] = [];
  const pool = new RoutingPoolService({ endpointPool: { count: async () => 0, create: async (row: any) => { created.push(row.data); return { id: 1 }; }, findMany: async () => [] }, domainRouteRule: { findMany: async () => [] } } as any, undefined, 'http://gateway:3001/api/v1/inbox');
  await pool.start({ runHealthChecks: false, failFast: true }); await pool.destroy();
  assert.equal(created.length, 1); assert.equal(created[0].nodes.create.length, 1);
  assert.equal(created[0].nodes.create[0].endpointUrl, 'http://gateway:3001/api/v1/inbox');
});

const wrapper = new URL('../scripts/with-database-url.mjs', import.meta.url).pathname;
const baseEnv = { PATH: process.env.PATH, NODE_ENV: 'test' };
test('database wrapper supports Community URL and cloud parts, rejecting partial or invalid configuration without echoing values', () => {
  const probe = `const u=new URL(process.env.DATABASE_URL); console.log(JSON.stringify({postgres:u.protocol==='postgresql:',tls:u.searchParams.get('sslmode'),rawPasswordPresent:'DB_PASSWORD' in process.env}));`;
  const url = spawnSync(process.execPath, [wrapper, process.execPath, '-e', probe], { env: { ...baseEnv, DATABASE_URL: 'postgresql://synthetic:synthetic@localhost/test' }, encoding: 'utf8' });
  assert.equal(url.status, 0); assert.deepEqual(JSON.parse(url.stdout), { postgres: true, tls: null, rawPasswordPresent: false });
  const parts = spawnSync(process.execPath, [wrapper, process.execPath, '-e', probe], { env: { ...baseEnv, DB_HOST: 'localhost', DB_PORT: '5432', DB_NAME: 'test', DB_USERNAME: 'synthetic', DB_PASSWORD: 'synthetic' }, encoding: 'utf8' });
  assert.equal(parts.status, 0); assert.deepEqual(JSON.parse(parts.stdout), { postgres: true, tls: 'require', rawPasswordPresent: false });
  for (const config of [{ DB_HOST: 'localhost', DATABASE_URL: 'postgresql://localhost/test' }, { DATABASE_URL: 'https://sensitive-value.example.test' }]) {
    const result = spawnSync(process.execPath, [wrapper, process.execPath, '-e', probe], { env: { ...baseEnv, ...config }, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stderr.includes('sensitive-value'), false);
  }
});
test('database wrapper forwards SIGTERM and exits when its child terminates by signal', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, [wrapper, process.execPath, '-e', `console.log('READY');setInterval(()=>{},1000);`], { env: { ...baseEnv, DATABASE_URL: 'postgresql://localhost/test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try { await once(child.stdout!, 'data'); const exited = once(child, 'exit'); child.kill('SIGTERM');
    const [code, signal] = await exited; assert.equal(code, null); assert.equal(signal, 'SIGTERM');
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});
