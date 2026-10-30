import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, parseSignatureHeader, signOrderToken, timingSafeEqual, verifyOrderToken } from '../src/lib/crypto';
import { verifyStripeSignature } from '../src/lib/stripe';
import { verifyEsdSignature } from '../src/lib/esd-signature';
import { createHmac } from 'node:crypto';

const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1' } } });
const secret = 'whsec_test_secret';
const now = 1_760_000_000;

const sign = (t: number, payload = body, key = secret) => createHmac('sha256', key).update(`${t}.${payload}`).digest('hex');

describe('hmacSha256Hex', () => {
  it('matches Node crypto', async () => {
    expect(await hmacSha256Hex('key', 'message')).toBe(createHmac('sha256', 'key').update('message').digest('hex'));
  });
});

describe('parseSignatureHeader', () => {
  it('parses t and multiple v1 values, ignoring others', () => {
    expect(parseSignatureHeader('t=123,v1=AbC,v0=zzz,v1=def')).toEqual({ timestamp: 123, v1: ['abc', 'def'] });
    expect(parseSignatureHeader('garbage')).toEqual({ timestamp: null, v1: [] });
  });
});

describe('verifyStripeSignature', () => {
  it('accepts a valid signature', async () => {
    const header = `t=${now},v1=${sign(now)}`;
    expect(await verifyStripeSignature(body, header, secret, { nowSec: now + 10 })).toEqual({ ok: true, timestamp: now });
  });

  it('accepts when any of several v1 signatures matches (secret rotation)', async () => {
    const header = `t=${now},v1=${sign(now, body, 'whsec_old')},v1=${sign(now)}`;
    expect((await verifyStripeSignature(body, header, secret, { nowSec: now })).ok).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const header = `t=${now},v1=${sign(now)}`;
    const res = await verifyStripeSignature(body.replace('cs_test_1', 'cs_test_2'), header, secret, { nowSec: now });
    expect(res).toEqual({ ok: false, reason: 'signature mismatch' });
  });

  it('rejects the wrong secret', async () => {
    const header = `t=${now},v1=${sign(now, body, 'whsec_other')}`;
    expect((await verifyStripeSignature(body, header, secret, { nowSec: now })).ok).toBe(false);
  });

  it('rejects old timestamps (replay)', async () => {
    const header = `t=${now},v1=${sign(now)}`;
    expect(await verifyStripeSignature(body, header, secret, { nowSec: now + 301 })).toEqual({ ok: false, reason: 'timestamp outside tolerance' });
  });

  it('rejects missing or malformed headers and a missing secret', async () => {
    expect((await verifyStripeSignature(body, null, secret)).ok).toBe(false);
    expect((await verifyStripeSignature(body, 'v1=abc', secret)).ok).toBe(false);
    expect((await verifyStripeSignature(body, `t=${now},v1=${sign(now)}`, '', { nowSec: now })).ok).toBe(false);
  });
});

describe('verifyEsdSignature (X-ESD-Signature)', () => {
  const esdBody = JSON.stringify({ id: 'evt_9', type: 'order.completed', createdAt: '2026-10-30T10:00:00Z', data: { order: { id: '100234' } } });
  const esdSecret = 'whsec_esd';

  it('accepts a valid signature', async () => {
    const header = `t=${now},v1=${sign(now, esdBody, esdSecret)}`;
    expect((await verifyEsdSignature(esdBody, header, esdSecret, { nowSec: now + 60 })).ok).toBe(true);
  });

  it('rejects signatures older than 5 minutes', async () => {
    const header = `t=${now},v1=${sign(now, esdBody, esdSecret)}`;
    expect((await verifyEsdSignature(esdBody, header, esdSecret, { nowSec: now + 5 * 60 + 1 })).ok).toBe(false);
  });

  it('rejects a modified body', async () => {
    const header = `t=${now},v1=${sign(now, esdBody, esdSecret)}`;
    expect((await verifyEsdSignature(esdBody + ' ', header, esdSecret, { nowSec: now })).ok).toBe(false);
  });

  it('rejects a signature over a different timestamp', async () => {
    const header = `t=${now + 1},v1=${sign(now, esdBody, esdSecret)}`;
    expect((await verifyEsdSignature(esdBody, header, esdSecret, { nowSec: now })).ok).toBe(false);
  });
});

describe('order link tokens', () => {
  it('verifies its own token and rejects others', async () => {
    const t = await signOrderToken('link-secret', '100234');
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await verifyOrderToken('link-secret', '100234', t)).toBe(true);
    expect(await verifyOrderToken('link-secret', '100235', t)).toBe(false);
    expect(await verifyOrderToken('other-secret', '100234', t)).toBe(false);
    expect(await verifyOrderToken('link-secret', '100234', null)).toBe(false);
  });

  it('timingSafeEqual compares exactly', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});
