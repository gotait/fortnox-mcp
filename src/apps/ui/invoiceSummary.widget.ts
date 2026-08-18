/**
 * Widget for fortnox_invoice_summary — grouped totals as horizontal bars.
 *
 * Shape comes from InvoiceSummaryOutputSchema (src/schemas/analytics.ts). The
 * tool only produces `groups` when called with group_by, so without it the
 * widget shows the headline figures instead of an empty chart.
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { barChart, heading, money, paint, periodLabel, type BarRow } from "./shell.js";

interface Stats {
  count: number;
  total: number;
  average: number;
  total_balance: number;
}

interface InvoiceSummary {
  period?: string | null;
  date_range?: string | null;
  summary?: Stats;
  groups?: Array<{ key: string; stats: Stats }>;
  truncated?: boolean;
}

const app = new App({ name: "Fortnox invoice summary", version: "1.0.0" });
app.connect();

app.ontoolresult = (result) => {
  const data = (result.structuredContent ?? {}) as InvoiceSummary;
  const groups = data.groups ?? [];
  const s = data.summary;

  const headline = s
    ? `<p class="total" style="margin-top:0;border-top:0;padding-top:0">` +
      `${s.count} fakturor · ${money(s.total)} totalt · ${money(s.average)} i snitt` +
      `${s.total_balance ? ` · ${money(s.total_balance)} obetalt` : ""}</p>`
    : "";

  const rows: BarRow[] = groups.map((g) => ({
    label: g.key,
    value: g.stats.total,
    note: `${money(g.stats.total)} (${g.stats.count} st)`
  }));

  paint(
    heading("Fakturasammanställning", periodLabel(data)) +
      headline +
      (groups.length
        ? barChart(rows)
        : `<p class="empty">Anropa verktyget med group_by för att få en uppdelning per månad, kund eller status.</p>`) +
      (data.truncated ? `<p class="total">Urvalet är avkortat.</p>` : "")
  );
};
