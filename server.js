import 'dotenv/config';
import express from 'express';
import postgres from 'postgres';
import { UAParser } from 'ua-parser-js';
import geoip from 'geoip-lite';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
// Treat `www.` and the apex as the same site: strip a leading www. everywhere
// a host is matched or stored.
const normalizeDomain = (d) =>
  String(d || '').trim().toLowerCase().replace(/^www\./, '');

const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || '')
  .split(',')
  .map(normalizeDomain)
  .filter(Boolean);

// Treat `/`, `/index.html`, `/foo/index.html`, etc. as the same page by
// stripping a trailing `index.{html,htm,php}`.
const normalizePath = (p) => {
  const s = String(p || '/').replace(/\/index\.(html?|php)$/i, '/');
  return s || '/';
};

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : 'require',
  prepare: false,
});

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '4kb' }));
app.use(express.text({ type: '*/*', limit: '4kb' }));

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- tracking script ----------

const trackerTemplate = `(function(){
  var allowed = __ALLOWED__;
  var endpoint = "__ENDPOINT__";
  var host = location.hostname.toLowerCase().replace(/^www\./, "");
  if (allowed.indexOf(host) === -1) {
    alert("VIBESTATS: domain " + host + " is not authorized for tracking.");
    return;
  }
  try {
    var optParam = new URLSearchParams(location.search).get("vs_optout");
    if (optParam === "1") {
      localStorage.setItem("vs_optout", "1");
      console.log("[vibestats] opt-out enabled for this browser");
    } else if (optParam === "0") {
      localStorage.removeItem("vs_optout");
      console.log("[vibestats] opt-out disabled");
    }
    if (localStorage.getItem("vs_optout") === "1") return;
  } catch (e) {}
  try {
    var payload = JSON.stringify({
      d: host,
      p: location.pathname,
      r: document.referrer || ""
    });
    var blob = new Blob([payload], { type: "text/plain" });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, blob);
    } else {
      var x = new XMLHttpRequest();
      x.open("POST", endpoint, true);
      x.setRequestHeader("Content-Type", "text/plain");
      x.send(payload);
    }
  } catch (e) {}
})();`;

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

app.get('/track.js', (req, res) => {
  const body = trackerTemplate
    .replace('__ALLOWED__', JSON.stringify(ALLOWED_DOMAINS))
    .replace('__ENDPOINT__', `${baseUrl(req)}/collect`);
  res.type('application/javascript');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(body);
});

// ---------- collection ----------

const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia)\./i;

function extractSearchTerm(referrer) {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    if (!SEARCH_HOSTS.test(u.hostname)) return null;
    return u.searchParams.get('q') || u.searchParams.get('p') || null;
  } catch {
    return null;
  }
}

function dailyVisitorId(ip, ua) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto
    .createHash('sha256')
    .update(`${day}|${ip}|${ua}`)
    .digest('hex')
    .slice(0, 32);
}

app.post('/collect', ah(async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const domain = normalizeDomain(body.d);
  if (!ALLOWED_DOMAINS.includes(domain)) {
    return res.status(204).end();
  }

  const ip = req.ip || '';
  const uaString = req.headers['user-agent'] || '';
  const ua = UAParser(uaString);
  const geo = geoip.lookup(ip.replace(/^::ffff:/, ''));

  await sql`
    insert into events (domain, visitor_id, path, referrer, search_term, country, os, browser)
    values (
      ${domain},
      ${dailyVisitorId(ip, uaString)},
      ${normalizePath(body.p).slice(0, 500)},
      ${body.r ? String(body.r).slice(0, 500) : null},
      ${extractSearchTerm(body.r)},
      ${geo?.country || null},
      ${ua.os.name || null},
      ${ua.browser.name || null}
    )
  `;
  res.status(204).end();
}));

// ---------- stats API ----------

app.get('/api/domains', (_req, res) => {
  res.json({ domains: ALLOWED_DOMAINS });
});

app.get('/api/stats/:domain', ah(async (req, res) => {
  const domain = normalizeDomain(req.params.domain);
  if (!ALLOWED_DOMAINS.includes(domain)) {
    return res.status(404).json({ error: 'unknown domain' });
  }
  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);

  const since = sql`now() - (${days}::int || ' days')::interval`;

  const [daily, totals, countries, oses, browsers, referrers, searches, pages] =
    await Promise.all([
      sql`
        select
          date_trunc('day', created_at)::date as day,
          count(*)::int as page_views,
          count(distinct visitor_id)::int as visitors
        from events
        where domain = ${domain} and created_at >= ${since}
        group by 1
        order by 1
      `,
      sql`
        select
          count(*)::int as page_views,
          count(distinct visitor_id)::int as visitors
        from events
        where domain = ${domain} and created_at >= ${since}
      `,
      sql`
        select coalesce(country, 'Unknown') as key, count(*)::int as value
        from events
        where domain = ${domain} and created_at >= ${since}
        group by 1 order by value desc limit 10
      `,
      sql`
        select coalesce(os, 'Unknown') as key, count(*)::int as value
        from events
        where domain = ${domain} and created_at >= ${since}
        group by 1 order by value desc limit 10
      `,
      sql`
        select coalesce(browser, 'Unknown') as key, count(*)::int as value
        from events
        where domain = ${domain} and created_at >= ${since}
        group by 1 order by value desc limit 10
      `,
      sql`
        select coalesce(nullif(referrer, ''), '(direct)') as key, count(*)::int as value
        from events
        where domain = ${domain} and created_at >= ${since}
          and (
            referrer is null
            or referrer = ''
            or regexp_replace(
                 coalesce(substring(referrer from 'https?://([^/:?#]+)'), ''),
                 '^www\.', ''
               ) <> ${domain}
          )
        group by 1 order by value desc limit 10
      `,
      sql`
        select search_term as key, count(*)::int as value
        from events
        where domain = ${domain} and created_at >= ${since} and search_term is not null
        group by 1 order by value desc limit 10
      `,
      sql`
        select
          coalesce(
            nullif(regexp_replace(path, '/index\.(html?|php)$', '/'), ''),
            '/'
          ) as key,
          count(*)::int as value
        from events
        where domain = ${domain} and created_at >= ${since}
        group by 1 order by value desc limit 10
      `,
    ]);

  res.json({
    domain,
    days,
    daily,
    totals: totals[0] || { page_views: 0, visitors: 0 },
    countries,
    oses,
    browsers,
    referrers,
    searches,
    pages,
  });
}));

// ---------- dashboard SPA ----------

const DIST = path.join(__dirname, 'dashboard', 'dist');
const hasBuild = fs.existsSync(path.join(DIST, 'index.html'));

if (hasBuild) {
  app.use('/assets', express.static(path.join(DIST, 'assets'), { maxAge: '1y', immutable: true }));
}

app.get('/', (req, res) => {
  const url = baseUrl(req);
  res.type('html').send(`<!doctype html><meta charset="utf-8">
    <title>vibestats</title>
    <style>body{font-family:system-ui;max-width:600px;margin:4rem auto;padding:0 1rem}</style>
    <h1>vibestats</h1>
    <p>Tracked domains:</p>
    <ul>${ALLOWED_DOMAINS.map((d) => `<li><a href="/${d}/">${d}</a></li>`).join('')}</ul>
    <p>Embed snippet:</p>
    <pre style="background:#f4f4f4;padding:1rem;overflow:auto">&lt;script async src="${url}/track.js"&gt;&lt;/script&gt;</pre>`);
});

function serveDashboard(req, res, next) {
  const domain = normalizeDomain(req.params.domain);
  if (!ALLOWED_DOMAINS.includes(domain)) return next();
  if (!hasBuild) {
    return res.status(503).type('text').send('Dashboard not built yet. Run: npm install && npm run build');
  }
  res.sendFile(path.join(DIST, 'index.html'));
}

app.get('/:domain', serveDashboard);
app.get('/:domain/*', serveDashboard);

app.use((_req, res) => res.status(404).type('text').send('not found'));

app.use((err, req, res, _next) => {
  console.error(`[${req.method} ${req.url}]`, err.message);
  if (req.path === '/collect') return res.status(204).end();
  res.status(500).json({ error: 'internal error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`vibestats listening on 0.0.0.0:${PORT}`);
  console.log(`allowed domains: ${ALLOWED_DOMAINS.join(', ') || '(none)'}`);
});
