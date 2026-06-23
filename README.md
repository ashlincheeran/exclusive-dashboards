# betterhomes — Exclusive Project Dashboards

One repo, all exclusive-project dashboards. One Vercel project + one domain serves them all.

## Structure
```
/                  → hub page (links to every project)
/city-tower/       → City Tower 1 dashboard
/<project>/        → add a folder per project (index.html inside)
vercel.json        → clean URLs + no-cache headers (prevents stale views)
```
Each dashboard is a single self-contained `index.html`. URLs: `exclusive.bhomes.com/city-tower`, etc.

## One-time setup (techy colleague, paid Vercel)
1. **GitHub:** create a repo (e.g. `exclusive-dashboards`) and push this folder.
2. **Vercel:** New Project → **Import** this GitHub repo → Framework Preset: **Other** → **Deploy**. (No build step — static files.)
3. **Domain:** Project → **Settings → Domains → Add** `exclusive.bhomes.com`. Vercel shows a **CNAME** (`exclusive` → `cname.vercel-dns.com`). Add that record in bhomes.com DNS. SSL is automatic.
4. (Optional) **Privacy:** Settings → Deployment Protection → enable password protection, or use unguessable folder names.

## Updating a dashboard (no code)
- The marketing updater edits the project's Google Sheet, then asks Claude to regenerate.
- Claude produces the new `index.html`; it's committed to this repo (by Claude with a GitHub connector, or by the colleague replacing the file).
- Vercel **auto-deploys** on every push — same URL, updated content.

## Adding a NEW project
1. Create a folder `/<project>/` with its `index.html`.
2. Add a card to the hub `index.html`.
3. Commit & push → live at `exclusive.bhomes.com/<project>`.

_Note: showcase image thumbnails load only if those Google Drive files are shared “anyone with the link”._
