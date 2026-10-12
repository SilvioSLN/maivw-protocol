import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function createChallenge(domain: string, userId: number, secret: string, now = Date.now()): string {
  const prefix = `${Math.floor(now / 1000) + 1800}.${randomBytes(16).toString('hex')}`;
  return `${prefix}.${sign(domain, userId, prefix, secret)}`;
}
function sign(domain: string, userId: number, prefix: string, secret: string) {
  return createHmac('sha256', secret).update(JSON.stringify([domain, userId, prefix])).digest('hex');
}
export function validChallenge(token: unknown, domain: string, userId: number, secret: string, now = Date.now()): boolean {
  if (typeof token !== 'string') return false;
  const match = /^(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]), seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + 1800) return false;
  return timingSafeEqual(Buffer.from(match[3], 'hex'), Buffer.from(sign(domain, userId, `${match[1]}.${match[2]}`, secret), 'hex'));
}
