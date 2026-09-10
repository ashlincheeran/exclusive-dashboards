// CRM lead counts from Metabase — runs server-side on Vercel.
//
// Credentials come from Vercel Environment Variables (Settings → Environment
// Variables). They are never sent to the browser and never live in this repo.
//
//   METABASE_URL      required, e.g. https://metabase.bhomes.com  (no trailing /)
//   METABASE_API_KEY  preferred — Metabase → Admin → Authentication → API keys
//   METABASE_USER     fallback, only used when no API key is set
//   METABASE_PASS     fallback
//   METABASE_DB_ID    optional, defaults to 14 (the "betterhomes" database)
//
// GET /api/crm-leads?campaign=<utm campaign code>&since=YYYY-MM-DD
//   → { leads: 11, campaign: "...", since: "..." }

const DEFAULT_DB = 14;

// utm campaign codes are safe, simple identifiers. Anything else is rejected
// rather than interpolated into SQL.
const SAFE_CODE = /^[A-Za-z0-9._\-]{1,120}$/;
const SAFE_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function authHeaders(base) {
  if (process.env.METABASE_API_KEY) {
    return { 'Content-Type': 'application/json', 'X-API-KEY': process.env.METABASE_API_KEY };
  }
  const user = process.env.METABASE_USER, pass = process.env.METABASE_PASS;
  if (!user || !pass) throw new Error('No METABASE_API_KEY and no METABASE_USER/METABASE_PASS set');

  const r = await fetch(base + '/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass })
  });
  if (!r.ok) throw new Error('Metabase login failed (' + r.status + ')');
  const s = await r.json();
  if (!s || !s.id) throw new Error('Metabase login returned no session');
  return { 'Content-Type': 'application/json', 'X-Metabase-Session': s.id };
}

export default async function handler(req, res) {
  // Cached at the edge so the dashboard never hammers Metabase.
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');

  const base = (process.env.METABASE_URL || '').replace(/\/+$/, '');
  const since = String((req.query && req.query.since) || '').trim();

  // One or more comma-separated utm campaign codes.
  const codes = String((req.query && req.query.campaign) || '')
    .split(',').map(function (c) { return c.trim(); }).filter(Boolean);

  if (!base)          return res.status(500).json({ error: 'METABASE_URL is not configured' });
  if (!codes.length)  return res.status(400).json({ error: 'missing ?campaign' });
  if (!codes.every(function (c) { return SAFE_CODE.test(c); }))
    return res.status(400).json({ error: 'invalid ?campaign code' });
  if (since && !SAFE_DATE.test(since)) return res.status(400).json({ error: 'invalid ?since (YYYY-MM-DD)' });

  const inList = codes.map(function (c) { return "'" + c + "'"; }).join(',');
  const dateClause = since ? ` AND created_at >= '${since}'` : '';
  const sql =
    "SELECT COUNT(*) AS leads FROM leads " +
    "WHERE JSON_UNQUOTE(JSON_EXTRACT(utm,'$.campaign')) IN (" + inList + ") " +
    "AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(utm,'$.source'))) IN ('whatsapp','email')" + dateClause;

  try {
    const headers = await authHeaders(base);
    const r = await fetch(base + '/api/dataset', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        database: Number(process.env.METABASE_DB_ID || DEFAULT_DB),
        type: 'native',
        native: { query: sql }
      })
    });
    if (!r.ok) return res.status(502).json({ error: 'Metabase query failed (' + r.status + ')' });

    const body = await r.json();
    const rows = (body && body.data && body.data.rows) || [];
    const leads = rows.length ? Number(rows[0][0]) || 0 : 0;

    return res.status(200).json({ leads, campaigns: codes, since: since || null });
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
}
