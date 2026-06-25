// City Tower 1 — Live Dashboard Data API
// =============================================================================
// ONE-TIME SETUP (5 minutes):
//   1. In your Google Sheet → Extensions → Apps Script
//   2. Paste this entire file, replacing any existing code
//   3. Click Deploy → New deployment → Web app
//        Execute as: Me   |   Who has access: Anyone
//   4. Click Deploy → copy the /exec URL it shows
//   5. In city-tower/index.html, paste that URL as the value of SHEET_API
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

function doGet() {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var grids = ss.getSheets().map(function (sh) { return sh.getDataRange().getValues(); });

    var d = {};
    readMaster(grids, d);            // metadata, health, deliverables count, counter, notes
    readDeliverables(grids, d);      // production assets → in-progress / upcoming / phase summaries
    readSourceMaterials(grids, d);   // developer assets → delayed = blockers
    readPaid(grids, d);              // Supermetrics campaigns + budget
    readShowcaseAndMarket(grids, d); // showcase tiles + market updates
    finalise(d);                     // derived fields: KPIs, decisions, risks, month name

    return jsonOut(d);
  } catch (e) {
    return jsonOut({ _error: String((e && e.message) || e) });
  }
}

// ── MASTER (control tab): metadata, health, counts, counter, notes ───────────
function readMaster(grids, d) {
  var healthPhases = [];
  var notes        = { Win: [], 'Watch-out': [], Decision: [], Note: [] };
  var counter      = [];

  grids.forEach(function (rows) {
    var sec = null; // section state, reset per tab
    for (var i = 0; i < rows.length; i++) {
      var a = sv(rows[i][0]);
      var b = sv(rows[i][1]);

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

      // health block: overall %, per-phase %, developer materials %
      if (sec === 'health') {
        if (a === 'Overall delivery progress')     { d.overall      = toInt(b); continue; }
        if (a === 'Developer materials delivered') { d.devDelivered = toInt(b); sec = null; continue; }
        if (a && b) healthPhases.push({ name: a, pct: toInt(b) });
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

      // monthly counter block: label → value
      if (sec === 'cntr') {
        if (a && b !== '') counter.push({ label: a, val: toInt(b) });
        else if (!a)       sec = null;
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
// Header signature: col A = "Phase" AND col L = "Status".
// Columns: Phase(0) Type(1) Asset(2) Responsible(3) Qty(4) Copy(5) Design(6)
//          File(7) Live(8) bhApproval(9) ClientApproval(10) Status(11)
//          Completed(12) Month(13) Showcase?(14) Notes(15)
function readDeliverables(grids, d) {
  var items = [];

  grids.forEach(function (rows) {
    var hi = -1;
    for (var i = 0; i < rows.length; i++) {
      if (sv(rows[i][0]) === 'Phase' && sv(rows[i][11]) === 'Status') { hi = i; break; }
    }
    if (hi < 0) return;

    for (var r = hi + 1; r < rows.length; r++) {
      var row  = rows[r];
      var name = sv(row[2]);
      if (!name) continue;
      items.push({
        phase:    sv(row[0]),
        type:     sv(row[1]),
        name:     name,
        fileLink: sv(row[7]),
        liveLink: sv(row[8]),
        status:   sv(row[11]),
        showcase: sv(row[14]) === 'Yes',
        notes:    sv(row[15])
      });
    }
  });

  d.deliverablesList = items;

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
  var delayed = [];
  grids.forEach(function (rows) {
    var hi = -1;
    for (var i = 0; i < rows.length; i++) {
      if (sv(rows[i][0]) === 'Category' && sv(rows[i][4]) === 'Status') { hi = i; break; }
    }
    if (hi < 0) return;
    for (var r = hi + 1; r < rows.length; r++) {
      var row = rows[r];
      if (sv(row[4]) === 'Delayed') {
        var nm = sv(row[1]), nt = sv(row[7]);
        if (nm) delayed.push(nm + (nt ? ' — ' + nt : ''));
      }
    }
  });
  d._delayedMaterials = delayed;
}

// ── PAID (Supermetrics) tab: campaign table + budget table ───────────────────
function readPaid(grids, d) {
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

// ── SHOWCASE + MARKET (scan every tab) ───────────────────────────────────────
function readShowcaseAndMarket(grids, d) {
  var showcase = [], market = [], seenS = {}, seenM = {};

  grids.forEach(function (rows) {
    var sec = null;
    for (var i = 0; i < rows.length; i++) {
      var a = sv(rows[i][0]), b = sv(rows[i][1]);

      if (a === 'Name tag' && b === 'Type')     { sec = 'sc'; continue; }
      if (a === 'Date'     && b === 'Headline') { sec = 'mk'; continue; }
      if (!a && !b)                             { sec = null; continue; }

      if (sec === 'sc' && a) {
        var k = a + '|' + b;
        if (!seenS[k]) {
          seenS[k] = 1;
          showcase.push({ name: a, type: b, link: sv(rows[i][2]), phase: sv(rows[i][3]), caption: sv(rows[i][4]) });
        }
      }
      if (sec === 'mk' && b) {
        if (!seenM[b]) {
          seenM[b] = 1;
          market.push({ date: a, headline: b, summary: sv(rows[i][2]), source: sv(rows[i][3]), link: sv(rows[i][4]) });
        }
      }
    }
  });

  d.showcase = showcase;
  d.market   = market;
}

// ── FINALISE: derived fields ─────────────────────────────────────────────────
function finalise(d) {
  if (!d.phases) d.phases = [];

  // decisions come from the Master notes; blockers = delayed developer materials + delayed deliverables
  d.decisions = (d.where && d.where.Decision) ? d.where.Decision : [];
  d.risks     = (d._delayedMaterials || []).concat(d.risks || []);
  delete d._delayedMaterials;

  var t = (d.paid && d.paid.total) || {};
  function fmt(n) { n = n || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K' : String(Math.round(n)); }
  d.kpis = [
    { v: fmt(t.spend),                              l: 'Paid spend (AED)',     tag: 'live'   },
    { v: t.leads || 0,                              l: 'Leads (form+IF)',      tag: 'live'   },
    { v: t.cpl   || 0,                              l: 'Blended CPL (AED)',    tag: 'live'   },
    { v: (d.delivered || 0) + '/' + (d.total || 0), l: 'Deliverables',         tag: 'auto'   },
    { v: d.deals || 0,                              l: 'Deals (dev-provided)', tag: 'manual' }
  ];
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
function nameOf(x)  { return x.name; }
function sv(v)      { return String(v === null || v === undefined ? '' : v).trim(); }
function toInt(v)   { return parseInt(sv(v).replace(/[^0-9]/g, ''), 10) || 0; }
function toMoney(v) { return parseFloat(sv(v).replace(/,/g, '')) || 0; }
function toPct(v)   { var s = sv(v); return s.indexOf('%') !== -1 ? parseFloat(s) / 100 : (parseFloat(s) || 0); }
function jsonOut(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
