import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const suffix = randomBytes(5).toString("hex");
const names = [`maivw-ret004-pg-${suffix}`, `maivw-ret004-redis-${suffix}`];
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
  const password = randomBytes(24).toString("base64url");
  execFileSync("docker", ["run", "--rm", "--detach", "--name", names[0], "--memory", "256m", "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=maivw_ret004", "postgres@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab"], { env: { ...process.env, POSTGRES_PASSWORD: password }, stdio: "ignore" });
  docker("run", "--rm", "--detach", "--name", names[1], "--memory", "128m", "--publish", "127.0.0.1::6379", "redis@sha256:6ba19c50b56777f5c11c58eff8ddb69d0d5f27ba131cffb63f180ccfd43c66af", "redis-server", "--appendonly", "yes");
  for (let attempt = 0; ; attempt++) {
    try { docker("exec", names[0], "pg_isready", "-U", "postgres"); break; }
    catch { if (attempt >= 30) throw new Error("Disposable PostgreSQL did not become ready"); await new Promise(r => setTimeout(r, 500)); }
  }
  const pgPort = docker("port", names[0], "5432/tcp").split(":").at(-1);
  const redisPort = docker("port", names[1], "6379/tcp").split(":").at(-1);
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${pgPort}/maivw_ret004`, RET004_REDIS_URL: `redis://127.0.0.1:${redisPort}`, NODE_ENV: "test" };
  const migration = spawnSync("./node_modules/.bin/prisma", ["migrate", "deploy"], { env, encoding: "utf8" });
  if (migration.status !== 0) throw new Error("Disposable migration failed; details suppressed to protect runtime credentials");
  console.log("Disposable PostgreSQL migrated; Redis isolated; synthetic credentials kept in child environment.");
  const tests = spawnSync(process.execPath, ["--import", "tsx", "--test", "test/integration/RuntimeOperations.test.ts"], { env, stdio: "inherit" });
  process.exitCode = tests.status ?? 1;
} finally {
  for (const name of names) { try { docker("rm", "--force", name); } catch {} }
  console.log("RET-004 disposable containers cleaned up.");
}
