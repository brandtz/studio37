// Scheduled: re-deliver storefront leads/orders whose Back Office sync failed
// or timed out (see _lib/backoffice-sync.mjs for backoff and duplicate safety).

import { retryBackOfficeSyncs } from './_lib/backoffice-storefront.mjs';

export default async () => {
  // Scheduled functions are capped at 30s; leave headroom for one in-flight attempt.
  const summary = await retryBackOfficeSyncs({ budgetMs: 12000 });
  if (summary.attempted || summary.remaining) console.log('[backoffice-sync-retry]', JSON.stringify(summary));
};

export const config = { schedule: '*/15 * * * *' };
