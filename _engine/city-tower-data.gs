// City Tower 1 — Live Dashboard Data API
// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME SETUP (5 minutes):
//   1. In your Google Sheet → Extensions → Apps Script
//   2. Paste this entire file, replacing any existing code
//   3. Click Deploy → New deployment → Web app
//      Execute as: Me  |  Who has access: Anyone
//   4. Click Deploy → copy the URL shown
//   5. In city-tower/index.html, paste that URL as the value of SHEET_API
//   6. Push index.html to GitHub — done forever after that
// ─────────────────────────────────────────────────────────────────────────────

function doGet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var d  = {};
    readMaster(ss, d);
    readDeliverables(ss, d);
    readPaid(ss, d);
    readShowcaseAndMarket(ss, d);
    finalise(d);
    return jsonOut(d);
  } catch (e) {
    return jsonOut({ _error: e.message });
  }
}

// ── MASTER TAB ────────────────────────────────────────────────────────────────
function readMaster(ss, d) {
  var s = ss.getSheetByName('Master');
  if (!s) return;
  var rows = s.getDataRange().getValues();
  var sec  = null;
  var healthPhases = [];
  var notes   = { Win: [], 'Watch-out': [], Decision: [], Note: [] };
  var counter = [];

  for (var i = 0; i < rows.length; i++) {
    var a = sv(rows[i][0]);
    var b = sv(rows[i][1]);

    // ── section header detection ──
    if (a === 'PROJECT HEALTH')                      { sec = 'health'; continue; }
    if (a === 'DELIVERABLES & APPROVALS')            { sec = 'deliv';  continue; }
    if (a.indexOf('DELIVERABLES COUNTER') === 0)     { sec = 'cntr';   continue; }
    if (a === 'Type' && b === 'Note')                { sec = 'notes';  continue; }
    if (a.indexOf('PHASE') === 0 || a === 'Phase')   { sec = null;     continue; }

    // ── project metadata ──
    if (a === 'Project name')               d.project    = b;
    if (a === 'Developer')                  d.developer  = b;
    if (a === 'Location')                   d.location   = b;
    if (a === 'Launch date')                d.launch     = b;
    if (a === 'Current phase')              d.phase      = b;
    if (a === 'Reporting month')            d.month      = b;
    if (a === 'Deals (developer-provided)') d.deals      = toInt(b);

    // ── health section ──
    if (sec === 'health') {
      if (a === 'Overall delivery progress')     { d.overall      = toInt(b); continue; }
      if (a === 'Developer materials delivered') { d.devDelivered = toInt(b); sec = null; continue; }
      if (a && b) healthPhases.push({ name: a, pct: toInt(b) });
    }

    // ── deliverables section ──
    if (sec === 'deliv') {
      if (a === 'Delivered / total') {
        var p = b.replace(/\s/g, '').split('/');
        d.delivered = toInt(p[0]);
        d.total     = toInt(p[1] || '0');
      }
      if (a === 'Developer materials delayed') d.delayed = toInt(b);
    }

    // ── counter section ──
    if (sec === 'cntr' && a && b !== '') counter.push({ label: a, val: toInt(b) });

    // ── notes section ──
    if (sec === 'notes') {
      if (notes.hasOwnProperty(a)) notes[a].push(b);
      else if (a)                  sec = null;
    }
  }

  d._healthPhases = healthPhases;
  d.where = {
    Win:         notes.Win.filter(Boolean),
    'Watch-out': notes['Watch-out'].filter(Boolean),
    Decision:    notes.Decision.filter(Boolean),
    Note:        notes.Note.filter(Boolean)
  };
  d.counterCum = counter;

  // human-readable month name
  var MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var mp = (d.month || '').split('-');
  d.monthName = (mp.length === 2) ? MO[+mp[1] - 1] + ' ' + mp[0] : (d.month || '');
}

// ── DELIVERABLES TAB ──────────────────────────────────────────────────────────
function readDeliverables(ss, d) {
  var s = ss.getSheetByName('Deliverables');
  if (!s) return;
  var rows = s.getDataRange().getValues();

  // locate header row (Phase | Type | Deliverable / Asset …)
  var hi = -1;
  for (var i = 0; i < Math.min(rows.length, 10); i++) {
    if (sv(rows[i][0]) === 'Phase' && sv(rows[i][11]) === 'Status') { hi = i; break; }
  }
  if (hi < 0) {
    // fallback: assume row 0
    hi = 0;
  }

  // col indices based on known template structure
  // Phase(0) Type(1) Deliverable/Asset(2) Responsible(3) Qty(4) Copy(5) Design(6)
  // File Link(7) Live Link(8) bh Approval(9) Client Approval(10) Status(11)
  // Completion Date(12) Reporting Month(13) Showcase?(14) Notes(15)
  var items = [];
  for (var i = hi + 1; i < rows.length; i++) {
    var r    = rows[i];
    var name = sv(r[2]);
    if (!name) continue;
    items.push({
      phase:    sv(r[0]),
      type:     sv(r[1]),
      name:     name,
      fileLink: sv(r[7]),
      liveLink: sv(r[8]),
      status:   sv(r[11]),
      showcase: sv(r[14]) === 'Yes',
      notes:    sv(r[15])
    });
  }

  d.deliverablesList = items;

  var ph = d.phase || '';
  d.inProg   = items.filter(function(x){ return x.status === 'In Progress'; })
                    .map(function(x){ return x.name; });
  d.upcoming = items.filter(function(x){ return x.status === 'Not Started' && x.phase === ph; })
                    .map(function(x){ return x.name; });
  d.risks    = items.filter(function(x){ return x.status === 'Delayed'; })
                    .map(function(x){ return x.name + (x.notes ? ' — ' + x.notes : ''); });
  d.decisions = (d.where && d.where.Decision) ? d.where.Decision : [];

  // phase summaries for timeline modal
  var PHASES = ['Material Prep', 'Pre-launch', 'Launch', 'Ongoing'];
  d.phaseSummaries = PHASES.map(function(pn) {
    var pi   = items.filter(function(x){ return x.phase === pn; });
    var done = pi.filter(function(x){ return x.status === 'Completed' || x.status === 'Live'; });
    return {
      name:      pn,
      pct:       pi.length ? Math.round(done.length / pi.length * 100) : 0,
      delivered: done.length,
      total:     pi.length,
      items:     done.map(function(x){ return { name: x.name, link: x.liveLink || x.fileLink || '' }; }),
      counts:    []
    };
  });
}

// ── PAID (SUPERMETRICS) TAB ───────────────────────────────────────────────────
function readPaid(ss, d) {
  var s = ss.getSheetByName('Paid (Supermetrics)') || ss.getSheetByName('Paid');
  if (!s) return;
  var rows = s.getDataRange().getValues();
  var campaigns = [], budget = [], totalRow = null, googleNote = '', sec = null;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var a = sv(r[0]);

    // detect section headers
    if (a === 'Reporting Month' && sv(r[2]) === 'Campaign') { sec = 'camp';   continue; }
    if (a === 'Month'           && sv(r[1]).indexOf('Approved') !== -1) { sec = 'budget'; continue; }

    if (sec === 'camp') {
      var ch   = sv(r[1]);
      var camp = sv(r[2]);
      if (!camp) continue;
      var spend = toMoney(r[3]);
      if (ch === 'Google' && spend === 0) { googleNote = camp; continue; }
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
      else campaigns.push(entry);
    }

    if (sec === 'budget') {
      var mo = sv(r[0]);
      if (!mo || mo === 'Month') continue;
      budget.push({
        month:    mo,
        approved: toMoney(r[1]) || null,
        spent:    toMoney(r[2]) || null,
        paid:     sv(r[4])
      });
    }
  }

  d.paid   = { total: totalRow || {}, campaigns: campaigns, google: googleNote };
  d.budget = budget;
}

// ── SHOWCASE + MARKET (scan every sheet) ─────────────────────────────────────
function readShowcaseAndMarket(ss, d) {
  if (!d.showcase) d.showcase = [];
  if (!d.market)   d.market   = [];
  var seenS = {}, seenM = {};

  var sheets = ss.getSheets();
  for (var si = 0; si < sheets.length; si++) {
    var rows = sheets[si].getDataRange().getValues();
    var sec  = null;

    for (var i = 0; i < rows.length; i++) {
      var a = sv(rows[i][0]);
      var b = sv(rows[i][1]);

      if (a === 'Name tag'  && b === 'Type')     { sec = 'sc'; continue; }
      if (a === 'Date'      && b === 'Headline') { sec = 'mk'; continue; }
      if (!a && !b && sec)                       { sec = null; continue; }

      if (sec === 'sc' && a) {
        var k = a + '|' + b;
        if (!seenS[k]) {
          seenS[k] = 1;
          d.showcase.push({ name: a, type: b, link: sv(rows[i][2]), phase: sv(rows[i][3]), caption: sv(rows[i][4]) });
        }
      }
      if (sec === 'mk' && b) {
        if (!seenM[b]) {
          seenM[b] = 1;
          d.market.push({ date: a, headline: b, summary: sv(rows[i][2]), source: sv(rows[i][3]), link: sv(rows[i][4]) });
        }
      }
    }
  }
}

// ── FINALISE ─────────────────────────────────────────────────────────────────
function finalise(d) {
  d.phases = d._healthPhases || [];
  delete d._healthPhases;

  var t = (d.paid && d.paid.total) || {};
  function fmt(n) { n = n || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K' : String(Math.round(n)); }
  d.kpis = [
    { v: fmt(t.spend),                         l: 'Paid spend (AED)',    tag: 'live'   },
    { v: t.leads  || 0,                         l: 'Leads (form+IF)',     tag: 'live'   },
    { v: t.cpl    || 0,                         l: 'Blended CPL (AED)',   tag: 'live'   },
    { v: (d.delivered || 0) + '/' + (d.total || 0), l: 'Deliverables',   tag: 'auto'   },
    { v: d.deals  || 0,                         l: 'Deals (dev-provided)',tag: 'manual' }
  ];
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function sv(v)      { return String(v === null || v === undefined ? '' : v).trim(); }
function toInt(v)   { return parseInt(sv(v).replace(/[^0-9]/g, '')) || 0; }
function toMoney(v) { return parseFloat(sv(v).replace(/,/g, '')) || 0; }
function toPct(v)   { var s = sv(v); return s.indexOf('%') !== -1 ? parseFloat(s) / 100 : parseFloat(s) || 0; }
function jsonOut(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
