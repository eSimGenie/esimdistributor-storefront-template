import { fulfilSession, retryDue } from './fulfil';
import { paidSessionFromRecord } from './order-flow';
import type { Services } from './services';

export interface RetryResult {
  sessionId: string;
  state: string;
  orderNumber?: string;
  error?: string;
}

/** Retries paid-but-unfulfilled orders. Used by the cron trigger and POST /api/admin/retry. */
export async function retryFailedOrders(services: Services, { onlyDue, limit = 25 }: { onlyDue: boolean; limit?: number }): Promise<RetryResult[]> {
  const results: RetryResult[] = [];
  for (const sessionId of await services.store.failedSessionIds(limit)) {
    const rec = await services.store.get(sessionId);
    if (!rec || rec.state !== 'failed') continue;
    if (onlyDue && !retryDue(rec)) continue;
    const next = await fulfilSession(paidSessionFromRecord(rec), services.fulfilDeps());
    results.push({ sessionId, state: next.state, orderNumber: next.orderNumber, error: next.failureCode });
    // Same balance problem for every order — no point hammering the API.
    if (next.failureCode === 'insufficient_balance') break;
  }
  return results;
}
