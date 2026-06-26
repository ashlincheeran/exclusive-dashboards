#!/usr/bin/env python3
"""Nightly script: extract DATA from dashboard HTML, ask Claude to regenerate the ai block, write back."""

import json
import os
import re
import sys
from datetime import date

import anthropic

HTML_PATH = os.path.join(os.path.dirname(__file__), "..", "city-tower", "index.html")

DATA_RE = re.compile(r"(var DATA=)(\{.*?\})(;)", re.DOTALL)


def extract_data(html: str) -> dict:
    m = DATA_RE.search(html)
    if not m:
        raise ValueError("Could not find 'var DATA={...};' in HTML")
    return json.loads(m.group(2))


def inject_data(html: str, data: dict) -> str:
    new_data_str = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return DATA_RE.sub(rf"\g<1>{new_data_str}\g<3>", html)


def build_prompt(data: dict) -> str:
    paid = data.get("paid", {})
    total = paid.get("total", {})
    campaigns = paid.get("campaigns", [])
    where = data.get("where", {})
    market = data.get("market", [])
    delivered = data.get("delivered", 0)
    total_units = data.get("total", 0)
    dev_delivered = data.get("devDelivered", 0)
    delayed = data.get("delayed", 0)
    counter_cum = data.get("counterCum", [])
    phase = data.get("phase", "")
    overall = data.get("overall", 0)

    campaigns_summary = "\n".join(
        f"  - {c[0]}: spend AED {c[1]:,}, leads {c[2]}, CPL {c[3]}"
        for c in campaigns
        if len(c) >= 4
    )

    counter_lines = "\n".join(
        f"  - {row[0]}: {row[2]} total" for row in counter_cum if len(row) >= 3
    )

    market_lines = "\n".join(f"  - {m[0]}: {m[1]}" for m in market if len(m) >= 2)

    wins = "\n".join(f"  - {w}" for w in where.get("Win", []))
    watch_outs = "\n".join(f"  - {w}" for w in where.get("Watch-out", []))
    decisions = "\n".join(f"  - {d}" for d in where.get("Decision", []))

    today = date.today().strftime("%-d %b %Y")

    return f"""You are the performance marketing AI assistant for the Exclusive Real Estate team managing the City Tower 1 project in Dubai.

Based on the latest dashboard data below, generate fresh AI insights for today ({today}).

=== DASHBOARD DATA ===

Phase: {phase}
Overall delivery: {overall}%
Creative assets delivered: {delivered} of {total_units} total ({dev_delivered}% developer materials received, {delayed} delayed batch)

PAID MEDIA (Meta):
Total: AED {total.get('spend', 0):,.0f} spend, {total.get('leads', 0)} leads, CPL AED {total.get('cpl', 0)}
Campaigns:
{campaigns_summary}

CUMULATIVE ACTIVITY:
{counter_lines}

WINS:
{wins}

WATCH-OUTS:
{watch_outs}

DECISIONS NEEDED:
{decisions}

MARKET CONTEXT:
{market_lines}

=== OUTPUT FORMAT ===

Return a JSON object ONLY — no markdown, no explanation, no code fences. The object must match this exact schema:

{{
  "when": "Generated {today}",
  "body": "<2-3 sentence executive summary of the project status, focusing on delivery progress, paid media performance, and biggest open risk>",
  "calls": [
    ["<action title 1>", "<1-sentence rationale>"],
    ["<action title 2>", "<1-sentence rationale>"],
    ["<action title 3>", "<1-sentence rationale>"],
    ["<action title 4>", "<1-sentence rationale>"]
  ],
  "insights": {{
    "delivery": ["Delivery", "<1-sentence insight on asset delivery progress>"],
    "activity": ["Activity", "<1-sentence insight on cumulative output>"],
    "perf": ["Performance", "<1-sentence insight on paid media results>"]
  }}
}}

Keep action titles concise (4-7 words). Base every statement strictly on the numbers above.
"""


def regenerate_ai_block(data: dict) -> dict:
    client = anthropic.Anthropic()

    response = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        thinking={"type": "adaptive"},
        messages=[{"role": "user", "content": build_prompt(data)}],
    )

    # Extract text from the response (skip thinking blocks)
    raw = ""
    for block in response.content:
        if block.type == "text":
            raw = block.text.strip()
            break

    # Strip accidental code fences if the model adds them
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    return json.loads(raw)


def main():
    with open(HTML_PATH, encoding="utf-8") as f:
        html = f.read()

    data = extract_data(html)
    print(f"Extracted DATA; current ai.when = {data.get('ai', {}).get('when', 'n/a')}")

    new_ai = regenerate_ai_block(data)
    print(f"Claude returned new ai.when = {new_ai.get('when')}")

    data["ai"] = new_ai
    new_html = inject_data(html, data)

    with open(HTML_PATH, "w", encoding="utf-8") as f:
        f.write(new_html)

    print("HTML updated successfully.")


if __name__ == "__main__":
    main()
