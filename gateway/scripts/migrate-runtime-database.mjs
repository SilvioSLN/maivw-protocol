#!/usr/bin/env node
// Privileged one-shot task. Connection strings, SQL errors and secrets never enter logs.
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function migrateRuntimeDatabase({ environment = process.env, migrate = () => {
  const result = spawnSync('node', ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: environment, stdio: 'pipe' });
  if (result.error || result.status !== 0) throw new Error('Prisma migrations failed');
}, createClient = url => new PrismaClient({ datasources: { db: { url } } }) } = {}) {
  if (!environment.DATABASE_URL) throw new Error('Administrative DATABASE_URL is required');
  const username = environment.APP_DB_USERNAME;
  const password = environment.APP_DB_PASSWORD;
  if (username !== 'maivw_app_runtime' || !/^[a-zA-Z0-9]{30,}$/.test(password || '')) throw new Error('Restricted identity must be injected by the deployment');
  const extra = JSON.parse(environment.MAIVW_ADDITIONAL_MIGRATIONS_JSON || '[]');
  if (!Array.isArray(extra) || extra.some(sql => typeof sql !== 'string' || !sql.trim())) throw new Error('Invalid additional migrations');
  const admin = createClient(environment.DATABASE_URL);
  let runtime;
  try {
    await admin.$connect();
    await migrate();
    for (const sql of extra) await admin.$executeRawUnsafe(sql);
    const [exists] = await admin.$queryRawUnsafe("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maivw_app_runtime') AS present");
    if (!exists.present) await admin.$executeRawUnsafe('CREATE ROLE maivw_app_runtime LOGIN');
    // The RDS master is not a PostgreSQL superuser. Do not request changes to
    // SUPERUSER/REPLICATION/BYPASSRLS attributes; verify their denial below.
    // Fixed identity and generated alphanumeric password; no caller-provided identifiers.
    await admin.$executeRawUnsafe(`ALTER ROLE maivw_app_runtime WITH LOGIN PASSWORD '${password}' NOCREATEDB NOCREATEROLE`);
    for (const sql of [
      'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
      'REVOKE CREATE ON SCHEMA public FROM maivw_app_runtime',
      'GRANT USAGE ON SCHEMA public TO maivw_app_runtime',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO maivw_app_runtime',
      'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO maivw_app_runtime',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO maivw_app_runtime',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO maivw_app_runtime',
      'REVOKE ALL ON TABLE public._prisma_migrations FROM maivw_app_runtime',
    ]) await admin.$executeRawUnsafe(sql);
    const runtimeUrl = new URL(environment.DATABASE_URL);
    runtimeUrl.username = username; runtimeUrl.password = password;
    runtime = createClient(runtimeUrl.toString());
    await runtime.$connect();
    const [role] = await runtime.$queryRawUnsafe(`SELECT current_user AS name,
      (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
       OR has_schema_privilege(current_user, 'public', 'CREATE')
       OR EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user)
       OR (CASE WHEN to_regrole('rds_superuser') IS NULL THEN false ELSE pg_has_role(current_user, to_regrole('rds_superuser'), 'MEMBER') END)) AS excessive
      FROM pg_roles WHERE rolname = current_user`);
    if (role?.name !== username || role.excessive !== false) throw new Error('Excessive runtime privileges');
    const [grants] = await runtime.$queryRawUnsafe(`SELECT count(*)::int AS missing FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'
      AND NOT (has_table_privilege(current_user, quote_ident(schemaname)||'.'||quote_ident(tablename), 'SELECT')
      AND has_table_privilege(current_user, quote_ident(schemaname)||'.'||quote_ident(tablename), 'INSERT')
      AND has_table_privilege(current_user, quote_ident(schemaname)||'.'||quote_ident(tablename), 'UPDATE')
      AND has_table_privilege(current_user, quote_ident(schemaname)||'.'||quote_ident(tablename), 'DELETE'))`);
    if (grants.missing !== 0) throw new Error('Incomplete runtime DML grants');
    await admin.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public._maivw_runtime_privilege_probe (id integer PRIMARY KEY)');
    await admin.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON public._maivw_runtime_privilege_probe TO maivw_app_runtime');
    try {
      await runtime.$transaction(async tx => {
        await tx.$executeRawUnsafe('INSERT INTO public._maivw_runtime_privilege_probe VALUES (1)');
        await tx.$queryRawUnsafe('SELECT id FROM public._maivw_runtime_privilege_probe');
        await tx.$executeRawUnsafe('UPDATE public._maivw_runtime_privilege_probe SET id=2 WHERE id=1');
        await tx.$executeRawUnsafe('DELETE FROM public._maivw_runtime_privilege_probe WHERE id=2');
      });
      let ddlDenied = false;
      try {
        await runtime.$transaction(async tx => {
          await tx.$executeRawUnsafe('CREATE TABLE public._maivw_forbidden_ddl_probe (id integer)');
          throw new Error('DDL_UNEXPECTEDLY_ALLOWED'); // Roll back even if permissions are wrong.
        });
      } catch (error) { ddlDenied = error?.meta?.code === '42501' || error?.code === '42501'; }
      if (!ddlDenied) throw new Error('Runtime DDL was not rejected');
    } finally { await admin.$executeRawUnsafe('DROP TABLE public._maivw_runtime_privilege_probe'); }
    return { engine: 'postgresql', migrations: 'APPLIED', runtimeRole: username, dml: 'VERIFIED', ddl: 'DENIED', checkedAt: new Date().toISOString() };
  } finally {
    await runtime?.$disconnect();
    await admin.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await migrateRuntimeDatabase())); }
  catch { console.error('Database migration or restricted-identity verification failed; credentials and SQL details omitted.'); process.exitCode = 1; }
}
