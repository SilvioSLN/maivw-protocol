import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RUNTIME_PROFILES,
  RUNTIME_ROLES,
  hasLoop,
  hasRouteGroup,
  parseRuntimeRole,
  resolveRuntimeRole,
  runtimeProfile,
  type RuntimeLoop,
  type RuntimeRouteGroup,
} from "../src/runtime/roles.js";

const separatedRoles = RUNTIME_ROLES.filter((role) => role !== "all-in-one");

test("runtime role parser accepts only the versioned deployment contract", () => {
  for (const role of RUNTIME_ROLES) assert.equal(parseRuntimeRole(role), role);
  for (const invalid of [undefined, "", "api", "worker", "ALL_IN_ONE"]) {
    assert.throws(() => parseRuntimeRole(invalid), /MAIVW_RUNTIME_ROLE inválido/);
  }
  assert.equal(resolveRuntimeRole(undefined, undefined), "all-in-one");
  assert.equal(resolveRuntimeRole("gateway-api", undefined), "gateway-api");
  assert.equal(resolveRuntimeRole(undefined, "p2p-ingress"), "p2p-ingress");
  assert.throws(
    () => resolveRuntimeRole("gateway-api", "mail-worker"),
    /argumento diverge/,
  );
});

test("separated runtime roles own disjoint route groups", () => {
  const owners = new Map<RuntimeRouteGroup, string[]>();
  for (const role of separatedRoles) {
    for (const group of runtimeProfile(role).routeGroups) {
      owners.set(group, [...(owners.get(group) || []), role]);
    }
  }
  assert.deepEqual(Object.fromEntries(owners), {
    "gateway-api": ["gateway-api"],
    "p2p-ingress": ["p2p-ingress"],
    "mail-worker": ["mail-worker"],
    "oracle-worker": ["oracle-worker"],
    "relayer-worker": ["relayer-worker"],
  });
});

test("background loops have one separated owner and all-in-one preserves the union", () => {
  const loopOwners = new Map<RuntimeLoop, string[]>();
  for (const role of separatedRoles) {
    for (const loop of runtimeProfile(role).loops) {
      loopOwners.set(loop, [...(loopOwners.get(loop) || []), role]);
    }
  }
  assert.deepEqual(Object.fromEntries(loopOwners), {
    "routing-health": ["mail-worker"],
    "evm-indexer": ["evm-indexer"],
    "solana-indexer": ["solana-indexer"],
  });

  const all = RUNTIME_PROFILES["all-in-one"];
  for (const group of ["gateway-api", "p2p-ingress", "mail-worker", "oracle-worker", "relayer-worker"] as const) {
    assert.equal(hasRouteGroup(all, group), true);
  }
  for (const loop of ["routing-health", "evm-indexer", "solana-indexer"] as const) {
    assert.equal(hasLoop(all, loop), true);
  }
});

test("an isolated role cannot silently acquire another role's routes or loops", () => {
  assert.deepEqual(runtimeProfile("gateway-api"), {
    role: "gateway-api", routeGroups: ["gateway-api"], loops: [],
  });
  assert.equal(hasRouteGroup(runtimeProfile("p2p-ingress"), "gateway-api"), false);
  assert.equal(hasRouteGroup(runtimeProfile("mail-worker"), "p2p-ingress"), false);
  assert.equal(hasLoop(runtimeProfile("evm-indexer"), "solana-indexer"), false);
  assert.equal(hasLoop(runtimeProfile("solana-indexer"), "evm-indexer"), false);
});
