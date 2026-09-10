// W Residences Dubai (JLT) — Live Dashboard Data API
// =============================================================================
// ONE-TIME SETUP (5 minutes):
//   1. In your Google Sheet → Extensions → Apps Script
//   2. Paste this entire file, replacing any existing code
//   3. Click Deploy → New deployment → Web app
//        Execute as: Me   |   Who has access: Anyone
//   4. Click Deploy → copy the /exec URL it shows
//   5. In w-residences/index.html, paste that URL as the value of SHEET_API
//
// HOW IT WORKS:
//   This script is CONTENT-DRIVEN. It scans every tab in the sheet and detects
//   each block by its header signature (e.g. "Project name", "PROJECT HEALTH",
//   the "Phase … Status" header row). It does NOT depend on tab names, so it
//   keeps working even if tabs are renamed, reordered, or added.
//
//   To debug: open the /exec URL in a browser — it returns the raw JSON the
//   dashboard reads. If a field is missing there, the matching block wasn't
//   found in the sheet.
// =============================================================================

var SHEET_ID    = '1LTlagelAhU-Ifyn5rARyy0jechCc8p0iS487-JZnXmU';
var SNAP_FOLDER = 'W Residences Dubai — Dashboard Snapshots';

// Build the full dashboard payload from the current sheet.
function buildData() {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var grids = ss.getSheets().map(function (sh) { return sh.getDataRange().getValues(); });

  var d = {};
  readMaster(grids, d);            // metadata, health, deliverables count, counter, notes
  readDeliverables(grids, d);      // production assets → in-progress / upcoming / phase summaries
  readSourceMaterials(grids, d);   // developer assets → delayed = blockers
  readPaid(grids, d);              // Supermetrics campaigns + budget
  readTimeline(grids, d);          // count of originally-promised activities
  readMarket(grids, d);            // market updates (showcase comes from Deliverables)
  finalise(d);                     // derived fields: KPIs, decisions, risks, month name
  return d;
}

// Web-app entry point. Modes (via query params):
//   (none)        → live data
//   ?list=1       → { snapshots: [{id, date}] }  (newest first)
//   ?snapshot=ID  → the stored payload for that snapshot
//   ?save=1       → take a snapshot now → { saved, date, id }
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.save)     return jsonOut(saveSnapshot());
    if (p.list)     return jsonOut(listSnapshots());
    if (p.snapshot) return jsonOut(getSnapshot(p.snapshot));
    return jsonOut(buildData());
  } catch (err) {
    return jsonOut({ _error: String((err && err.message) || err) });
  }
}

// ── SNAPSHOTS (weekly history, stored as JSON files in Drive) ────────────────
function snapFolder_() {
  var it = DriveApp.getFoldersByName(SNAP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(SNAP_FOLDER);
}
function isoDate_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Save a snapshot of the current dashboard. Called weekly by a trigger and by
// the dashboard's "Save snapshot" button (?save=1). Re-running the same day
// overwrites that day's file.
function saveSnapshot() {
  var d = buildData();
  d.snapshotDate = isoDate_();
  var folder = snapFolder_();
  var name = 'w-residences-' + d.snapshotDate + '.json';
  var dupes = folder.getFilesByName(name);
  while (dupes.hasNext()) dupes.next().setTrashed(true);
  var file = folder.createFile(name, JSON.stringify(d), 'application/json');
  return { saved: true, date: d.snapshotDate, id: file.getId() };
}

function listSnapshots() {
  var files = snapFolder_().getFiles(), out = [];
  while (files.hasNext()) {
    var f = files.next(), m = f.getName().match(/(\d{4}-\d{2}-\d{2})/);
    out.push({ id: f.getId(), date: m ? m[1] : f.getName() });
  }
  out.sort(function (a, b) { return a.date < b.date ? 1 : -1; }); // newest first
  return { snapshots: out };
}

function getSnapshot(id) {
  return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());
}

// Run ONCE from the Apps Script editor to schedule an automatic weekly snapshot.
function setupWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'saveSnapshot') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('saveSnapshot').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
}

// ── MASTER (control tab): metadata, health, counts, counter, notes ───────────
function readMaster(grids, d) {
  var healthPhases = [];
  var notes        = { Win: [], 'Watch-out': [], Decision: [], Note: [] };
  var counter      = [];

  grids.forEach(function (rows) {
    var sec = null; // section state, reset per tab
    for (var i = 0; i < rows.length; i++) {
      var c0 = sv(rows[i][0]);
      var c1 = sv(rows[i][1]);
      var c2 = sv(rows[i][2]);
      // Master tab has an empty col A spacer; labels are in col B, values in col C.
      // Other tabs have labels in col A, values in col B. Support both layouts.
      var a = c0 || c1;        // label: col A if present, else col B
      var b = c0 ? c1 : c2;   // value: col B if label in col A, else col C

      // section headers
      if (a === 'PROJECT HEALTH')                  { sec = 'health'; continue; }
      if (a === 'DELIVERABLES & APPROVALS')        { sec = 'deliv';  continue; }
      if (a.indexOf('DELIVERABLES COUNTER') === 0) { sec = 'cntr';   continue; }
      if (a === 'Type' && b === 'Note')            { sec = 'notes';  continue; }

      // project metadata (recognised anywhere in the sheet)
      if (a === 'Project name')               d.project   = b;
      if (a === 'Developer')                  d.developer = b;
      if (a === 'Location')                   d.location  = b;
      if (a === 'Launch date')                d.launch    = b;
      if (a === 'Current phase')              d.phase     = b;
      if (a === 'Reporting month')            d.month     = b;
      if (a === 'Deals (developer-provided)') d.deals     = toInt(b);
      // Manual all-source totals (enter on the Master or Paid tab).
      if (a === 'Total leads (all sources)')  d.leadsAll  = toInt(b);
      if (a === 'Blended CPL (all sources)')  d.cplAll    = toInt(b);

      // health block: overall %, per-phase %, developer materials %
      if (sec === 'health') {
        if (a === 'Overall delivery progress')     { d.overall      = toPct100(b); continue; }
        if (a === 'Developer materials delivered') { d.devDelivered = toPct100(b); sec = null; continue; }
        if (a && b) healthPhases.push({ name: a, pct: toPct100(b) });
      }

      // deliverables & approvals block: delivered/total, delayed count
      if (sec === 'deliv') {
        if (a === 'Delivered / total') {
          var p = b.replace(/\s/g, '').split('/');
          d.delivered = toInt(p[0]);
          d.total     = toInt(p[1] || '0');
        }
        if (a === 'Developer materials delayed') d.delayed = toInt(b);
      }

      // monthly counter block: label → value (Email & WhatsApp combined)
      if (sec === 'cntr') {
        if (a && b !== '') {
          var lbl = (a === 'Emails sent' || a === 'WhatsApp') ? 'Email & WhatsApp' : a;
          var hit = null;
          for (var ci = 0; ci < counter.length; ci++) { if (counter[ci].label === lbl) { hit = counter[ci]; break; } }
          if (hit) hit.val += toInt(b);
          else     counter.push({ label: lbl, val: toInt(b) });
        } else if (!c0 && !c1) sec = null; // end when both cols are empty
      }

      // notes block: Win / Watch-out / Decision / Note
      if (sec === 'notes') {
        if (notes.hasOwnProperty(a)) { if (b) notes[a].push(b); }
        else if (a)                  sec = null;
      }
    }
  });

  d.phases     = healthPhases;
  d.where      = { Win: notes.Win, 'Watch-out': notes['Watch-out'], Decision: notes.Decision, Note: notes.Note };
  d.counterCum = counter;

  // human-readable reporting month (e.g. "May 2026")
  var MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var mp = String(d.month || '').split('-');
  d.monthName = (mp.length === 2) ? (MO[+mp[1] - 1] + ' ' + mp[0]) : (d.month || '');
}

// ── DELIVERABLES tab: production assets ──────────────────────────────────────
// Header signature: col A = "Phase" AND the "Status" column.
// Columns: Phase(0) Type(1) Asset(2) Responsible(3) Qty(4) Copy(5) Design(6)
//          File(7) Thumbnail(8) Live(9) bhApproval(10) ClientApproval(11)
//          Status(12) Completed(13) Month(14) Showcase?(15) Notes(16)
function readDeliverables(grids, d) {
  var items = [];

  grids.forEach(function (rows) {
    var hi = -1;
    for (var i = 0; i < rows.length; i++) {
      if (sv(rows[i][0]) === 'Phase' && sv(rows[i][12]) === 'Status') { hi = i; break; }
    }
    if (hi < 0) return;

    for (var r = hi + 1; r < rows.length; r++) {
      var row  = rows[r];
      var name = sv(row[2]);
      if (!name) continue;
      // Email & WhatsApp are reported as a single source.
      var type = sv(row[1]);
      if (type === 'WhatsApp' || type === 'Email') type = 'Email & WhatsApp';
      items.push({
        phase:    sv(row[0]),
        type:     type,
        name:     name,
        qty:      toInt(row[4]) || 1,         // Qty column; blank counts as 1
        fileLink: sv(row[7]),
        thumb:    sv(row[8]),                 // Thumbnail for preview (1x1)
        liveLink: sv(row[9]),
        status:   sv(row[12]),
        showcase: sv(row[15]) === 'Yes',
        notes:    sv(row[16])
      });
    }
  });

  d.deliverablesList = items;

  // Block 1 — "Total assets created" = sum of the Qty column across every row
  // (counts each ad variant individually).
  var isDone = function (x) { return x.status === 'Completed' || x.status === 'Live'; };
  d.qtyTotal     = items.reduce(function (s, x) { return s + (x.qty || 0); }, 0);
  d.qtyDelivered = items.filter(isDone).reduce(function (s, x) { return s + (x.qty || 0); }, 0);
  d.deliveredPct = d.qtyTotal ? Math.round(d.qtyDelivered / d.qtyTotal * 100) : 0;

  // Block 2 — deliverable line-items created (Completed/Live) vs what was
  // promised in Timeline (Plan); d.promised is set by readTimeline().
  d.createdCount = items.filter(isDone).length;

  // Showcase carousel = deliverables flagged Showcase? = Yes (Deliverables and
  // Showcase tabs are now one). Thumbnail uses the Thumbnail column, falling
  // back to the live/file link client-side.
  d.showcase = items.filter(function (x) { return x.showcase; }).map(function (x) {
    return { name: x.name, type: x.type, thumb: x.thumb, link: x.liveLink || x.fileLink || '', phase: x.phase, caption: x.notes };
  });

  var ph = d.phase || '';
  d.inProg   = items.filter(function (x) { return x.status === 'In Progress'; }).map(nameOf);
  d.upcoming = items.filter(function (x) { return x.status === 'Not Started' && x.phase === ph; }).map(nameOf);
  d.risks    = items.filter(function (x) { return x.status === 'Delayed'; })
                    .map(function (x) { return x.name + (x.notes ? ' — ' + x.notes : ''); });

  // per-phase summaries for the timeline modal
  var PHASES = (d.phases && d.phases.length)
    ? d.phases.map(nameOf)
    : ['Material Prep', 'Pre-launch', 'Launch', 'Ongoing'];

  d.phaseSummaries = PHASES.map(function (pn) {
    var pi   = items.filter(function (x) { return x.phase === pn; });
    var done = pi.filter(function (x) { return x.status === 'Completed' || x.status === 'Live'; });
    return {
      name:      pn,
      pct:       pi.length ? Math.round(done.length / pi.length * 100) : 0,
      delivered: done.length,
      total:     pi.length,
      items:     done.map(function (x) { return { name: x.name, link: x.liveLink || x.fileLink || '' }; }),
      counts:    []
    };
  });
}

// ── SOURCE MATERIALS tab: delayed developer assets become blockers ───────────
// Header signature: col A = "Category" AND col E = "Status".
function readSourceMaterials(grids, d) {
  var delayed = [], total = 0, received = 0;
  grids.forEach(function (rows) {
    var hi = -1;
    for (var i = 0; i < rows.length; i++) {
      if (sv(rows[i][0]) === 'Category' && sv(rows[i][4]) === 'Status') { hi = i; break; }
    }
    if (hi < 0) return;
    for (var r = hi + 1; r < rows.length; r++) {
      var row = rows[r];
      var nm = sv(row[1]);
      if (!nm) continue;                       // skip blank rows
      total++;
      var st = sv(row[4]);
      if (st === 'Delivered' || st === 'Live') received++;
      if (st === 'Delayed') {
        var nt = sv(row[7]);
        delayed.push(nm + (nt ? ' — ' + nt : ''));
      }
    }
  });
  d._delayedMaterials = delayed;
  d.devMaterialsReceived = received;   // developer materials delivered (count)
  d.devMaterialsTotal    = total;      // developer materials total (count)
}

// ── PAID: Supermetrics API (live) with the Paid tab as fallback ──────────────
// Budget always comes from the sheet. Campaign performance comes from the
// Supermetrics API when a script property SM_API_KEY is set; otherwise it
// falls back to whatever is in the Paid (Supermetrics) tab.
function readPaid(grids, d) {
  readPaidFromSheet(grids, d);       // sets d.budget + d.paid (sheet fallback)
  readPaidFromSupermetrics(d);       // overrides d.paid when SM_API_KEY is set
}

// Live paid performance via the Supermetrics REST API — Meta + Google Ads.
// Script Properties (Apps Script → Project Settings):
//   SM_API_KEY         (required) Supermetrics API key
//   SM_START_DATE      (optional) campaign start, default below — anything
//                                 before this date is excluded
//   SM_ACCOUNT         (optional) Meta ad account
//   SM_CAMPAIGN_MATCH  (optional) Meta campaign name must contain this
//   SM_GOOGLE_ACCOUNTS (optional) comma-separated Google Ads account ids
//   SM_GOOGLE_MATCH    (optional) Google campaign name must contain this
//   SM_DS_USER         (optional) Supermetrics connection id
function readPaidFromSupermetrics(d) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('SM_API_KEY');
  if (!key) return;                                  // not configured → keep sheet data

  var start = props.getProperty('SM_START_DATE') || '2026-09-01';
  var end   = isoDate_();
  var errs  = [];

  var meta = smFetch_(key, errs, {
    ch: 'Meta', ds_id: 'FA', start: start, end: end,
    accounts: [props.getProperty('SM_ACCOUNT') || 'act_2029551921300421'],
    fields: ['adcampaign_name', 'cost', 'impressions', 'Clicks', 'onsite_conversion.lead_grouped'],
    match: props.getProperty('SM_CAMPAIGN_MATCH') || 'WResidences'
  });

  var google = smFetch_(key, errs, {
    ch: 'Google', ds_id: 'AW', start: start, end: end,
    accounts: (props.getProperty('SM_GOOGLE_ACCOUNTS') || '1174729952,5063000241').split(','),
    fields: ['campaign', 'cost', 'impressions', 'clicks', 'conversions'],
    match: props.getProperty('SM_GOOGLE_MATCH') || 'WRES'
  });

  // Google should always be visible, even before it launches — show a zero row.
  if (!google.length) {
    google = [{ ch: 'Google', name: 'Google Ads — no spend yet',
                spend: 0, impr: 0, clicks: 0, ctr: 0, cpc: 0, leads: 0, cpl: null }];
  }

  // Only fall back to the sheet if Meta itself failed.
  if (!meta.length && errs.length) { d.paidError = errs.join(' | '); return; }

  var campaigns = meta.concat(google);
  var t = { spend: 0, impr: 0, clicks: 0, leads: 0 };
  campaigns.forEach(function (c) { t.spend += c.spend; t.impr += c.impr; t.clicks += c.clicks; t.leads += c.leads; });
  campaigns.sort(function (a, b) { return b.spend - a.spend; });

  d.paid = {
    total: {
      ch: 'All', name: 'TOTAL — W Residences (Meta + Google)',
      spend: t.spend, impr: t.impr, clicks: t.clicks,
      ctr: t.impr ? t.clicks / t.impr : 0,
      cpc: t.clicks ? t.spend / t.clicks : 0,
      leads: t.leads,
      cpl: t.leads ? t.spend / t.leads : null
    },
    campaigns: campaigns,
    google: ''
  };
  d.paidSource = 'supermetrics';
  d.paidWindow = start + ' → ' + end;
  if (errs.length) d.paidError = errs.join(' | ');
}

// One Supermetrics query → array of campaign rows (or [] with errs appended).
function smFetch_(key, errs, q) {
  try {
    var payload = {
      ds_id: q.ds_id,
      ds_accounts: q.accounts,
      ds_user: PropertiesService.getScriptProperties().getProperty('SM_DS_USER') || '122111799831053725',
      date_range_type: 'custom',
      start_date: q.start,
      end_date: q.end,
      fields: q.fields,
      max_rows: 500,
      api_key: key
    };
    var url = 'https://api.supermetrics.com/enterprise/v2/query/data/json?json=' +
              encodeURIComponent(JSON.stringify(payload));
    var body = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
    var rows = body && body.data;
    if (!rows || rows.length < 2) {
      var code = String((body && body.meta && body.meta.status_code) || 'NO_DATA');
      if (code.toUpperCase() !== 'SUCCESS') errs.push(q.ch + ': ' + code);
      return [];                                     // no campaigns in range = fine
    }
    var out = [];
    for (var i = 1; i < rows.length; i++) {          // row 0 = header
      var r = rows[i];
      var name = String(r[0] || '');
      if (q.match && name.indexOf(q.match) === -1) continue;
      var spend = toMoney(r[1]), impr = toMoney(r[2]), clicks = toMoney(r[3]), leads = toMoney(r[4]);
      out.push({
        ch: q.ch, name: name, spend: spend, impr: impr, clicks: clicks,
        ctr: impr ? clicks / impr : 0,
        cpc: clicks ? spend / clicks : 0,
        leads: leads,
        cpl: leads ? spend / leads : null
      });
    }
    return out;
  } catch (e) {
    errs.push(q.ch + ' error: ' + ((e && e.message) || e));
    return [];
  }
}

// ── PAID (Supermetrics) TAB: campaign table + budget table (fallback) ────────
function readPaidFromSheet(grids, d) {
  var campaigns = [], budget = [], totalRow = null, googleNote = '';

  grids.forEach(function (rows) {
    var sec = null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var a = sv(r[0]);

      if (a === 'Reporting Month' && sv(r[2]) === 'Campaign')          { sec = 'camp';   continue; }
      if (a === 'Month' && sv(r[1]).indexOf('Approved') !== -1)        { sec = 'budget'; continue; }

      if (sec === 'camp') {
        var ch = sv(r[1]), camp = sv(r[2]);
        if (!camp) { sec = null; continue; }
        var spend = toMoney(r[3]);
        if (ch === 'Google' && spend === 0) { googleNote = camp; continue; } // "no campaigns" note
        var entry = {
          ch: ch, name: camp,
          spend:  spend,
          impr:   toMoney(r[4]),
          clicks: toMoney(r[5]),
          ctr:    toPct(r[6]),
          cpc:    toMoney(r[7]),
          leads:  toMoney(r[8]),
          cpl:    toMoney(r[9]) || null
        };
        if (camp.toUpperCase().indexOf('TOTAL') !== -1) totalRow = entry;
        else                                            campaigns.push(entry);
      }

      if (sec === 'budget') {
        var mo = sv(r[0]);
        if (!mo || mo === 'Month') continue;
        if (mo.indexOf('-') === -1) { sec = null; continue; } // left the budget block
        budget.push({
          month:    mo,
          approved: toMoney(r[1]) || null,
          spent:    toMoney(r[2]) || null,
          paid:     sv(r[4])
        });
      }
    }
  });

  d.paid   = { total: totalRow || {}, campaigns: campaigns, google: googleNote };
  d.budget = budget;
}

// ── TIMELINE (Plan/Data): count of originally-promised activities ────────────
// Uses the flat "Timeline (Data)" mirror: header row Phase | Channel | Activity.
// Counts every row that has an Activity = what was originally promised.
function readTimeline(grids, d) {
  var promised = 0;
  grids.forEach(function (rows) {
    var hi = -1;
    for (var i = 0; i < rows.length; i++) {
      if (sv(rows[i][0]) === 'Phase' && sv(rows[i][1]) === 'Channel' && sv(rows[i][2]) === 'Activity') { hi = i; break; }
    }
    if (hi < 0) return;
    for (var r = hi + 1; r < rows.length; r++) {
      if (sv(rows[r][2])) promised++;   // a planned activity
      else break;                       // end of the contiguous list
    }
  });
  d.promised = promised;
}

// ── MARKET UPDATES (scan every tab) ──────────────────────────────────────────
// Showcase now comes from the Deliverables tab (Showcase? = Yes), built in
// readDeliverables — the separate Showcase tab is no longer read.
function readMarket(grids, d) {
  var market = [], seenM = {};

  grids.forEach(function (rows) {
    var sec = null;
    for (var i = 0; i < rows.length; i++) {
      var a = sv(rows[i][0]), b = sv(rows[i][1]);

      if (a === 'Date' && b === 'Headline') { sec = 'mk'; continue; }
      if (!a && !b)                         { sec = null; continue; }

      if (sec === 'mk' && b && !seenM[b]) {
        seenM[b] = 1;
        market.push({ date: a, headline: b, summary: sv(rows[i][2]), source: sv(rows[i][3]), link: sv(rows[i][4]) });
      }
    }
  });

  d.market = market;
}

// ── FINALISE: derived fields ─────────────────────────────────────────────────
function finalise(d) {
  if (!d.phases) d.phases = [];

  // decisions come from the Master notes; blockers = delayed developer materials + delayed deliverables
  d.decisions = (d.where && d.where.Decision) ? d.where.Decision : [];
  d.risks     = (d._delayedMaterials || []).concat(d.risks || []);
  delete d._delayedMaterials;

  function fmt(n)   { n = n || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K' : String(Math.round(n)); }
  function comma(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // KPI bar reads the manual "Total: Project health" tab (no live/auto tags).
  // KPI bar is built from the live Supermetrics pull (Meta + Google). Deals is
  // the only manual figure and comes from the Master tab.
  var t = (d.paid && d.paid.total) || {};
  d.kpis = [
    { v: fmt(t.spend),                 l: 'Spend (AED)' },
    { v: comma(t.leads),               l: 'Leads (paid)' },
    { v: t.leads ? comma(t.cpl) : '—', l: 'CPL (AED)' },
    { v: fmt(t.clicks),                l: 'Clicks' },
    { v: comma(d.deals),               l: 'Deals' }
  ];
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
function nameOf(x)  { return x.name; }
function sv(v)      { return String(v === null || v === undefined ? '' : v).trim(); }
function toInt(v)    { return parseInt(sv(v).replace(/[^0-9]/g, ''), 10) || 0; }
function toMoney(v)  { return parseFloat(sv(v).replace(/,/g, '')) || 0; }
function toPct(v)    { var s = sv(v); return s.indexOf('%') !== -1 ? parseFloat(s) / 100 : (parseFloat(s) || 0); }
// Sheets stores percentage-formatted cells as decimals (0.72 not 72).
// This converts either form to a 0-100 integer.
function toPct100(v) { var n = parseFloat(sv(v).replace(/,/g, '')) || 0; return Math.round(n > 0 && n <= 1 ? n * 100 : n); }
function jsonOut(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
