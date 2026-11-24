# Quote email retries

Each saved quote includes immutable, fully rendered notification and customer acknowledgement payloads. Saving the lead and its payloads is one Blob write; if that write fails, no email is sent. Once saved, email or retry-state failures do not turn the customer's submission into an error. SMS remains best-effort and is not retried.

The published-site `quote-email-retry` scheduled function runs every five minutes. Each message is tracked separately in the strongly consistent `quote_email_attempts` Blob store. Attempt slots begin at 0, 5, 15, 45, 120, 360 and 720 minutes after submission, with no sends at or after 18 hours. A late run uses the latest eligible slot, rather than replaying missed slots. The worker processes older recent leads first, with a 20-second scan budget and at most 20 sends per run. Heavy backlogs, downtime, or Blob failures can exhaust the window before a message is sent.

Attempt records are written before sending; an interrupted attempt waits until the next slot. Sent records are separate and never overwritten by failures. Overlapping workers can both call Resend; the retry records do not use conditional writes to claim exclusive sends. Workers use the same per-lead, per-message idempotency key and the exact persisted payload. Resend deduplicates accepted requests for 24 hours; the 18-hour cutoff keeps automatic retries within that window. This is not a guarantee of mailbox delivery, and provider idempotency does not cover manual sends. Content and recipient settings are snapshotted at submission; later template, CMS, or configuration changes do not alter pending messages.

## Operations and limitations

- Monitor Netlify function logs for `[quote-email]` failures and the scheduled function's execution failures. There is no automated alert or dead-letter dashboard.
- In Netlify Blobs, find the lead in `leads` by its returned ID, then inspect `quote_email_attempts` keys `<id>/notification/` and `<id>/acknowledgement/`. A `sent` record means Resend accepted the message, not that it reached the inbox. `attempt-N` records show starts and sanitized failure codes; a start without an outcome may be ambiguous. A missing `sent` record after 18 hours requires human follow-up using the saved lead. Do not blindly resend an ambiguous email: check Resend first. Do not reset records or replay automatically after the provider's 24-hour idempotency window.
- Existing leads without `quoteEmails` are not replayed. Retries only run on published deploys; preview and local environments do not run on a schedule. Verify scheduling and credentials after a future deployment without sending test messages to real recipients.
- The worker lists the leads store each run and scans recent leads; this is appropriate only while lead volume is modest. Sustained backlog or a very large store may require a proper indexed, atomic queue and alerting. The 30-second Netlify scheduled-function limit may interrupt a slow external request.
- Successful lead persistence cannot protect against a lost HTTP response followed by a customer manually submitting again; there is no submission-level deduplication. No retry can recover a lead whose initial Blob write failed.
- Payload snapshots contain customer data and photo links, as does the lead itself. The admin lead API omits `quoteEmails`; snapshots remain in storage for retries. Restrict Blob access and apply the same retention and deletion policies to both lead and retry records.
- A response without a non-empty message ID remains a retryable `missing_message_id` failure. Failure records and logs retain only known provider error codes and numeric HTTP status codes, not free-form provider messages or response headers.

Run mocked tests with:

```powershell
node --experimental-test-module-mocks --test tests\quote-request.test.mjs tests\quote-email-retry.test.mjs tests\admin-leads.test.mjs tests\order-notifications.test.mjs
```

Offline packaging was verified with the installed `@netlify/zip-it-and-ship-it` 16.6.0; the generated API-v2 bundle includes the five-minute schedule. This does not verify Linux deployment, live scheduling or delivery.
