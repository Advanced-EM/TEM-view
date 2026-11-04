# TEM-view session collector: Cloudflare Worker

A free, always-on alternative to the Docker Space (`../space`), which needs a paid Hugging Face plan. It
receives the sessions visitors chose to share. It then:
- validates them with the same rules as `../space/schema.py`
- commits each one to the dataset as `raw/<scenario>/<session id>.json` through the Hub commit API

The Hugging Face token is a Cloudflare secret and never reaches the browser.

## Deploy (once)

```bash
cd hf/worker
npm install
npx wrangler login
npx wrangler secret put HF_TOKEN
npx wrangler deploy
```

- `npx wrangler login` opens the browser for a free Cloudflare account.
- At the `secret put` prompt, paste a fine-grained token with write access to the dataset only.
- `deploy` prints the URL, e.g. `https://tem-view-collector.<your-subdomain>.workers.dev`.

Open that URL. It should show `"dry_run": false`. Then set `url: '<that URL>/submit'` in `js/config.js`, run
`node tools/stamp.mjs`, and deploy the exhibit.

`wrangler.toml` holds `DATASET_REPO` and `ALLOWED_ORIGINS` (the exhibit's site and localhost for testing). It
also holds a rate limit of 10 sessions per minute per visitor, keyed on a daily salted hash, and nothing is
stored. The free plan allows 100,000 requests per day.

## News mailing list

The exhibit's "Subscribe for news" form posts the visitor's email to `/subscribe`. The address is stored in a
Cloudflare KV namespace that only your Cloudflare account can read. It never goes to the public dataset.

Set it up once:

```bash
npx wrangler kv namespace create SUBSCRIBERS
```

Paste the `id` it prints into `wrangler.toml` (replacing `PASTE_THE_ID_HERE`), then run `npx wrangler deploy`.
The status page (`/`) then shows `"mailing_list": true`.

Each subscriber gives a name, an email, an optional institution, and a role: student, staff, faculty or
hobbyist. To export the list as a spreadsheet:

```bash
node export-subscribers.mjs > subscribers.csv
```

The CSV holds personal data, so keep it private (`subscribers*.csv` is git-ignored). Each record is stored under
the key `email:<address>`. To remove someone, run
`npx wrangler kv key delete --binding SUBSCRIBERS --remote "email:<address>"`.

## Usage metrics

The exhibits post anonymous usage records to `/usage` (see `../../privacy.html` and `../../js/usage.js`). The Worker
adds the city-level location Cloudflare attaches to each request and, with the `USAGE_SALT` secret, a visitor
key that changes daily. It never stores the IP address. Records go to a D1 database and, every day at 02:10 UTC,
the previous day is committed to `USAGE_REPO` as `usage/<year>/<day>.jsonl`. Rows older than 90 days are dropped.

Set it up once:

1. On Hugging Face, create a **private** dataset `rmsreis/tem-view-usage` (or change `USAGE_REPO` in
   `wrangler.toml`). The `HF_TOKEN` secret needs write access to it as well as to the alignment dataset.
2. Create the database and its table:

   ```bash
   npx wrangler d1 create tem-view-usage
   npx wrangler d1 execute tem-view-usage --remote --file usage.sql
   ```

   Paste the `database_id` it prints into `wrangler.toml` (replacing `PASTE_THE_ID_HERE`).
3. Set the salt for the visitor key to a long random string, and keep it secret:

   ```bash
   openssl rand -hex 32 | npx wrangler secret put USAGE_SALT
   ```

4. Run `npx wrangler deploy`. The status page (`/`) then shows `"usage": true`.

To see today's records before the daily commit:

```bash
npx wrangler d1 execute tem-view-usage --remote --command "SELECT record FROM usage WHERE day = date('now')"
```

Without the D1 binding, `/usage` answers 204 and stores nothing; without `USAGE_SALT`, records carry no visitor
key.

## Test

```bash
node test.mjs
```

This runs offline, with the Hub mocked. `npx wrangler dev` runs the Worker locally on port 8787.
