# Deploying

Cloudflare Pages, by direct upload from a machine that has the data.

Everything below was checked against Cloudflare's documentation on
21 August 2026; where a number matters, the source is linked.

---

## Why not the Git integration

`apps/web/public/data/` is git-ignored and has never been committed. A build
on Cloudflare's runners would check the repository out, run `npm run build`,
and produce a site with no `/data` at all — it would load, fetch its manifest,
get a 404 and show an error. The data has to come from a machine that has run
the pipelines, which means `wrangler pages deploy` and not a connected repo.

Do not connect the GitHub repo to Pages. If you ever do, understand that every
deployment it makes is dataless.

---

## One decision, already taken

The site is built for **https://datenriff.de**. That host is baked into the
canonical links, the `hreflang` pairs, `sitemap.xml`, `robots.txt` and the
atlas page's Open Graph tags — all committed to git.

To change it, one command and a commit:

```bash
SITE_URL=https://datenriff.com npm run build:pages
git add -A && git commit -m "site: canonical host"
```

`datenriff.com` then redirects to it (step 4). Do not skip the commit: CI runs
`git diff --exit-code apps/web/public` and will fail, and the published pages
would point at the wrong host.

---

## 1. Sign in and create the project

Once per machine:

```bash
npx wrangler login
```

Opens a browser for OAuth. Then, once per account:

```bash
npx wrangler pages project create datenriff
```

Choose `main` as the production branch when it asks.

## 2. Deploy

```bash
npm run deploy
```

That is three steps in one: `npm run build`, then `scripts/prune-dist.mjs`,
then `wrangler pages deploy apps/web/dist --project-name datenriff`.

**The prune step is load-bearing, not an optimisation.** Unpruned,
`data/zensus/r10/cells.txt` is 41 MiB and Cloudflare rejects any file over
25 MiB. Pruned, a deployment is about **10,700 files and 292 MiB**, largest
file 2.1 MiB — inside the free plan's 20,000-file limit
([limits](https://developers.cloudflare.com/pages/platform/limits/)).

The first upload sends everything and takes a while. Later ones only send what
changed: wrangler asks the account which file hashes it already has. A
code-only change is a handful of files.

When it finishes you have a working site at `datenriff.pages.dev`. Check it
before attaching the domain.

## 3. Attach datenriff.de

Both of these are root domains, so each must be a zone on Cloudflare with its
nameservers pointed there. If they are still at your registrar, move
`datenriff.de` first — the apex cannot be attached otherwise.

Then, in the dashboard: **Workers & Pages → datenriff → Custom domains → Set
up a domain**, enter `datenriff.de`, continue. Cloudflare creates the DNS
record itself.

**Do not add the CNAME by hand.** Cloudflare's own warning:

> "Manually adding a custom CNAME record pointing to your Cloudflare Pages
> site — without first associating the domain (or subdomains) in the
> Cloudflare Pages dashboard — will result in your domain failing to resolve
> at the CNAME record address, and display a 522 error."

Source:
[custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

## 4. Point datenriff.com at it

Add `datenriff.com` as a zone too, then send it to the canonical host with a
redirect rather than attaching it as a second custom domain — two live hosts
serving identical content split your search ranking and confuse link previews.

**Rules → Overview → Create rule → Redirect Rule**, on the `datenriff.com`
zone:

- If: hostname equals `datenriff.com` (or `Custom filter expression`,
  `http.host contains "datenriff.com"`)
- Then: dynamic redirect, `concat("https://datenriff.de", http.request.uri.path)`
- Status 301, preserve query string

The Free plan allows 10 single redirects
([availability](https://developers.cloudflare.com/rules/url-forwarding/)).

`datenriff.pages.dev` stays live and indexable whatever you do. The canonical
tags now point at `datenriff.de`, which tells search engines which one counts.

## 5. Turn on compression for the data

**This is worth roughly half the bytes the site sends**, and it only became
possible once you owned the zone.

The data files end in `.pack`, `.f32`, `.u8`, `.bin`. Cloudflare serves unknown
extensions as `application/octet-stream`, which is not in its default
compressible list — so they go out raw. Measured on the actual files, gzip
gets tiles to about 49 % and `cells`-style text to 15 %.

**Rules → Compression Rules → Create rule** on the `datenriff.de` zone:

- If: `http.request.uri.path.extension in {"pack" "f32" "u8" "bin"}`
- Then: compression `brotli`, then `gzip`

Free plan allows 10 compression rules, and they require the domain to be
proxied through Cloudflare — which is why this does not work on
`datenriff.pages.dev`
([compression rules](https://developers.cloudflare.com/rules/compression-rules/)).

## 6. Verify

```bash
curl -sI -H 'Accept-Encoding: br, gzip' https://datenriff.de/data/zensus/r8/rent.f32
```

Expect `content-encoding: br` or `gzip`. If the header is missing, step 5 did
not take.

```bash
curl -sI https://datenriff.de/data/manifest.json | grep -i cache-control
```

Expect exactly one `max-age`, and it should be 300. Two values means a
`_headers` rule is matching that path again — the rules are cumulative, a
more specific path does not override a broader one.

```bash
curl -sI https://datenriff.de/ | grep -i cache-control
```

Expect `max-age=0, must-revalidate` for HTML, so a deploy is visible at once.

Then open the site and check: the sculpture draws, the credit under the mode
title names a licence and links it, and `datenriff.com` lands on `.de`.

---

## Afterwards

**A code change:** `npm run deploy`. Incremental, quick.

**A pipeline re-run:** `npm run deploy`, then **purge the cache** — Caching →
Configuration → Purge Everything.

Pages does not purge the edge on deploy. Data files are cached for a day with
a week of `stale-while-revalidate`, and the buffers within one level of detail
are index-aligned: a visitor holding yesterday's metric buffer beside today's
positions buffer would see values attached to the wrong cells. That is worse
than stale, so do not skip it.

**A new dataset:** add a line to `apps/web/public/_headers` for its directory,
or its files fall back to no caching at all.

---

## When something goes wrong

**`Pages only supports up to 20,000 files`** — the prune did not run. Use
`npm run deploy`, not `wrangler pages deploy` on its own.

**A file over 25 MiB** — same cause; `cells.txt` at r10 is the one that trips it.

**`no manifest at … — build first`** — `apps/web/public/data` is empty. The
pipelines have to run on this machine first.

**522 on the custom domain** — the CNAME was added by hand before the domain
was set up in the Pages dashboard. Remove it and use the dashboard.

**CI fails on `git diff --exit-code apps/web/public`** — `SITE_URL` was
changed without committing the regenerated pages.
