import { delta, escapeHtml, heading, money, trendMark, type Renderer } from "../shell.js";

interface Growth { current: number; previous: number; change: number; percentChange: number; trend: string }
interface Side { description: string; date_range?: { from_date: string; to_date: string } }

const LABEL: Record<string, string> = {
  revenue: "Omsättning",
  invoice_count: "Antal fakturor",
  average_invoice: "Snittfaktura",
  unique_customers: "Unika kunder"
};

/** counts read wrong as money */
function fmt(metric: string, value: number): string {
  return metric === "invoice_count" || metric === "unique_customers"
    ? `${Math.round(value)} st`
    : money(value);
}

export const renderPeriodComparison: Renderer = (data) => {
  const current = data.current_period as Side | undefined;
  const previous = data.previous_period as Side | undefined;
  const comparison = (data.comparison as Record<string, Growth> | undefined) ?? {};
  const entries = Object.entries(comparison);

  const subtitle =
    current && previous ? `${current.description} vs ${previous.description}` : "";

  if (entries.length === 0) {
    return heading("Periodjämförelse", subtitle) + `<p class="empty">Inga mätvärden att jämföra.</p>`;
  }

  // a comparison is a table, not a chart: two periods on one bar scale hides
  // the thing being asked about, which is the direction and size of the change
  const rows = entries
    .map(([metric, g]) => {
      const colour = g.trend === "up" ? "var(--fg)" : g.trend === "down" ? "var(--accent)" : "var(--muted)";
      return `<tr>
        <td class="label">${escapeHtml(LABEL[metric] ?? metric)}</td>
        <td class="value">${escapeHtml(fmt(metric, g.previous))}</td>
        <td class="value">${escapeHtml(fmt(metric, g.current))}</td>
        <td class="value" style="color:${colour}">${trendMark(g.trend)} ${escapeHtml(delta(g.percentChange))}</td>
      </tr>`;
    })
    .join("");

  return (
    heading("Periodjämförelse", subtitle) +
    `<table>
      <tr>
        <td class="label"></td>
        <td class="value">${escapeHtml(previous?.description ?? "Föregående")}</td>
        <td class="value">${escapeHtml(current?.description ?? "Aktuell")}</td>
        <td class="value">Förändring</td>
      </tr>
      ${rows}
    </table>` +
    (data.truncated ? `<p class="total">Urvalet är avkortat.</p>` : "")
  );
};
