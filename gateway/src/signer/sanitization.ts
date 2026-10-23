const PRIVATE_HEX_KEY_REGEX = /\b(?:0x)?[0-9a-fA-F]{64}\b/g;
const SENSITIVE_KEY_PATTERN = /(?:private.?key|secret|credentials|keypair|seed|master.?key|auth.?tag)/i;

/**
 * Redige qualquer representação de segredo privado, exibindo apenas o formato seguro mascarado.
 */
export function redactSecret(value: unknown): string {
  if (typeof value !== "string") {
    return "[REDACTED]";
  }
  const clean = value.trim();
  if (clean.startsWith("0x") && clean.length === 66) {
    return `${clean.slice(0, 6)}...[REDACTED]...${clean.slice(-4)}`;
  }
  if (clean.length >= 32) {
    return `[REDACTED:len=${clean.length}]`;
  }
  return "[REDACTED]";
}

/**
 * Detecta se uma string contém potenciais chaves privadas cruas de 32 bytes (64 caracteres hexadecimais).
 */
export function containsPrivateKeyMaterial(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  return PRIVATE_HEX_KEY_REGEX.test(text);
}

/**
 * Remove recursivamente campos sensíveis e mascara chaves privadas para registro seguro em logs.
 */
export function sanitizeForLog<T>(obj: T): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    if (containsPrivateKeyMaterial(obj)) {
      return redactSecret(obj);
    }
    return obj;
  }

  if (typeof obj === "bigint" || typeof obj === "number" || typeof obj === "boolean") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForLog(item));
  }

  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeForLog(val);
      }
    }
    return sanitized;
  }

  return "[UNSERIALIZABLE]";
}

/**
 * Assegura que um payload de resposta ou metadado não contém material privado exposto.
 * Lança erro caso detecte exposição não sanitizada.
 */
export function assertNoPrivateMaterial(target: unknown, context: string = "runtime"): void {
  const json = typeof target === "string" ? target : JSON.stringify(target);
  if (json && PRIVATE_HEX_KEY_REGEX.test(json)) {
    throw new Error(`[SECURITY] Private key material detected in ${context}; refusing to expose secret`);
  }
}
