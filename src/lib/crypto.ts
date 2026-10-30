/** Web Crypto helpers — work on Cloudflare Workers, Node 20+ and in vitest. */

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message));
  return new Uint8Array(sig);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return toHex(await hmacSha256(secret, message));
}

/** Constant-time string comparison (length is not secret). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Parses `t=123,v1=abc,v1=def` style signature headers (Stripe and eSimDistributor share the format). */
export function parseSignatureHeader(header: string): { timestamp: number | null; v1: string[] } {
  let timestamp: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && value) v1.push(value.toLowerCase());
  }
  return { timestamp, v1 };
}

export type SignatureResult = { ok: true; timestamp: number } | { ok: false; reason: string };

/**
 * Verifies `HMAC-SHA256(secret, "<t>.<rawBody>")` against every `v1` in the header,
 * rejecting timestamps more than `toleranceSec` away from `nowSec`.
 */
export async function verifyTimestampedSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  { toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000) }: { toleranceSec?: number; nowSec?: number } = {},
): Promise<SignatureResult> {
  if (!secret) return { ok: false, reason: 'webhook secret is not configured' };
  if (!header) return { ok: false, reason: 'missing signature header' };
  const { timestamp, v1 } = parseSignatureHeader(header);
  if (timestamp === null || v1.length === 0) return { ok: false, reason: 'malformed signature header' };
  if (Math.abs(nowSec - timestamp) > toleranceSec) return { ok: false, reason: 'timestamp outside tolerance' };
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return v1.some((sig) => timingSafeEqual(sig, expected))
    ? { ok: true, timestamp }
    : { ok: false, reason: 'signature mismatch' };
}

/** Unguessable access token for /order/[id] links: HMAC of the order id with a server secret. */
export async function signOrderToken(secret: string, orderId: string): Promise<string> {
  return toBase64Url(await hmacSha256(secret, `order-link:v1:${orderId}`));
}

export async function verifyOrderToken(secret: string, orderId: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  return timingSafeEqual(token, await signOrderToken(secret, orderId));
}
