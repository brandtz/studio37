import { retryQuoteEmails } from './_lib/quote-email-retry.mjs';

export default async () => {
  await retryQuoteEmails();
};

export const config = { schedule: '*/5 * * * *' };
