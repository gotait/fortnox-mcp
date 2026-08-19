import { barChart, factRows, heading, money, section, type BarRow, type Renderer } from "../shell.js";

/** camelCase, matching what the handler emits (see CashFlowForecastOutputSchema). */
interface Period {
  period: string;
  inflows: number;
  outflows: number;
  netFlow: number;
  runningBalance: number;
  receivablesCount: number;
  payablesCount: number;
}

export const renderCashFlow: Renderer = (data) => {
  const forecast = data.forecast as { horizon_days?: number; from_date?: string; to_date?: string } | undefined;
  const summary = data.summary as
    | {
        total_receivables: number;
        total_payables: number;
        net_position: number;
        ending_balance: number;
      }
    | undefined;
  const periods = (data.periods as Period[] | undefined) ?? [];

  const subtitle = forecast
    ? `${forecast.from_date ?? ""} – ${forecast.to_date ?? ""} · ${forecast.horizon_days ?? "?"} dagar`
    : "";

  const totals = summary
    ? factRows([
        ["Förväntat in", money(summary.total_receivables)],
        ["Förväntat ut", money(summary.total_payables)],
        ["Netto", money(summary.net_position)],
        ["Slutsaldo", money(summary.ending_balance)]
      ])
    : "";

  // net flow per period, signed — a negative period should read as negative
  const netRows: BarRow[] = periods.map((p) => ({
    label: p.period,
    value: p.netFlow,
    note: `${p.netFlow >= 0 ? "" : "−"}${money(Math.abs(p.netFlow))}`
  }));

  // running balance is the line people actually watch
  const balanceRows: BarRow[] = periods.map((p) => ({
    label: p.period,
    value: p.runningBalance,
    note: money(p.runningBalance)
  }));

  const body = periods.length
    ? section("Netto per period") +
      barChart(netRows) +
      section("Löpande saldo") +
      barChart(balanceRows)
    : `<p class="empty">Inga poster inom horisonten.</p>`;

  return (
    heading("Kassaflödesprognos", subtitle) +
    totals +
    body +
    (data.warning ? `<p class="total">${String(data.warning)}</p>` : "") +
    (data.truncated ? `<p class="total">Urvalet är avkortat.</p>` : "")
  );
};
