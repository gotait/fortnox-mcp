import { barChart, heading, money, periodLabel, type BarRow, type Renderer } from "../shell.js";

interface Stats { count: number; total: number; average: number; total_balance: number }

export const renderInvoiceSummary: Renderer = (data) => {
  const groups = (data.groups as Array<{ key: string; stats: Stats }> | undefined) ?? [];
  const s = data.summary as Stats | undefined;

  const headline = s
    ? `<p class="total" style="margin-top:0;border-top:0;padding-top:0">${s.count} fakturor · ${money(
        s.total
      )} totalt · ${money(s.average)} i snitt${
        s.total_balance ? ` · ${money(s.total_balance)} obetalt` : ""
      }</p>`
    : "";

  const rows: BarRow[] = groups.map((g) => ({
    label: g.key,
    value: g.stats.total,
    note: `${money(g.stats.total)} (${g.stats.count} st)`
  }));

  return (
    heading("Fakturasammanställning", periodLabel(data)) +
    headline +
    (groups.length
      ? barChart(rows)
      : `<p class="empty">Anropa verktyget med group_by för en uppdelning per månad, kund eller status.</p>`) +
    (data.truncated ? `<p class="total">Urvalet är avkortat.</p>` : "")
  );
};
