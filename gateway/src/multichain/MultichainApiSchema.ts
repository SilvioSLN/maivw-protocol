import { PublicKey } from "@solana/web3.js";
import { getAddress } from "viem";
import { z } from "zod";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodedBase58Length(value: string): number | null {
  if (!value || [...value].some((character) => !BASE58.includes(character))) return null;
  const bytes = [0];
  for (const character of value) {
    let carry = BASE58.indexOf(character);
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeroes = 0;
  while (value[leadingZeroes] === "1") leadingZeroes += 1;
  const significant = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
  return leadingZeroes + significant;
}

export const MultichainErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "INVALID_DOMAIN",
  "INVALID_NETWORK_ID",
  "INVALID_EVM_ADDRESS",
  "INVALID_EVM_TRANSACTION_HASH",
  "INVALID_SOLANA_PUBLIC_KEY",
  "INVALID_SOLANA_SIGNATURE",
  "ORIGIN_NOT_FOUND",
  "ORIGIN_CONFLICT",
  "STATE_DRIFT",
  "DESTINATION_INVALID",
  "OPERATION_INVALID",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
]);
export type MultichainErrorCode = z.infer<typeof MultichainErrorCodeSchema>;

export class MultichainApiError extends Error {
  constructor(
    readonly code: MultichainErrorCode,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "MultichainApiError";
  }
}

export const CanonicalDomainSchema = z.string().trim().toLowerCase()
  .min(1).max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);

export const EvmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => getAddress(value));
export const EvmTransactionHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase());
export const SolanaPublicKeySchema = z.string().min(32).max(44).transform((value, context) => {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    context.addIssue({ code: "custom", message: "INVALID_SOLANA_PUBLIC_KEY" });
    return z.NEVER;
  }
});
export const SolanaSignatureSchema = z.string().min(64).max(88).refine(
  (value) => decodedBase58Length(value) === 64,
  { message: "INVALID_SOLANA_SIGNATURE" },
);

export const EvmNetworkIdSchema = z.string().regex(/^evm:[1-9][0-9]*$/).refine((value) => {
  const chainId = Number(value.slice(4));
  return Number.isSafeInteger(chainId) && chainId > 0;
});
export const SolanaNetworkIdSchema = z.string().startsWith("solana:").transform((value, context) => {
  const parsed = SolanaPublicKeySchema.safeParse(value.slice("solana:".length));
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: "INVALID_NETWORK_ID" });
    return z.NEVER;
  }
  return `solana:${parsed.data}`;
});
export const CanonicalNetworkIdSchema = z.union([EvmNetworkIdSchema, SolanaNetworkIdSchema]);

export const ChainAccountSchema = z.discriminatedUnion("family", [
  z.object({ family: z.literal("EVM"), address: EvmAddressSchema }).strict(),
  z.object({ family: z.literal("SOLANA"), publicKey: SolanaPublicKeySchema }).strict(),
]);

export const ChainTransactionReferenceSchema = z.discriminatedUnion("family", [
  z.object({ family: z.literal("EVM"), hash: EvmTransactionHashSchema }).strict(),
  z.object({ family: z.literal("SOLANA"), signature: SolanaSignatureSchema }).strict(),
]);

export const MirrorJobRequestBodySchema = z.object({
  domain: CanonicalDomainSchema,
  operation: z.enum(["REGISTER", "SYNC", "REVOKE"]).default("REGISTER"),
  destinationNetworkIds: z.array(CanonicalNetworkIdSchema).min(1).max(16).optional(),
  targetChainId: z.number().int().positive().safe().optional(),
}).refine(
  (value) => !value.destinationNetworkIds || new Set(value.destinationNetworkIds).size === value.destinationNetworkIds.length,
  { message: "destinos duplicados", path: ["destinationNetworkIds"] },
);

const CODE_MAP: Record<string, { code: MultichainErrorCode; statusCode: number; message: string }> = {
  MIRROR_ORIGIN_NOT_FOUND: { code: "ORIGIN_NOT_FOUND", statusCode: 404, message: "Origem não encontrada" },
  ORIGIN_NOT_FOUND: { code: "ORIGIN_NOT_FOUND", statusCode: 404, message: "Origem não encontrada" },
  MIRROR_ORIGIN_UNAVAILABLE: { code: "SERVICE_UNAVAILABLE", statusCode: 503, message: "Rede de origem indisponível" },
  MIRROR_ORIGIN_DIVERGED: { code: "ORIGIN_CONFLICT", statusCode: 409, message: "Origem diverge do catálogo" },
  ORIGIN_REFERENCE_MISMATCH: { code: "ORIGIN_CONFLICT", statusCode: 409, message: "Referência de origem conflitante" },
  ORIGIN_ALREADY_ACTIVE: { code: "ORIGIN_CONFLICT", statusCode: 409, message: "Já existe uma origem ativa" },
  MIRROR_DESTINATION_INVALID: { code: "DESTINATION_INVALID", statusCode: 400, message: "Destino de espelhamento inválido" },
  MIRROR_OPERATION_INVALID: { code: "OPERATION_INVALID", statusCode: 409, message: "Operação incompatível com a origem" },
  STATE_DRIFT: { code: "STATE_DRIFT", statusCode: 409, message: "Estado diverge na mesma versão" },
};

export function multichainApiError(error: unknown): MultichainApiError {
  if (error instanceof MultichainApiError) return error;
  const sourceCode = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const mapped = CODE_MAP[sourceCode];
  if (mapped) return new MultichainApiError(mapped.code, mapped.message, mapped.statusCode);
  return new MultichainApiError("INTERNAL_ERROR", "Falha interna no serviço multichain", 500);
}

export function invalidMultichainRequest(message = "Requisição multichain inválida"): MultichainApiError {
  return new MultichainApiError("INVALID_REQUEST", message, 400);
}

export function multichainErrorBody(error: MultichainApiError) {
  return { success: false, error: { code: error.code, message: error.message } };
}
