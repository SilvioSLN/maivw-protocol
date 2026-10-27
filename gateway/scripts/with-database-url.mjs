#!/usr/bin/env node

import { spawn } from 'node:child_process';

const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USERNAME', 'DB_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
const hasDatabaseParts = required.some((name) => process.env[name]);
if ((hasDatabaseParts || !process.env.DATABASE_URL) && missing.length > 0) {
  console.error(`[database-bootstrap] Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('[database-bootstrap] Informe o comando que receberá DATABASE_URL.');
  process.exit(1);
}

let databaseUrl;
try {
  databaseUrl = new URL(hasDatabaseParts ? 'postgresql://localhost' : process.env.DATABASE_URL);
  if (!['postgresql:', 'postgres:'].includes(databaseUrl.protocol) || !databaseUrl.hostname) throw new Error();
  if (hasDatabaseParts) {
    databaseUrl.username = process.env.DB_USERNAME;
    databaseUrl.password = process.env.DB_PASSWORD;
    databaseUrl.hostname = process.env.DB_HOST;
    databaseUrl.port = process.env.DB_PORT;
    databaseUrl.pathname = `/${encodeURIComponent(process.env.DB_NAME)}`;
    databaseUrl.searchParams.set('sslmode', 'require');
  }
} catch {
  console.error('[database-bootstrap] Configuração PostgreSQL inválida; valores omitidos.');
  process.exit(1);
}

const childEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl.toString(),
};
delete childEnvironment.DB_PASSWORD;
delete childEnvironment.DB_USERNAME;

const child = spawn(command, args, {
  env: childEnvironment,
  stdio: 'inherit',
});

const signalHandlers = new Map(['SIGTERM', 'SIGINT'].map(signal => [signal, () => child.kill(signal)]));
for (const [signal, handler] of signalHandlers) process.on(signal, handler);

child.once('error', (error) => {
  console.error(`[database-bootstrap] Falha ao iniciar o processo: ${error.message}`);
  process.exit(1);
});
child.once('exit', (code, signal) => {
  for (const [name, handler] of signalHandlers) process.off(name, handler);
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
