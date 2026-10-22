export const RUNTIME_ROLES = [
  "all-in-one",
  "gateway-api",
  "p2p-ingress",
  "mail-worker",
  "oracle-worker",
  "relayer-worker",
  "evm-indexer",
  "solana-indexer",
] as const;

export type RuntimeRole = typeof RUNTIME_ROLES[number];
export type RuntimeRouteGroup =
  | "gateway-api"
  | "p2p-ingress"
  | "mail-worker"
  | "oracle-worker"
  | "relayer-worker";
export type RuntimeLoop = "routing-health" | "evm-indexer" | "solana-indexer";

export interface RuntimeProfile {
  role: RuntimeRole;
  routeGroups: readonly RuntimeRouteGroup[];
  loops: readonly RuntimeLoop[];
}

const ALL_ROUTE_GROUPS: readonly RuntimeRouteGroup[] = [
  "gateway-api",
  "p2p-ingress",
  "mail-worker",
  "oracle-worker",
  "relayer-worker",
];
const ALL_LOOPS: readonly RuntimeLoop[] = ["routing-health", "evm-indexer", "solana-indexer"];

export const RUNTIME_PROFILES: Readonly<Record<RuntimeRole, RuntimeProfile>> = {
  "all-in-one": { role: "all-in-one", routeGroups: ALL_ROUTE_GROUPS, loops: ALL_LOOPS },
  "gateway-api": { role: "gateway-api", routeGroups: ["gateway-api"], loops: [] },
  "p2p-ingress": { role: "p2p-ingress", routeGroups: ["p2p-ingress"], loops: [] },
  "mail-worker": { role: "mail-worker", routeGroups: ["mail-worker"], loops: ["routing-health"] },
  "oracle-worker": { role: "oracle-worker", routeGroups: ["oracle-worker"], loops: [] },
  "relayer-worker": { role: "relayer-worker", routeGroups: ["relayer-worker"], loops: [] },
  "evm-indexer": { role: "evm-indexer", routeGroups: [], loops: ["evm-indexer"] },
  "solana-indexer": { role: "solana-indexer", routeGroups: [], loops: ["solana-indexer"] },
};

export function parseRuntimeRole(value: unknown): RuntimeRole {
  if (typeof value === "string" && (RUNTIME_ROLES as readonly string[]).includes(value)) {
    return value as RuntimeRole;
  }
  throw new Error(`MAIVW_RUNTIME_ROLE inválido: ${String(value)}`);
}

export function resolveRuntimeRole(argument: unknown, environmentValue: unknown): RuntimeRole {
  const argumentRole = argument === undefined ? undefined : parseRuntimeRole(argument);
  const environmentRole = environmentValue === undefined ? undefined : parseRuntimeRole(environmentValue);
  if (argumentRole && environmentRole && argumentRole !== environmentRole) {
    throw new Error("papel do argumento diverge de MAIVW_RUNTIME_ROLE");
  }
  return argumentRole ?? environmentRole ?? "all-in-one";
}

export function runtimeProfile(role: RuntimeRole): RuntimeProfile {
  return RUNTIME_PROFILES[role];
}

export function hasRouteGroup(profile: RuntimeProfile, group: RuntimeRouteGroup): boolean {
  return profile.routeGroups.includes(group);
}

export function hasLoop(profile: RuntimeProfile, loop: RuntimeLoop): boolean {
  return profile.loops.includes(loop);
}
