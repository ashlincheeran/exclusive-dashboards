# betterhomes — Exclusive Project Dashboards

One repo, all exclusive-project dashboards. One Vercel project + one domain serves them all.

## Structure
```
/                     → PIN gate; routes each PIN to its project
/city-tower/          → City Tower 1 dashboard
/w-residences/        → W Residences Dubai (JLT) dashboard
/api/crm-leads.js     → serverless function: CRM lead counts from Metabase
/_engine/*.gs         → reference copy of each project's Apps Script
vercel.json           → clean URLs + no-cache headers (prevents stale views)
```
Each dashboard is a single self-contained `index.html`.
URLs: `exclusive.bhomes.com/city-tower`, `/w-residences`, …

## Where each number comes from

| Section | Source |
|---|---|
| Timeline, delivery, activity, showcase, next steps | Google Sheet (Deliverables tab) via Apps Script |
| Highlights / notes / decisions | Google Sheet (Master tab) |
| Budget pacing | Google Sheet (Paid tab) |
| Paid campaigns + KPI bar | **Supermetrics API** (Meta + Google Ads), live on each load |
| WhatsApp / Email leads | **Metabase**, via `/api/crm-leads` |
| Market news button | Apify (Google search), on demand |
| AI insights button | Gemini, on demand |
| Weekly snapshots | Apps Script → Google Drive (Monday trigger) |

## Access
A PIN gate on `/` routes each PIN to its own project; project pages also gate
directly. PINs live in the `ACCESS` map in each page.

> This is a **client-side** gate: PINs are visible in page source. It is
> share-gating, not hardened auth. Move validation server-side before treating
> it as a security boundary.

## Per-project config
Everything project-specific in a dashboard page sits in one block near the top:
`THIS_PROJECT`, `ACCESS`, `PROJECT_ENTITIES`, `PROJECT_TERMS`,
`CAMPAIGN_STRIP`, `CRM_CAMPAIGNS`, `CRM_SINCE`, `SHEET_API`.

## Apps Script (one per project)
Paste `_engine/<project>-data.gs` into the sheet's Apps Script, then:
1. **Project Settings → Script Properties** → `SM_API_KEY` = Supermetrics API key
2. Run `setupWeeklyTrigger` once (authorises Drive + schedules snapshots)
3. **Deploy → New deployment → Web app** (Execute as **Me**, access **Anyone**)
4. Put the `/exec` URL in that page's `SHEET_API`

Optional Script Properties: `SM_START_DATE`, `SM_ACCOUNT`, `SM_CAMPAIGN_MATCH`,
`SM_GOOGLE_ACCOUNTS`, `SM_GOOGLE_MATCH`, `SM_DS_USER`, `SM_DATE_RANGE`.

> Saving the script is not enough — `/exec` serves the last **deployed version**,
> so create a **New version** for changes to go live.

## Vercel environment variables
Set in **Settings → Environment Variables** for **all** environments
(Production, Preview, Development). Env vars only apply to **new** deployments.

| Key | Notes |
|---|---|
| `METABASE_URL` | e.g. `https://metabase.bhomes.com`, no trailing slash |
| `METABASE_API_KEY` | preferred |
| `METABASE_USERNAME` / `METABASE_PASSWORD` | fallback if no API key |
| `METABASE_DB_ID` | optional, defaults to `14` |

## Adding a NEW project
1. Copy an existing project folder to `/<project>/index.html`.
2. Swap the per-project config block (above) and point `SHEET_API` at its `/exec`.
3. Copy `_engine/<project>-data.gs`, change `SHEET_ID`, `SNAP_FOLDER`, the
   snapshot filename prefix and the Supermetrics account/match defaults.
4. Add its PIN + card to the root `index.html`.
5. Commit & push → live at `exclusive.bhomes.com/<project>`.

_Note: showcase thumbnails load only if those Google Drive files are shared
“anyone with the link”._
