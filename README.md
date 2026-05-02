# vibestats

A minimalist, self-hosted website analytics service. Drop one `<script>` tag on any page in your hard-coded list of authorized domains and you get daily visitors, page views, country, OS, browser, referrer, and search-term breakdowns on a public dashboard at `/<your-domain>/`.

No cookies. No login. ~250 lines of server code, ~250 lines of Svelte.

---

## 1. Install

### Prerequisites

- **Node.js 20+** (`node --version`)
- A free **Supabase** project (https://supabase.com) — used as managed Postgres
- A free **Railway** account (https://railway.app) — used to host the Node app
- Both have generous free tiers; total cost = $0 for low-traffic sites.

### 1.1 Set up the database

1. Create a new project on Supabase. Wait for it to provision (~2 minutes).
2. Open **SQL Editor** in the Supabase dashboard.
3. Paste the contents of [`schema.sql`](./schema.sql) and click **Run**.
4. Open **Project Settings → Database → Connection string → URI** and copy it. It looks like `postgres://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres`. This is your `DATABASE_URL`.

### 1.2 Run locally

```bash
git clone <this-repo> vibestats && cd vibestats
npm install
cp .env.example .env
# edit .env — fill in DATABASE_URL and ALLOWED_DOMAINS
npm run build       # builds the Svelte dashboard once
npm start           # starts the Express server on :3000
```

Open http://localhost:3000 — you'll see the homepage listing your tracked domains. Click one to view its (empty) dashboard.

For dashboard development with hot reload, run two terminals:
```bash
npm run dev:server    # backend on :3000
npm run dev:dashboard # Vite dev server on :5173, proxies /api to :3000
```

### 1.3 Deploy to Railway

1. Push this repo to GitHub.
2. In Railway, **New Project → Deploy from GitHub repo** → pick the repo.
3. Railway auto-detects Node, runs `npm ci && npm run build && npm start`.
4. Add environment variables in **Variables**:
   - `DATABASE_URL` — from Supabase
   - `ALLOWED_DOMAINS` — comma-separated, e.g. `myweb.cz,example.com`
   - `PUBLIC_BASE_URL` — your Railway public URL, e.g. `https://vibestats.up.railway.app`
5. Deploy. Open the public URL → you should see the homepage.

### 1.4 Embed the tracker

On every page of every domain you listed in `ALLOWED_DOMAINS`, add:

```html
<script async src="https://your-vibestats-instance.up.railway.app/track.js"></script>
```

That's it. Reload your site, then check the dashboard at `https://your-vibestats-instance.up.railway.app/myweb.cz/`.

### 1.5 Stop tracking your own visits

Visit any tracked page once with `?vs_optout=1` appended to the URL (e.g. `https://myweb.cz/?vs_optout=1`). The tracker writes a flag to your browser's `localStorage` and silently skips all future events from that browser. Repeat on each device. To re-enable, use `?vs_optout=0`.

---

## 2. Architecture

The whole product is five moving parts. Understanding what each one does — and *why it lives where it does* — is the educational part.

```
                                                       ┌────────────────────┐
                                                       │   Supabase         │
   ┌──────────────────────┐                            │   (Postgres only)  │
   │  Visitor's browser   │                            │                    │
   │  on myweb.cz         │                            │  table: events     │
   │                      │                            │  ┌──────────────┐  │
   │  loads page          │                            │  │ domain       │  │
   │       │              │                            │  │ visitor_id   │  │
   │       ▼              │                            │  │ path         │  │
   │  <script src=        │                            │  │ referrer     │  │
   │   ".../track.js">    │                            │  │ country      │  │
   │       │              │                            │  │ os, browser  │  │
   │       ▼              │  ① GET /track.js (cached)  │  │ created_at   │  │
   │  evaluates script    │ ◄──────────────────────────┤  └──────────────┘  │
   │       │              │                            │                    │
   │       │ if host in   │                            └─────────▲──────────┘
   │       │ allowed[]    │                                      │
   │       ▼              │  ② POST /collect (sendBeacon)        │ insert
   │  navigator           ├──────────────────────────────────────┤
   │  .sendBeacon(...)    │                            ┌─────────┴──────────┐
   └──────────────────────┘                            │   Railway          │
                                                       │   (Node + Express) │
   ┌──────────────────────┐                            │                    │
   │  Anyone's browser    │  ③ GET /myweb.cz/  (HTML)  │   server.js        │
   │  visiting            │ ◄──────────────────────────┤   ├ /track.js      │
   │  vibestats/myweb.cz  │  ④ GET /api/stats/myweb.cz │   ├ /collect       │
   │                      │ ◄──────────────────────────┤   ├ /api/stats/:d  │
   │  Svelte SPA          │       (JSON)               │   └ /:domain/* SPA │
   │  + D3 charts         │                            │                    │
   └──────────────────────┘                            └────────────────────┘
```

Numbered above are the four HTTP exchanges in the system. Everything else is detail.

### 2.1 The tracker (`/track.js`)

The browser snippet is a self-contained, ~30-line IIFE. It is **not** a static file — Express renders it on each request, injecting `ALLOWED_DOMAINS` and `PUBLIC_BASE_URL` from environment variables:

```js
// server.js — track.js handler
const body = trackerTemplate
  .replace('__ALLOWED__', JSON.stringify(ALLOWED_DOMAINS))
  .replace('__ENDPOINT__', `${PUBLIC_BASE_URL}/collect`);
res.set('Cache-Control', 'public, max-age=300');  // cache 5 min at the edge
```

Why server-rendered? Because the allowed-domain list and collection endpoint are deployment-specific. We could ship a generic script that hits `/collect` with relative paths, but baking the absolute URL means the same `<script>` tag works whether the page is loaded over HTTP or HTTPS, from any domain, including locally during development.

When the snippet runs in the browser, it does three things:

1. **Authorize**: compare `location.hostname` against the embedded allowlist. If not present, `alert()` and stop. (This is a soft check — anyone who copies the script could remove it. The server enforces the same rule on `/collect`, which is the real gate.)
2. **Opt-out**: read `?vs_optout=1` from the URL or `localStorage.vs_optout`. If set, stop.
3. **Beacon**: build a tiny JSON payload (`{d, p, r}` — domain, path, referrer) and ship it via `navigator.sendBeacon()`.

Why `sendBeacon` instead of `fetch`? Two reasons:
- It's fire-and-forget — the browser queues the request and guarantees delivery even if the user navigates away mid-request. `fetch` can be aborted by navigation.
- It doesn't trigger a CORS preflight (`OPTIONS` request) when the body type is `text/plain`, saving a round trip.

### 2.2 Collection endpoint (`POST /collect`)

This is where raw beacons become rows. Logic in order:

1. **Parse the body**. `sendBeacon` sends `text/plain`, so we use `express.text()` and `JSON.parse` manually.
2. **Re-check the allowlist** server-side using `body.d`. The client check is a UX nicety; this is the real one.
3. **Identify the visitor** without storing PII:
   ```js
   visitor_id = sha256(`${YYYY-MM-DD}|${ip}|${user_agent}`).slice(0, 32)
   ```
   Same person on same day → same hash → counts as one visitor. The hash rotates daily, so we can't track a person across days. We never store the IP itself.
4. **Enrich** the event:
   - `country` from `geoip-lite` (offline MaxMind lookup — no third-party API call per request)
   - `os` and `browser` parsed from the `User-Agent` header via `ua-parser-js`
   - `search_term` extracted from the referrer's query string if it matches a known search engine (Google, Bing, DuckDuckGo, Yahoo, Yandex, Baidu, Ecosia)
5. **Insert** one row into `events`. Always returns HTTP 204 — the visitor's browser must never see an error from us, even if our database is down.

Express 4 doesn't auto-catch promise rejections in async handlers, so every async route is wrapped:
```js
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
```
That `.catch(next)` hands the error to a final middleware which logs and returns 500 (or 204 for `/collect` so the visitor's page console stays clean).

### 2.3 Stats API (`GET /api/stats/:domain`)

Eight aggregate queries run **in parallel** with `Promise.all`:

| Query | Purpose |
|-------|---------|
| `daily` | one row per day with `count(*)` page views and `count(distinct visitor_id)` visitors |
| `totals` | the same two numbers across the whole window |
| `countries`, `oses`, `browsers` | top 10 by event count |
| `referrers`, `searches`, `pages` | top 10 referring URLs, search terms, and entry paths |

All filtered by `domain = $1 AND created_at >= now() - $2 days`. The two indexes in `schema.sql` make these queries fast even with millions of rows.

Why aggregate on the server every request, instead of pre-computing into a `daily_rollups` table? Because at this scale (one domain, thousands of events/day) Postgres handles it in <50ms and we save ourselves a whole layer of cron-job complexity. If you outgrew this, the upgrade path is a materialized view refreshed hourly — no schema changes needed.

### 2.4 Dashboard SPA (`/:domain/*`)

The dashboard is a Svelte single-page app, built once into `dashboard/dist/` by Vite, then served as static files by Express.

- `dashboard/index.html` is the shell.
- `App.svelte` is the page: KPI cards, a date-range tab bar, and a 2-column grid of cards.
- `lib/LineChart.svelte` is a custom D3 chart. We use D3's `scaleTime` and `scaleLinear` to compute pixel positions, and `line`/`area` from `d3-shape` to generate SVG paths — but **Svelte renders the SVG**, not D3. This is more idiomatic in Svelte (reactive bindings, no DOM diffing fight) and produces a smaller bundle than `import * as d3`.
- `lib/BarList.svelte` is a horizontal bar list reused by all six "top N" panels.

URL routing on the client side is trivial: `App.svelte` reads `location.pathname` once on mount, extracts the domain from `/:domain/`, and that's it. All API calls are scoped to that domain.

The Express server treats `/:domain` and `/:domain/*` as catch-alls that just send `index.html`, so deep-linking and refresh both work. Static assets are mounted at `/assets/*` with a 1-year cache header — they're hashed by Vite, so cache invalidation is automatic.

### 2.5 Why this stack?

| Choice | Reason |
|--------|--------|
| **Express** | Minimal surface, no magic. The whole server is one file you can read top-to-bottom. |
| **Postgres (via Supabase)** | We need `count(distinct ...)`, `date_trunc`, top-N queries, and indexes. SQLite would also work but Supabase gives us a managed instance for free. |
| **Direct `postgres` driver** | We're not using Supabase's auth, RLS, or realtime features — only its Postgres. The `postgres` npm package is ~20× smaller than `@supabase/supabase-js` and gives us tagged-template SQL with built-in parameter binding (no SQL injection possible). |
| **Svelte + Vite** | Smallest viable framework with build-time compilation. Final bundle is ~22 KB gzipped vs ~140 KB for an equivalent React app. |
| **D3 sub-packages** | Importing only `d3-scale`, `d3-shape`, `d3-array`, `d3-time-format` — about 30 KB total instead of D3's full 200+ KB. |
| **`geoip-lite`** | Country lookup happens locally from a bundled MaxMind database. Zero per-request external calls = no rate limits, no privacy leaks, predictable latency. |
| **`navigator.sendBeacon`** | Reliable cross-page delivery, no CORS preflight, fire-and-forget. The standard for analytics pings. |

### 2.6 Privacy design

A few decisions worth calling out, because students often ask "why not just store the IP?":

- **No cookies, no fingerprinting.** Visitor de-duplication uses a daily-rotating hash, which means we *cannot* track a person across multiple days even in principle.
- **IPs are never stored.** They're inputs to the hash and the country lookup, then discarded.
- **No third-party requests.** Country resolution happens locally; nothing leaves your server except the JSON the dashboard requests.
- **Public dashboards.** Stats are visible to anyone who knows the URL — appropriate for blog/portfolio sites, *not* for sensitive internal tools. If you need access control, add it as a layer in front of `/api/stats/*` and `/:domain/*`.

### 2.7 What's intentionally not here

To keep the codebase under ~500 LOC total, several things were left out. Each is a good exercise to add:

- **Bot filtering** — a UA blocklist or behavioral filter (e.g. ignore visits with no `referrer` and a `headless` UA).
- **Session duration / bounce rate** — would require a second beacon on `pagehide`.
- **Per-page funnels** — needs a sessions table linking events from the same `visitor_id` within N minutes.
- **Materialized rollups** — speeds up dashboards once you have millions of events.
- **Rate limiting on `/collect`** — currently anyone can flood the endpoint. Add `express-rate-limit` keyed on IP if you expose this publicly.

---

## 3. File map

```
server.js              Express app: tracker, collect, stats API, SPA serving
schema.sql             Postgres schema (1 table, 2 indexes)
package.json           Node deps + scripts
vite.config.js         Svelte/Vite config
.env.example           Required environment variables
dashboard/
  index.html           SPA shell
  src/
    main.js            Svelte mount point
    App.svelte         Page layout, KPIs, range selector
    api.js             fetchStats() + URL parser
    app.css            Dark theme, responsive grid
    lib/
      LineChart.svelte SVG line chart with D3 scales
      BarList.svelte   Horizontal bar list (reused 6 times)
```

## 4. License

MIT — do whatever you want.
