# Transactional email copy editor

In the authenticated admin dashboard's content editor, select Quote notification, Quote acknowledgement, Order notification, or Order confirmation. Save a private draft, preview with synthetic data, then explicitly publish. Draft history, committed publication history, restore-to-draft and compare/rebase use `createScopedContentRepository` with strong ETags and conditional writes. Conflicts preserve the draft; there is no automatic rebase.

The scopes are `email.quote-notification`, `email.quote-acknowledgement`, `email.order-notification` and `email.order-confirmation`. They use the existing private drafts/publication-history stores and published-head store. Public content routes cannot read these scopes. Only admin/super sessions may edit or preview; all editor responses are private/no-store.

## Editable fields

- **Subject:** plain text, 1–300 characters, no newlines or header controls. Variable expansion is bounded and validated before sending.
- **Body:** up to 4,000 characters of replacement plain-text narrative, with the same interpolated wording in HTML and plain text. HTML is not supported: both authored copy and variable values are escaped. Blank body removes the narrative, leaving protected transaction details and links. Defaults preserve the original greeting, response/shipping expectations and follow-up meaning.
- Quote variables: `{{firstName}}`, `{{customerName}}`, `{{service}}`. Quote notification also allows `{{customerEmail}}`.
- Order confirmation variables: `{{firstName}}`, `{{customerName}}`, `{{orderNumber}}`, `{{total}}`. Order notification also allows `{{title}}`.

Variables are replaced once, with no expressions, nesting, arbitrary properties, or evaluation. Sender, recipients, reply-to, tags, entity headers, credentials, secure links and markup are not editable. Quote details/photos/service identification and order items/totals/payment details remain protected. Greetings, the 3–5 business day quote-response wording, shipping expectations and follow-up instructions are editable narrative; deleted original paragraphs are not appended again.

The replacement-body contract uses schema `email-copy-v2`. Earlier `email-copy-v1` drafts/publications had supplemental-body semantics and cannot be restored/published under the new contract without review. Incompatible published records use logged built-in defaults until an admin saves and publishes a reviewed v2 draft. Already queued quote payloads remain unchanged.

## Sending and failure behavior

Before saving a quote, published email copy is rendered into its immutable `quoteEmails` payloads, including schema/revision/fallback metadata. Retry sends use these persisted payloads and never read current CMS text. Publishing/restoring later cannot change an existing queued quote email or its idempotency payload.

Email CMS read errors or invalid/incompatible published records produce sanitized `[email-cms]` logs and use built-in copy. Quotes remain accepted with a fallback snapshot; order notifications/confirmations retain their original transactional details. Missing published heads also use defaults, without treating initial setup as an outage. In contrast, published quote-form configuration read failure logs `[quote-form]` and returns 503 before accepting a quote, because choices cannot safely be guessed.

Private previews contain synthetic data and editable copy only, not actual customer/order records or the complete locked receipt layout. They are sandboxed, contain no active links/scripts, and never call Resend.

## Known limits and validation

- Order sends atomically create fully rendered payloads in the private, strongly consistent `order_email_snapshots_v1` store using v11 `onlyIfNew`. Records are keyed `<order-id>/notification` and `<order-id>/confirmation`; each includes the complete message, creation time and stable `order-notification/<id>` or `order-confirmation/<id>` provider key. Concurrent workers always reread and send the committed winner, never their losing candidate. Existing snapshots bypass CMS reads; publication, recipient-setting and order-field changes do not change a pending message.
- Unavailable/invalid snapshot reads, writes, winners or unsupported conditional-write responses fail explicitly without sending that message. The webhook returns 500 for missing email delivery or failure to persist a confirmation sent marker, allowing Stripe retries. Notification and confirmation are attempted independently, so a customer receipt failure does not prevent Drew's notification. An ambiguous snapshot write is recovered by reading its committed record on the next attempt. Existing order fields are preserved when marking email delivery; historical-import and existing sent-flag guards remain unchanged.
- Restrict access and apply customer-data retention/deletion policies to order snapshots as well as orders. Do not delete or overwrite snapshots to rebase pending emails. Check sanitized `[order-email]` failures and webhook logs; compare the snapshot with provider history when reconciling ambiguous sends. Snapshot existence means payload persistence, **not** provider acceptance or inbox delivery.
- Resend keeps provider idempotency keys for 24 hours. Persisted identical payloads remove CMS races but do not extend that guarantee: a delayed webhook retry after the window may duplicate a previously accepted message if its order sent marker was lost. Reconcile ambiguous delivery before manually retrying after 24 hours. There is no snapshot-store delivery-status dashboard or automated reconciliation.
- Order sent markers are read and written on the shared order record without conditional updates. Concurrent webhook invocations can overwrite each other's markers; provider idempotency limits duplicate sends only within its 24-hour window. Reconcile ambiguous deliveries and address concurrent order updates before relying on markers as durable exactly-once evidence.
- There are no delivery webhooks, automated CMS-outage alerts, or full browser/email-client rendering tests. Check logs and review previews. Publishing to the actual Netlify backend and live delivery were not exercised.
- Conditional-write correctness depends on the existing pinned SDK and compatible backend, as with the website CMS.
- Focused email/quote/snapshot tests cover removal of old wording, competing snapshot creation, publication changes between retries, storage failures, independent checkout/payment retries and historical-import behavior. SDK tests exercise conditional writes and read fixtures using the previous site-wide storage paths. Verify existing stores against an isolated staging deployment before release.
- Offline packaging with the installed `@netlify/zip-it-and-ship-it` 16.6.0 generated API-v2 bundles for the email admin endpoint, both quote functions (including the unchanged five-minute retry schedule), and the updated order webhook with its snapshot helper. No handler was invoked against real services.

Focused offline validation:

```powershell
node --experimental-test-module-mocks --test tests\email-content.test.mjs tests\order-email-snapshot.test.mjs tests\quote-request.test.mjs tests\quote-content-integration.test.mjs tests\quote-email-retry.test.mjs tests\order-notifications.test.mjs tests\admin-leads.test.mjs
```
