/**
 * Shared widget helpers.
 *
 * Bundled into every widget by scripts/build-apps.mjs, so this file runs in the
 * host's sandboxed iframe — not on the server. Keep it dependency-free apart
 * from the MCP Apps client, and draw with inline SVG: the host's default CSP is
 * `default-src 'none'`, so a CDN chart library would simply not load.
 *
 * Nothing here fetches. Widgets render only from the tool result the host
 * already holds, which keeps the data flow identical to the text response and
 * out of the sub-processor question entirely.
 */

/** Warm neutral palette, mirrored for dark hosts. */
export const CSS = `
  :root {
    color-scheme: light dark;
    --fg: #211c16; --muted: #4a4236; --line: #d8ccb8;
    --bg: #faf7f1; --surface: #ffffff; --bar: #211c16; --accent: #c74c1b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fg: #f5f2ec; --muted: #a8a29e; --line: #44403c;
      --bg: #1c1917; --surface: #262220; --bar: #e7e3da; --accent: #e2703a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 1rem 1.15rem 1.25rem; background: var(--bg); color: var(--fg);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  h1 { margin: 0 0 .15rem; font-size: 1rem; font-weight: 600; }
  .sub { margin: 0 0 1.1rem; color: var(--muted); font-size: .8rem; }
  .empty { color: var(--muted); font-size: .85rem; padding: 1rem 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: .3rem 0; vertical-align: middle; }
  td.label { white-space: nowrap; padding-right: .7rem; max-width: 14rem;
             overflow: hidden; text-overflow: ellipsis; }
  td.value { text-align: right; white-space: nowrap; padding-left: .7rem;
             font-variant-numeric: tabular-nums; color: var(--muted); }
  /* the bar column must claim the leftover width: both neighbours are nowrap, so
     without this the cell collapses to 0 and the bar's width:% resolves against
     nothing — the rows render label and value with an empty gap between them */
  td.bar { width: 100%; min-width: 3rem; }
  .track { background: var(--line); height: .7rem; border-radius: .1rem; }
  .fill { background: var(--bar); height: .7rem; border-radius: .1rem; }
  /* a negative value scaled by magnitude looks like a small positive one, which
     reads badly on a cash-flow chart — give it the accent colour instead */
  .fill.neg { background: var(--accent); }
  .total { margin-top: 1rem; padding-top: .6rem; border-top: 1px solid var(--line);
           font-size: .8rem; color: var(--muted); }
`;

/** Swedish-style money, which is what the markdown fallback already prints. */
export function money(value: number, currency = "SEK"): string {
  return `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(
    Math.round(value)
  )} ${currency}`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface BarRow {
  label: string;
  value: number;
  /** shown right of the bar; defaults to the formatted value */
  note?: string;
}

/**
 * Horizontal bars as a table, not SVG.
 *
 * A table reflows at any iframe width and stays readable to a screen reader,
 * where a fixed-viewBox SVG chart would need width plumbing to look right in
 * both inline and fullscreen display modes.
 */
export function barChart(rows: BarRow[], currency = "SEK"): string {
  if (rows.length === 0) return `<p class="empty">Inget att visa för den här perioden.</p>`;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return `<table>${rows
    .map((r) => {
      const pct = Math.max(1, Math.round((Math.abs(r.value) / max) * 100));
      const neg = r.value < 0 ? " neg" : "";
      return `<tr>
        <td class="label">${escapeHtml(r.label)}</td>
        <td class="bar"><div class="track"><div class="fill${neg}" style="width:${pct}%"></div></div></td>
        <td class="value">${escapeHtml(r.note ?? money(r.value, currency))}</td>
      </tr>`;
    })
    .join("")}</table>`;
}

/** Render into <body>, replacing the loading state. */
export function paint(html: string): void {
  document.body.innerHTML = html;
}

export function heading(title: string, subtitle?: string): string {
  return `<h1>${escapeHtml(title)}</h1>${
    subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ""
  }`;
}

/** Period label from the shared `period` / `date_range` fields. */
export function periodLabel(data: { period?: unknown; date_range?: unknown }): string {
  return String(data.date_range ?? data.period ?? "");
}

/** A renderer turns one tool's structuredContent into the widget's HTML. */
export type Renderer = (data: Record<string, unknown>) => string;

/** Percentage with a sign, for growth figures. */
export function delta(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("sv-SE")} %`;
}

/** ▲ / ▼ / → for a GrowthResult trend. */
export function trendMark(trend: string): string {
  return trend === "up" ? "▲" : trend === "down" ? "▼" : "→";
}

/** Label/value rows for figures that are not comparable on one scale. */
export function factRows(rows: Array<[string, string]>): string {
  return `<table>${rows
    .map(
      ([k, v]) =>
        `<tr><td class="label">${escapeHtml(k)}</td><td class="bar"></td>` +
        `<td class="value">${escapeHtml(v)}</td></tr>`
    )
    .join("")}</table>`;
}

/** Section label between charts. */
export function section(label: string): string {
  return `<p class="sub" style="margin:1.2rem 0 .3rem">${escapeHtml(label)}</p>`;
}
