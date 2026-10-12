import { test } from "node:test";
import assert from "node:assert/strict";
import { EnvSchema, parseEnvironment } from "../src/config.js";

test("IS_CLOUD interprets string false as false and rejects ambiguous flags", () => {
  const required = { JWT_SECRET: "a".repeat(32), MASTER_SECRET_KEY: "b".repeat(32), INTERNAL_SERVICE_KEY: "c".repeat(32) };
  for (const [input, expected] of [["false", false], ["true", true], [false, false], [true, true], [undefined, false]]) {
    assert.equal(EnvSchema.parse({ ...required, IS_CLOUD: input }).IS_CLOUD, expected);
  }
  assert.equal(EnvSchema.safeParse({ ...required, IS_CLOUD: "no" }).success, false);
});

test("empty optional Docker values use defaults without bypassing required secrets", () => {
  const env = {
    JWT_SECRET: "a".repeat(32), MASTER_SECRET_KEY: "b".repeat(32), INTERNAL_SERVICE_KEY: "c".repeat(32),
    ORACLE_AI_JUDGE_URL: "", RPC_URL: "", IS_CLOUD: "false",
  };
  const parsed = parseEnvironment(env);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.ORACLE_AI_JUDGE_URL, undefined);
    assert.equal(parsed.data.RPC_URL, "http://localhost:8545");
    assert.equal(parsed.data.IS_CLOUD, false);
  }
  assert.equal(parseEnvironment({ ...env, JWT_SECRET: "" }).success, false);
});
