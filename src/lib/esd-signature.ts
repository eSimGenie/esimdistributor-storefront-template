import { verifyTimestampedSignature, type SignatureResult } from './crypto';

/**
 * Verifies an eSimDistributor webhook:
 * `X-ESD-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`,
 * rejected when `t` is more than 5 minutes old.
 */
export function verifyEsdSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  opts?: { toleranceSec?: number; nowSec?: number },
): Promise<SignatureResult> {
  return verifyTimestampedSignature(rawBody, header, secret, opts);
}
