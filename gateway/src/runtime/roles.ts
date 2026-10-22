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
export type RuntimeQueue = "mail:send" | "oracle:dispute" | "relayer:mirror";

export interface RuntimeProfile {
  role: RuntimeRole;
  routeGroups: readonly RuntimeRouteGroup[];
  loops: readonly RuntimeLoop[];
  queues: readonly RuntimeQueue[];
}

const ALL_ROUTE_GROUPS: readonly RuntimeRouteGroup[] = [
  "gateway-api",
  "p2p-ingress",
  "mail-worker",
  "oracle-worker",
  "relayer-worker",
];
const ALL_LOOPS: readonly RuntimeLoop[] = ["routing-health", "evm-indexer", "solana-indexer"];
const ALL_QUEUES: readonly RuntimeQueue[] = ["mail:send", "oracle:dispute", "relayer:mirror"];

export const RUNTIME_PROFILES: Readonly<Record<RuntimeRole, RuntimeProfile>> = {
  "all-in-one": { role: "all-in-one", routeGroups: ALL_ROUTE_GROUPS, loops: ALL_LOOPS, queues: ALL_QUEUES },
  "gateway-api": { role: "gateway-api", routeGroups: ["gateway-api"], loops: [], queues: [] },
  "p2p-ingress": { role: "p2p-ingress", routeGroups: ["p2p-ingress"], loops: [], queues: [] },
  "mail-worker": { role: "mail-worker", routeGroups: ["mail-worker"], loops: ["routing-health"], queues: ["mail:send"] },
  "oracle-worker": { role: "oracle-worker", routeGroups: ["oracle-worker"], loops: [], queues: ["oracle:dispute"] },
  "relayer-worker": { role: "relayer-worker", routeGroups: ["relayer-worker"], loops: [], queues: ["relayer:mirror"] },
  "evm-indexer": { role: "evm-indexer", routeGroups: [], loops: ["evm-indexer"], queues: [] },
  "solana-indexer": { role: "solana-indexer", routeGroups: [], loops: ["solana-indexer"], queues: [] },
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

export function hasQueue(profile: RuntimeProfile, queue: RuntimeQueue): boolean {
  return profile.queues.includes(queue);
}

