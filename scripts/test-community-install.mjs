#!/usr/bin/env node
// Clean source-only build. Never load an operator's .env or reuse their volumes.
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];
if (process.argv.length > 3 || (platform && platform !== '--gateway-arm64')) throw new Error('Usage: node scripts/test-community-install.mjs [--gateway-arm64]');
const directory = await mkdtemp(join(tmpdir(), 'maivw-community-'));
const project = `maivw-ret005-${randomUUID().slice(0, 8)}`;
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: '1',
  MAIVW_DOCKER_NETWORK: `${project}-network`, COMPOSE_PARALLEL_LIMIT: '1' };
for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR']) if (process.env[name]) env[name] = process.env[name];
const base = ['compose', '--project-directory', directory, '--env-file', '/dev/null', '-p', project, '-f', join(directory, 'docker-compose.yml')];
if (platform) base.push('-f', join(directory, 'platform.json'));
const docker = (args, label, timeout = 180000) => {
  try { return execFileSync('docker', args, { env, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new Error(`${label} failed; configuration/log values omitted. Project: ${project}`); }
};
const compose = (args, label, timeout) => docker([...base, ...args], label, timeout);
const step = (label) => console.log(`[Community] ${label}`);
async function assertFree(port) {
  const server = createServer();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  await new Promise(ok => server.close(ok));
}
async function ready() {
  for (let i = 0; i < 90; i++) {
    try { const response = await fetch('http://127.0.0.1:51443/health/ready', { signal: AbortSignal.timeout(1500) });
      const body = await response.json(); if (response.ok && body.ready === true) return;
    } catch {}
    await new Promise(ok => setTimeout(ok, 1000));
  }
  throw new Error('Community readiness timeout');
}
const inGateway = code => compose(['exec', '-T', 'gateway', 'node', '--input-type=module', '-e', code], 'Gateway probe');
let started = false;
try {
  for (const port of [50443, 51443, 52443, 53443, 54443, 55443]) await assertFree(port);
  for (const [folder, files] of Object.entries({
    gateway: ['Dockerfile', 'package.json', 'package-lock.json', 'tsconfig.json', 'src', 'prisma', 'scripts'],
    contracts: ['Dockerfile', 'foundry.toml', 'src', 'test', 'script', 'lib'],
    dashboard: ['Dockerfile', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'next.config.mjs', 'public', 'src', 'scripts'],
    webmaivw: ['Dockerfile', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.mjs', 'tailwind.config.js', 'postcss.config.mjs', 'public', 'src', 'scripts'],
  })) for (const file of files) await cp(join(source, folder, file), join(directory, folder, file), {
    recursive: true, filter: path => !path.split('/').some(part => ['.git', 'node_modules', 'out', 'cache', 'broadcast', 'keys', '.env'].includes(part) || part.startsWith('.env.')),
  });
  await cp(join(source, 'docker-compose.yml'), join(directory, 'docker-compose.yml'));
  if (platform) await writeFile(join(directory, 'platform.json'), JSON.stringify({ services: {
    gateway: { platform: 'linux/arm64' }, 'gateway-migration': { platform: 'linux/arm64' },
  } }));
  step('Source copied without .env, keys, build outputs or existing runtime data.');
  compose(['config', '--quiet'], 'Compose configuration');
  step('Building images with their frozen lockfiles (no cloud credentials).');
  started = true;
  compose(['build'], 'Clean image build', 1200000);
  compose(['up', '-d', '--wait', '--wait-timeout', '180'], 'Clean Compose startup', 240000);
  await ready();
  if (platform) assert.equal(inGateway('console.log(process.arch)'), 'arm64');
  const migrationId = compose(['ps', '-aq', 'gateway-migration'], 'Migration discovery');
  assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', migrationId], 'Migration status'), '0');
  const marker = randomUUID();
  const count = inGateway(`import {PrismaClient} from '@prisma/client'; const db=new PrismaClient();
    try { const rows=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
      if(rows[0].count!==3) throw new Error('migration count');
      await db.runtimeOperation.create({data:{id:${JSON.stringify(marker)},operationKey:'a'.repeat(64),kind:'MAIL',inputHash:'b'.repeat(64),payload:{synthetic:true},authority:{synthetic:true}}});
      console.log(rows[0].count); } finally {await db.$disconnect();}`);
  assert.equal(count, '3');
  inGateway(`import fs from 'node:fs/promises'; for(const path of ['/app/data/attachments/.ret005','/app/data/certs/.ret005']) {await fs.writeFile(path,'synthetic'); await fs.unlink(path);} if(process.getuid()===0)process.exit(1);`);
  for (const port of [50443, 52443]) assert.equal((await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(10000) })).status, 200);
  step('Three migrations, ready Gateway, writable non-root storage and both frontends passed.');
  compose(['run', '--rm', '--no-deps', 'gateway-migration'], 'Repeated one-shot migration');
  compose(['run', '--rm', '--no-deps', 'contracts-deployer'], 'Idempotent local deployment');
  compose(['stop', '-t', '20', 'gateway'], 'SIGTERM shutdown', 40000);
  const gatewayId = compose(['ps', '-aq', 'gateway'], 'Gateway discovery');
  assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', gatewayId], 'Gateway exit status'), '0');
  compose(['up', '-d', '--no-deps', 'gateway'], 'Gateway restart'); await ready();
  assert.equal(inGateway(`import {PrismaClient} from '@prisma/client'; const db=new PrismaClient(); try{console.log(await db.runtimeOperation.count({where:{id:${JSON.stringify(marker)}}}));}finally{await db.$disconnect();}`), '1');
  step('Repeated migration/deployment and SIGTERM exit 0/restart with preserved data passed.');
  compose(['stop', 'gateway'], 'Stop before negative migration test');
  const negative = join(directory, 'migration-failure.json');
  await writeFile(negative, JSON.stringify({ services: { 'gateway-migration': { environment: { DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/absent?connect_timeout=2' } } } }));
  let rejected = false;
  try { docker([...base, '-f', negative, 'up', '-d', 'gateway'], 'Expected failing migration', 60000); } catch { rejected = true; }
  assert.equal(rejected, true);
  const failedMigration = compose(['ps', '-aq', 'gateway-migration'], 'Failed migration discovery');
  assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', failedMigration], 'Failed migration exit status'), '1');
  assert.equal(docker(['inspect', '--format', '{{.State.Running}}', gatewayId], 'Blocked runtime status'), 'false');
  compose(['up', '-d', 'gateway'], 'Migration recovery', 120000); await ready();
  step('Failed migration blocks runtime startup; corrected configuration recovers.');
  step('PASS: clean Community installation and lifecycle, without AWS/Firebase/Cloudflare.');
} finally {
  if (started) compose(['down', '--volumes', '--remove-orphans', '--rmi', 'local'], 'Isolated test cleanup', 180000);
  await rm(directory, { recursive: true, force: true });
  step(`Cleanup completed for ${project}; pre-existing projects/volumes were not touched.`);
}
