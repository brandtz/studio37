# Cloudflare R2 Setup Guide — Studio 37

Studio 37's admin panel uploads product photos to **Cloudflare R2** (S3-compatible storage with **zero egress fees**, generous free tier). This is where every product image lives in production.

> **Why R2?** Netlify Blobs is great for JSON state but not built for serving lots of public binary content. R2 gives Studio 37 an effectively-free image CDN that the admin can write to and the public site can read from.

**You'll need:** a Cloudflare account (free tier is fine), about 15 minutes.

---

## 1. Create a Cloudflare account

If Drew or BWE don't already have one:

1. Go to https://dash.cloudflare.com/sign-up
2. Verify the email
3. (Optional) Enable 2FA — recommended for any account holding production credentials

No credit card is required for the free tier of R2 (10 GB storage, unlimited Class B reads, 1M Class A writes/month).

---

## 2. Enable R2

1. From the Cloudflare dashboard sidebar, click **R2 Object Storage**.
2. The first time you visit, you'll see a "Get Started with R2" splash. Click **Purchase R2 Plan** — despite the name, the free tier requires no payment method until you exceed limits. (This is just Cloudflare's account-tier gate.)
3. If it asks for billing info, you can add a payment method but the free tier won't be charged. Studio 37 will not approach the limits.

---

## 3. Create the bucket

1. Click **Create bucket**.
2. **Bucket name:** `studio37-images`
   (Lowercase, dashes only. The name shows up in URLs.)
3. **Location:** Automatic (default) — Cloudflare picks the closest region.
4. **Default storage class:** Standard.
5. Click **Create bucket**.

---

## 4. Make the bucket publicly readable

By default R2 buckets are private. We need product images to be reachable from the public site.

### Option A — quick: enable the `r2.dev` public URL (good for launch)

1. Open the new bucket → **Settings** tab.
2. Under **Public access**, find **R2.dev subdomain** and click **Allow Access**.
3. Confirm. Cloudflare gives you a URL like:
   `https://pub-<hash>.r2.dev`
4. Copy that URL. **This is your `R2_PUBLIC_BASE`.**

> The `r2.dev` subdomain is rate-limited and intended for development. It's perfectly fine for Studio 37's low-traffic launch but you'll likely want Option B before scaling.

### Option B — production: custom domain (`images.studio37customdesigns.com`)

Do this once the main site domain is on Cloudflare DNS:

1. Bucket → **Settings** → **Custom Domains** → **Connect Domain**.
2. Enter `images.studio37customdesigns.com`.
3. Cloudflare auto-creates the CNAME and TLS cert.
4. Set `R2_PUBLIC_BASE=https://images.studio37customdesigns.com` in Netlify env vars.

---

## 5. Create an API token (the credentials our admin uses)

1. R2 dashboard → **Manage R2 API Tokens** (top-right) → **Create API token**.
2. **Token name:** `studio37-admin-upload`
3. **Permissions:** **Object Read & Write**
4. **Specify bucket:** select `studio37-images` only (don't grant access to all buckets).
5. **TTL:** Forever (or a date — but Drew will need to rotate before expiry).
6. Click **Create API Token**.
7. Cloudflare shows the credentials **once**. Copy:
   - **Access Key ID** → `R2_ACCESS_KEY`
   - **Secret Access Key** → `R2_SECRET_KEY`
   - **Account ID** (shown above the token, also on the R2 home page) → `R2_ACCOUNT_ID`

> If you miss the secret, you have to delete the token and create a new one.

---

## 6. Set the env vars in Netlify

Netlify dashboard → Studio 37 site → **Site configuration → Environment variables → Add a variable**. Add each:

| Key                | Value                                          |
| ------------------ | ---------------------------------------------- |
| `R2_ACCOUNT_ID`    | Cloudflare account ID                          |
| `R2_ACCESS_KEY`    | Access Key ID from step 5                      |
| `R2_SECRET_KEY`    | Secret Access Key from step 5                  |
| `R2_BUCKET`        | `studio37-images`                              |
| `R2_PUBLIC_BASE`   | `https://pub-<hash>.r2.dev` (or custom domain) |

Scope: **Production**, **Deploy Previews**, **Branch deploys** — all three.

Then trigger a redeploy (Deploys → Trigger deploy → Clear cache and deploy) so the running functions pick up the new env.

---

## 7. Smoke test

After the redeploy:

1. Open `https://studio37customdesigns.com/admin/`.
2. Log in with the admin key.
3. Click **+ New Product**, fill in name/price, drag an image into the upload zone.
4. Save. Refresh the product list.
5. Click the product — the image thumbnail should load from your R2 public URL (right-click → Inspect → confirm the URL starts with `R2_PUBLIC_BASE`).
6. As a final check, paste the image URL into a private window — it should load without auth.

If the upload fails:
- Check the Function logs in Netlify (Logs → Functions → `admin-upload`) — look for `r2_not_configured` (env vars missing) or AWS SDK errors (creds wrong / bucket name wrong).
- Most common mistake: pasting the **token value** as `R2_ACCESS_KEY` instead of the **Access Key ID**. They are different fields — the secret is longer.

---

## 8. Cost expectations

Studio 37's expected scale (low — a craftsman's portfolio site, dozens of products, hundreds of monthly visitors):

| Resource       | Free tier       | Studio 37 use  |
| -------------- | --------------- | -------------- |
| Storage        | 10 GB / month   | < 100 MB       |
| Class A ops    | 1M / month      | < 100 / month  |
| Class B reads  | 10M / month     | < 10K / month  |
| **Egress**     | **Always free** | n/a            |

Bottom line: R2 is **free** for Studio 37's traffic. The only way it costs money is if Studio 37 starts hosting tens of thousands of high-resolution images.

---

## Maintenance notes

- **Rotate the API token** annually as a good-hygiene baseline. Create the new token, update Netlify env vars, redeploy, then delete the old token in Cloudflare.
- **Backups:** R2 is durable (replicated), but Drew owns the originals on his local machine. Don't treat R2 as the only copy of the photography.
- **If R2 goes down:** the public site still loads; product images would 404 until R2 is back. Snipcart checkout doesn't depend on R2.

---

## Future: signed URLs / private bucket

If Studio 37 ever wants invoice PDFs, customer-only assets, or proofs that aren't public, the admin function can be extended to issue presigned URLs. The bucket stays private, the function generates a short-lived URL on demand. That's a future enhancement; nothing to set up now.
