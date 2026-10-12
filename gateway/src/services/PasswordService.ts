import { randomBytes, scrypt, createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const NewPasswordSchema = z.string().min(12).max(128);
const PARAMS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, PARAMS, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$v1$${salt}$${(await derive(password, salt)).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length > 128) return false;
  const modern = /^scrypt\$v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored);
  if (modern) return timingSafeEqual(await derive(password, modern[1]), Buffer.from(modern[2], "hex"));
  // Read-only compatibility: a successful legacy login is migrated by the route.
  const legacy = /^([a-f0-9]{32}):([a-f0-9]{64})$/.exec(stored);
  if (!legacy) return false;
  const digest = createHash("sha256").update(legacy[1] + password).digest();
  return timingSafeEqual(digest, Buffer.from(legacy[2], "hex"));
}

export function needsPasswordUpgrade(stored: string): boolean {
  return !stored.startsWith("scrypt$v1$");
}

export function validRegistrationToken(supplied: unknown, expected: string | undefined): boolean {
  if (!expected || expected.length < 32 || typeof supplied !== "string" || supplied.length > 1024) return false;
  return timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(expected).digest());
}
