# Website Content editor

## Status and verified API evidence

The admin **Content** section supports private text drafts, non-interactive layout previews, immutable draft history, **conditional publishing**, committed publication history, and restore-as-new-draft. Publishing is available only for a saved, unchanged draft with its original published revision and strong ETag.

The prior Blobs v8 blocker is resolved by pinning `@netlify/blobs` to **11.1.10**. Evidence checked on November 23, 2026:

- [Netlify's API reference](https://docs.netlify.com/build/data-and-storage/netlify-blobs/#set) explicitly describes `onlyIfNew` and `onlyIfMatch` as **atomic, conditional writes**, returning `{ modified, etag }`; the same options are documented for `setJSON`.
- [Upstream changelog](https://github.com/netlify/primitives/blob/blobs-v11.1.10/packages/blobs/CHANGELOG.md): v9 still lacks conditional writes; v10 introduced them, **10.7.12 fixed conditional headers in `setJSON`**, and **11.1.7 fixed concurrent conditional conflicts**. Earlier versions are not substituted for the pinned version.
- The published 11.1.10 npm artifact was inspected: `setJSON` forwards conditions; the client sends `If-None-Match: *` or `If-Match: <etag>` to the actual edge/signed-URL write; HTTP 409 and 412 return `modified: false`. [The upstream concurrency fix](https://github.com/netlify/primitives/commit/004761048faf5346c3ae50b68c9fd0263dc0986d) is included.
- Focused tests exercise the **real installed SDK** against an injected atomic HTTP model, including overlapping creates/replacements, both conflict statuses, signed-URL writes, and v8/v11 site-wide URL compatibility.

**This is API/source evidence plus local tests, not a production atomicity certification. No Netlify data, deployed runtime, or live service was contacted.** In-process locks, blob locks, read/check/unconditional-write, refreshed-ETag automatic retries, and other workarounds are not used.

## Dependency migration risks and remaining blockers

- **Runtime:** the project requires **Node >=22.13.0** for its upgraded Netlify CLI. The build configuration requests Node 22; verify the deployed Functions runtime is also compatible and is not overridden to an older version. Local validation used Node 22.16.0.
- **Existing site-wide stores:** `getStore({ name, consistency: 'strong' })`, the `site:` namespace prefix, unspecified site-wide region, JSON representation, and read/list/delete APIs remain compatible. Existing unconditional callers ignore the new write-result object. No store names, regions, keys, seeds, or existing data were changed. Changing a region would not migrate data; no region option was introduced.
- **Tooling:** Netlify CLI has been upgraded separately from the application SDK. Its filesystem emulator must **not** be used as proof of cross-instance CAS: even the newer SDK's filesystem emulator checks preconditions separately from the final rename. Verify the CLI upgrade and remote runtime context before release.
- **Dependencies:** v11 adds runtime/telemetry/dev-utils dependencies and optional platform packages. The lockfile and Netlify CLI were also updated for dependency remediation. Perform a clean Linux dependency install and function packaging check before deployment; local Windows packaging is not Linux runtime validation.
- **Legacy drafts:** earlier drafts without a stored base remain readable and preserved, but cannot publish directly. Review current published differences, accept that base, and save a new draft, or explicitly restore as a new draft.
- **Templates:** old-schema drafts/publications cannot be restored onto changed markup. An incompatible existing published snapshot intentionally fails closed; a reviewed schema migration is required, not an automatic reseed/reset.
- **Rollback:** restoring the old dependency disables usable CAS and must not leave publishing exposed. Keep publication/history stores intact. Roll back code/dependencies together; do not replace conditional writes with unconditional writes.
- **Operational verification pending:** on an isolated noncustomer staging store, verify strong ETags, one winner for overlapping `onlyIfNew`/`onlyIfMatch` writes through actual deployed functions, immutable history reads, correct site/region mapping, and response-loss behavior. This was not run here and must not involve real customer data.

## Editing and preview

1. Sign in to the existing admin dashboard and select Content.
2. Choose a page, edit listed plain-text fields, and Save private draft.
3. Preview current text, including unsaved text, in the sandboxed iframe.
4. Load an earlier saved draft or Restore as new draft. Neither changes the public site.
5. Publish saved draft to replace only that scope's public text. Unsaved edits cannot be published.
6. On HTTP 409, the saved draft remains intact. Use **Review current published differences**, inspect the comparison, explicitly accept the reviewed base, then save a new draft and publish. Another editor can still publish between review and publication, yielding another conflict; no changes are merged automatically.

Each save uses `onlyIfNew` on its UUID key; there is no shared mutable "latest draft" pointer. Two simultaneous saves retain both revisions. History includes timestamps, authenticated actor emails, and restore provenance. Reloading history starts from published/original text; select a saved revision explicitly to continue editing. Restoring either draft or committed publication history creates a new private draft against the current published base, never an immediate publication.

### Publication commit protocol

1. Read the saved draft and require its schema and original `{ revision, etag }` base. Reject client attempts to substitute a newer base for the same immutable draft.
2. Strong-read the published snapshot and compare its revision and ETag with that saved base. A mismatch returns 409 without replacing it.
3. Preserve the previous snapshot and the new candidate in an isolated immutable publication archive using `onlyIfNew`. An archive error stops publication before its head is changed. Existing archive IDs must contain identical data.
4. Change **one published snapshot key** with `onlyIfNew` when absent, or `onlyIfMatch` with the exact previously read ETag. This conditional write—not the preliminary comparison—is the concurrency boundary.
5. A write response confirms a commit only with `modified: true`. A failed precondition returns 409; if the SDK retried after a lost response, an exact readback of the same candidate can confirm that candidate's commit without rebasing.
6. Committed history follows the published snapshot's parent-revision chain. Failed candidates/orphans are not included or restorable. No atomic multi-key transaction or atomic multi-page/shared-and-page publication is claimed.

Candidate archives can remain after a failed CAS or interrupted request. They are private and never treated as committed content; cleanup/export tooling is not implemented. A thrown/timeout write can have an ambiguous outcome: reload committed state/history before retrying. The UI does not automatically retry or accept a new base.

Preview uses the original local HTML and the trusted chrome templates from `site.js`; CMS values are applied to existing text nodes, never parsed as HTML. Page scripts, event-handler attributes, forms, links, embedded frames, and inputs are disabled. Product/review/carousel data and live Site Settings hydration do not run, so preview is **not** a checkout/form/dynamic-data integration preview. It shows fallback business details. Preview is in memory, has no public draft URL, and requires no token embedded in a URL or iframe.

## Implemented scope

The page and shared registry has **322 fields**. The editor moves 29 quote-form text nodes out of Contact into the 79-entry **Quote form** scope. Shopping-cart and dynamic-message scopes add 63 entries; SEO scopes add 36, for **471 editable entries** without duplicate ownership:

| Scope | Fields | Included surfaces |
|---|---:|---|
| Shared | 18 | Desktop/mobile/footer navigation, accessible labels, quote CTAs, footer description, headings and site credit |
| Shopping cart | 27 | Cart labels, availability warnings, checkout messages and accessible labels |
| Shop, product and review messages | 36 | Dynamic shop/product labels, review messages and quote prefill wording |
| Home | 49 | Hero (line break retained), visible service tiles, slab copy/rates, about teaser, section headings, CTAs and accessible image text |
| About | 19 | Hero, biography, craft cards, CTA and accessible image text |
| Services | 72 | Visible service headings, rates, descriptions, lists, metadata labels, CTAs and accessible image text |
| Portfolio | 67 | Hero, filters, CTA, image descriptions and gallery captions |
| Shop | 12 | Hero, static filter labels, CTA and accessible text |
| Product | 2 | Shared product-page navigation text and accessible text; product records remain in Products |
| Contact | 15 | Hero and sidebar text; 29 legacy form entries stay in storage/schema for compatibility but are no longer edited or applied here |
| Quote form | 79 | 29 existing labels/legends/notices/helpers/radio captions, 14 optional per-control help texts, 4 dropdown prompts, 3 service group headings, submit caption, 4 dropdown choice lists and 24 status/error messages |
| Reviews | 18 | Hero, review invitation, static form labels, placeholders and confirmation copy, CTA |
| 404 | 6 | Hero, accessible text and navigation CTAs |
| Order confirmed | 8 | Static confirmation copy, accessible text and shopping/contact links |
| Stripe onboarding complete | 7 | Merchant onboarding completion copy and accessible text |
| SEO scopes | 36 | Existing title, description and Open Graph text; see [SEO content](seo-cms.md) |

**Not covered:** Stripe-hosted checkout text; dynamically generated product names, descriptions and pricing (continue using Products); submitted reviews (continue using Reviews); rating values, canonical URLs and structured data; URLs or business/contact details (continue using Settings); unavailable or unlicensed offers. Site-media alt text and the Settings business tagline remain fallbacks until their corresponding CMS fields are published. SEO metadata is rendered server-side; other page text is hydrated in the browser.

Text with nested inline elements is edited as separate text fragments, preserving `<br>`, emphasis, links, input controls, and surrounding layout. Alt text, accessible labels, placeholders and gallery captions are applied as attributes, not HTML. Nonempty image descriptions and accessible labels must remain nonblank. A published CMS image description or shared footer description takes precedence over the corresponding Site Media or Settings fallback. Quote labels/prompts/submit/group headings must remain nonblank; optional added help may be empty. Empty text never removes a control or changes its requiredness.

### Quote presentation and unavailable offerings

Choose **Quote form — labels, help, choices and messages** in Content. Labels, guidance, dropdown prompts, group headings, submit caption, status and error messages and all four dropdown lists publish together under one `quote-form` head. Choices support accessible add/remove/reorder controls and label editing; each ID is displayed read-only. New IDs use `opt-<32 UUID hex characters>`. Never repurpose an old ID for a different offering: relabeling preserves its identity, while a new offering needs a new choice. Fields/types/requiredness and the yes/no/contact-method radio values remain code-owned.

The editable dropdowns are **customerType (5 defaults), service (25), budget (5), referral (5)**. Choices are JSON-encoded strings inside the flat CMS text map, decoded as ordered `{ id, label }` rows; service rows also require a code-allowlisted `group` (`live-edge`, `custom-orders`, `home-goods`, or `none`). Contiguous groups preserve the exact row order; Other remains ungrouped by default. IDs are unique lowercase ASCII letters/digits/hyphens, 1–40 characters, including existing numeric budget IDs. Labels are unique plain text, 1–160 characters. Lists permit at most 80 choices; the two required dropdowns must keep at least one. Unknown properties, duplicate IDs/labels, path-like IDs, and unavailable sauna IDs/labels are rejected server-side. The service's published Home goods group controls the existing optional engraving add-on on both client and server; it does not change requiredness. Limits, required controls, validation policy, photo limits and radio values are not editable.

`/.netlify/functions/quote-form-content` is a published-only, no-store GET returning `{ schema, revision, values }`. There are no draft parameters. The `quote-form-v2-<contact template fingerprint>` schema protects positional label targets and includes editable messages. Missing quote publications inherit nonblank form text from compatible **published** Contact values, otherwise safe code defaults; the Contact head and all historical data remain untouched. The admin starts with the same inherited values. Legacy blank labels use accessible code defaults. A first quote publication takes over those form surfaces; old Contact drafts/publications are preserved but no longer control them. Any earlier quote-form v1 drafts or publications require a reviewed schema migration.

`_lib/quote-form.mjs` exports `createQuoteFormReader(repository?)`, `readQuoteForm`, and `quoteChoiceMaps(record)`. Quote submission strong-reads this same published scope, validates required and optional dropdown IDs against its choices, and enforces the existing deadline/engraving rules. The browser submits `quoteSchema`/`quoteRevision`; mismatches return 409 before uploads/persistence, refresh choices without clearing typed details, and require review/resubmission. Older clients without presentation metadata still validate against current published IDs. Storage/schema failures return 503, not permissive stale-option fallback. Validation is against the snapshot read during the request, not an atomic transaction combining publication and lead creation.

New leads retain stable raw IDs and add `quotePresentation: { version: 1, schema, revision, labels }`. Notification/acknowledgement payloads are resolved and queued immutably **before** persistence. Admin lead views prefer the saved label snapshot, then historical dictionaries/raw IDs. Relabeling or removing a choice does not rewrite past leads or queued emails.

Unavailable sauna references are removed from public Home markup, the public content registry, quote choices and prefills. Services already had no sauna section/reference and is checked explicitly. `/saunas`, `/saunas.html` and descendants temporarily redirect to Services; the fallback page advertises no offering and uses `noindex,nofollow`. The original page is preserved privately at `_lib/saunas.archived.html`, outside the publish build. Public products (list/detail and static fallback), categories and sauna media slots are read-filtered; no product/category/lead records, seeds, statuses or IDs are changed. The retired renderer is archived privately too. Existing stored sauna leads remain readable in admin. Re-enabling requires an intentional code/registry/routing review.

**Limits:** no live stored content/customer data was inspected or changed; arbitrary previously authored references inside unrelated published copy, reviews or custom media cannot be certified absent. Existing browser caches/search indexes and already-open tabs are not purged. Checkout also rejects hidden products, including products submitted from cached carts, but this has only been verified locally. Runtime/deployed CAS and isolated staging checks remain pending.

## Storage, authorization, and failure behavior

- Functions: `/.netlify/functions/admin-content` and `/.netlify/functions/public-content`. No additional rewrite is needed.
- Admin GET/POST uses existing session verification **and** explicitly requires the current stored user's `admin` or `super` role.
- Isolated stores: `website_content_drafts_v1` for immutable private drafts, `website_content_published_v1` for committed snapshots, and `website_content_publications_v1` for immutable publication archives. Existing products, media, settings, leads and users are not modified or reseeded.
- No automatic seeding, deletion, deployment, or external service calls.
- Public reads access published storage only; query parameters cannot opt into drafts or candidate archives. Visitors see only the current committed snapshot, with original HTML as the fallback.
- APIs use `private, no-store`; mutations reject unknown keys, stale schemas, nontext values, control characters, text fields over 4,000 characters (quote choice-list strings have a 20,000-character cap), scope values over 100 KB, and bodies over 180 KB.
- A failed save/storage operation returns 503, not a success message; stale publishing returns 409. Missing/invalid conditional-write results or strong ETags fail closed. Public hydration keeps source HTML on API/storage failures. Draft history uses the full Blobs pagination iterator; publication history follows the committed chain. Both fail closed above 5,000 records; archival/export UI is not implemented.

## Template maintenance and focused tests

The allowlist is generated from reviewed static HTML and named dynamic copy:

```powershell
python scripts\generate-content-schema.py
python scripts\generate-content-schema.py --check
node --test tests\content.test.mjs tests\content-sdk.test.mjs
node --experimental-test-module-mocks --test tests\quote-request.test.mjs tests\public-availability.test.mjs tests\quote-email-retry.test.mjs
node --experimental-test-module-mocks --test tests\quote-content-integration.test.mjs
```

Review regenerated selectors, defaults, field counts, and schema changes before release. Field IDs are template-local positions, not portable across reordered templates; the schema fingerprint prevents old snapshots from applying to changed layouts. Changing inline structure or field ordering changes that fingerprint. The generator deliberately excludes head metadata, scripts, SVG, dynamic grids, options, honeypots, submit buttons, and commented/hidden offers.

Tests use in-memory storage/injected authorization and the real SDK with an injected HTTP transport; they never access Netlify or customer services. Cloud atomicity, real runtime context, and Linux deployment behavior remain unverified.

### Follow-up verification and file inventory

Final offline suite: **89 passed, 0 failed**. The public build includes the quote CMS assets and excludes the private historical template/renderer. All seven affected functions packaged successfully with installed Netlify tooling. Mocked browser/DOM checks covered inert markup, preserved inline spacing, exact choice order across groups, associated labels/help, unchanged required controls, stable generated IDs, saved-draft publish eligibility, preserved password-drawer text, and choice-conflict refresh retaining entered details. These were not live authenticated/deployed-function tests. Final tests used the installed dependency tree; no install or manifest change was performed by this follow-up.

Files changed by this follow-up:

- `netlify.toml`, `src\_redirects`, `src\index.html`, `src\saunas.html`.
- `src\netlify\functions\_lib\saunas.archived.html` and `saunas.archived.js` (private moves of the original page and `src\assets\js\saunas.js` renderer).
- `scripts\generate-content-schema.py`, `src\assets\js\content-schema.js`.
- `src\contact.html`, `src\assets\css\site.css`, `src\assets\js\contact.js`, `quote-options.js`, `quote-form-schema.js`, `content.js`.
- `src\admin\dashboard.html`, `src\assets\js\admin.js`, `content-admin.js`.
- `src\netlify\functions\_lib\content.mjs`, `quote-form.mjs`, `public-availability.mjs`.
- `src\netlify\functions\quote-form-content.mjs`, `quote-request.mjs`, `products.mjs`, `categories.mjs`, `site-media.mjs`.
- `src\assets\js\shop.js`.
- `tests\content.test.mjs`, `tests\quote-request.test.mjs`, `tests\quote-content-integration.test.mjs`, `tests\public-availability.test.mjs`, and this document.

Services was explicitly inspected and tested; it already contained no unavailable offering references.

## Server-only extension point and email templates

Transactional email editing now uses this extension through `_lib/email-content.mjs` and the authenticated `admin-email-content` endpoint. See [Email template CMS](email-template-cms.md) for editing, locked details, fallback behavior and limitations. Only nonsecret field descriptors and variable names are loaded in the admin browser asset; default message copy and published values remain server-side and outside the website public registry.

`src/netlify/functions/_lib/published-content.mjs` exports `createPublishedContentReader({ definitions, store? })`. This is a **read-only, server-side module**; it is not imported into browser assets or registered as an API function. It accepts an explicit consumer-owned scope registry with `{ schema, defaults, maxFieldLength?, validate? }` definitions and returns an async `readPublishedContent(scope)` function.

Records have `{ id, schema, values }` shape in the isolated published store. The reader uses a strong `getWithMetadata` read and returns `{ revision, etag, schema, values }`. Missing records return a copy of the supplied defaults with `revision: null, etag: null`. Stored records must match the consumer's schema and exact field set and contain bounded plain text; an optional validator adds domain-specific constraints. Storage/validation failures throw so the server consumer can choose its own safe fallback policy. The reader never accesses draft storage and never writes anything.

Private consumers can register scopes such as `email.quote-acknowledgement` with `subject` and `body` defaults and a validator prohibiting newlines in the subject. Keep default copy in a server-only module, outside `assets/js/content-schema.js`. Public requests are separately restricted to the website page registry, so supplying `page=email.quote-acknowledgement` returns 404 and cannot expose private template content. The original website CMS did not add email behavior; the separate email integration is described above.

### Repository and schema integration contracts

- Website registry: `assets/js/content-schema.js` exports `{ [scope]: { label, path, schema, fields } }`; each field has `{ id, label, default, targets }`. `schema` is a template fingerprint, not a publication revision or ETag. Do **not** place private email defaults in this public registry.
- Server-only reader definition: `{ [scope]: { schema, defaults: { [field]: string }, maxFieldLength?, validate? } }`. Injected `store()` must support `getWithMetadata(scope, { type: 'json', consistency: 'strong' })`. Read results are `{ revision, etag, schema, values }`; absent records use null revision/ETag.
- `createContentRepository({ registry?, drafts?, published?, publications?, uuid?, now? })` defaults to the website registry plus Quote form. `createScopedContentRepository({ registry, ...sameOptions })` requires an explicit **trusted server-side** registry, allowing private scopes without duplicating CAS/history. Each definition supplies `{ schema, defaults, validate? }` or `{ schema, fields: [{ id, default, maxLength? }], validate?, maxFieldLength? }`. Store factories are functions returning Blobs-compatible stores; default factories use the same three isolated site-wide names. Scope names accept lowercase letters/digits/dots/hyphens, start with a letter, and are at most 80 characters; path separators are rejected.
- `getPublished(page)` returns `{ revision, etag, schema, values }`. `getDraft(page, id)` returns the immutable draft including its `{ revision, etag }` **base**.
- `save(page, values, schema, actor, restoredFrom = null, base = { revision: null, etag: null })` creates an immutable draft. A null/null base specifically means “no published snapshot existed”; it is not permission to overwrite an existing snapshot.
- `publish(page, draftId, base, actor)` publishes that saved draft only, returning `{ revision, etag }`. It does not accept fresh editor values, silently rebase, or merge. `ContentError.status === 409` means stale/conflicting content; storage/conditional-result failures return 503.
- `history(page)` lists draft metadata; `publicationHistory(page)` lists **committed** publication metadata, newest first. `restore(page, draftId, actor)` and `restorePublication(page, publicationId, actor)` create new private drafts on the current base.
- Authenticated HTTP POST actions are `save` (`values`, `schema`, `base`), `publish` (`revision` for draft ID, `base`), `restore` and `restorePublication` (`revision`). GET returns `{ page, schema, current, history, publications, canPublish }`; `?revision=<draft-id>` retrieves one private draft. Public GET continues returning only allowlisted website values, never actor/base/history data.

For example, privately create a repository with `registry: { 'email.quote-ack': { schema: 'email-v1', defaults: { subject: 'Thank you', body: 'We will be in touch.' }, validate(values) { if (/[\r\n]/.test(values.subject)) throw new Error('Subject cannot contain newlines.'); } } }`. Its methods have the same signatures above. `createAdminContentHandler({ repository, requireSession })` uses the injected repository's `definition(scope)` and enforces the existing current `admin`/`super` authorization before storage access. Keep that repository behind an explicit authenticated endpoint; do not register its definitions in browser assets. Public content always checks the independent website allowlist, even when a private repository is injected. A registry is never accepted from HTTP data.
