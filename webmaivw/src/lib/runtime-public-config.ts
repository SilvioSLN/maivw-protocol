// Explicit public allowlist. Read on each request instead of baking environment URLs into the image.
const keys = ["NEXT_PUBLIC_DEFAULT_ORIGIN_NETWORK", "NEXT_PUBLIC_GATEWAY_URL", "NEXT_PUBLIC_IS_CLOUD", "NEXT_PUBLIC_PAYMENT_API_URL", "NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS", "NEXT_PUBLIC_RPC_URL"] as const;
type PublicKey = typeof keys[number];
declare global { interface Window { __MAIVW_PUBLIC_CONFIG__?: Partial<Record<PublicKey, string>>; } }
export function runtimePublicValue(key: PublicKey): string | undefined {
  if (!(keys as readonly string[]).includes(key)) return undefined;
  if (typeof window !== 'undefined') return window.__MAIVW_PUBLIC_CONFIG__?.[key];
  return process.env[key];
}
export function serializeRuntimePublicConfig(environment: NodeJS.ProcessEnv = process.env): string {
  const config = Object.fromEntries(keys.filter(key => environment[key] !== undefined).map(key => [key, environment[key]]));
  return 'window.__MAIVW_PUBLIC_CONFIG__=' + JSON.stringify(config).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';';
}
