// Monthly paid spend from the Supermetrics API — runs server-side on Vercel.
//
// The budget table's "Spent" column is a manual sheet column that nobody fills
// in. This returns actual spend per month (Meta + Google Ads) so the dashboard
// can fill it from live data instead.
//
// Credentials come from Vercel Environment Variables and never reach the
// browser or this repo:
//
//   SM_API_KEY   required — the Supermetrics API key
//                (SUPERMETRICS_API_KEY also accepted)
//   SM_DS_USER   optional — Supermetrics user id, defaults below
//
// GET /api/paid-monthly?project=w-residences
//   → { months: { "2026-09": 884.72 }, currency: "AED", source: "supermetrics" }
//
// Accounts are held here rather than taken from the query string, so this
// cannot be used to pull arbitrary accounts out of our Supermetrics licence.

const DEFAULT_DS_USER = '122111799831053725';

const PROJECTS = {
  'w-residences': {
    start:  '2026-09-01',
    meta:   { accounts: ['act_2029551921300421'], match: 'WResidences' },
    google: { accounts: ['1174729952', '5063000241'], match: 'WRES' }
  },
  'city-tower': {
    start:  '2026-04-01',
    meta:   { accounts: ['act_9508663712551146'], match: 'C1-Tower' },
    google: { accounts: ['1174729952', '5063000241'], match: 'CT1' }
  }
};

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

// Supermetrics returns "2026|09"; the budget table is keyed "2026-09".
function normaliseMonth(v) {
  return String(v == null ? '' : v).trim().replace('|', '-');
}

async function smQuery(key, dsId, accounts, fields, start, end) {
  const payload = {
    ds_id: dsId,
    ds_accounts: accounts,
    ds_user: process.env.SM_DS_USER || DEFAULT_DS_USER,
    date_range_type: 'custom',
    start_date: start,
    end_date: end,
    fields,
    max_rows: 1000,
    api_key: key
  };
  const url = 'https://api.supermetrics.com/enterprise/v2/query/data/json?json=' +
    encodeURIComponent(JSON.stringify(payload));

  const r = await fetch(url);
  if (!r.ok) throw new Error(dsId + ' query failed (' + r.status + ')');
  const body = await r.json();
  const rows = (body && body.data) || [];
  return rows.slice(1);   // row 0 is the header
}

export default async function handler(req, res) {
  // Spend changes slowly; an hour of edge cache keeps page loads fast.
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const key = process.env.SM_API_KEY || process.env.SUPERMETRICS_API_KEY;
  const slug = String((req.query && req.query.project) || '').trim();
  const cfg = PROJECTS[slug];

  if (!key)  return res.status(500).json({ error: 'SM_API_KEY is not configured' });
  if (!cfg)  return res.status(400).json({ error: 'unknown ?project' });

  const end = isoToday();
  const months = {};
  const errors = [];

  // [month, campaign name, cost] for each source; the cost column is last.
  const sources = [
    { ds: 'FA', fields: ['Yearmonth', 'adcampaign_name', 'cost'], ...cfg.meta },
    { ds: 'AW', fields: ['Yearmonth', 'campaign', 'cost'],        ...cfg.google }
  ];

  for (const s of sources) {
    try {
      const rows = await smQuery(key, s.ds, s.accounts, s.fields, cfg.start, end);
      const needle = s.match.toLowerCase();
      for (const row of rows) {
        const name = String(row[1] || '');
        if (name.toLowerCase().indexOf(needle) === -1) continue;
        const m = normaliseMonth(row[0]);
        if (!m) continue;
        months[m] = (months[m] || 0) + (Number(row[2]) || 0);
      }
    } catch (e) {
      // One source failing shouldn't lose the other's spend.
      errors.push(s.ds + ': ' + ((e && e.message) || e));
    }
  }

  // Every account we pull reports in AED, so no conversion is applied.
  return res.status(200).json({
    months,
    currency: 'AED',
    source: 'supermetrics',
    since: cfg.start,
    errors: errors.length ? errors : undefined
  });
}
