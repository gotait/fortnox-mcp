import { barChart, factRows, heading, money, periodLabel, section, type BarRow, type Renderer } from "../shell.js";

interface Group { key: string; count: number; total_value: number; average_value: number }

export const renderOrderPipeline: Renderer = (data) => {
  const s = data.summary as
    | {
        total_orders: number;
        total_value: number;
        pending_orders: number;
        pending_value: number;
        invoiced_orders: number;
        invoiced_value: number;
        cancelled_orders: number;
        unique_customers: number;
      }
    | undefined;
  const groups = (data.groups as Group[] | undefined) ?? [];

  const status = s
    ? barChart([
        { label: "Ej fakturerat", value: s.pending_value, note: `${money(s.pending_value)} (${s.pending_orders} st)` },
        { label: "Fakturerat", value: s.invoiced_value, note: `${money(s.invoiced_value)} (${s.invoiced_orders} st)` }
      ]) +
      factRows([
        ["Order totalt", `${s.total_orders} st · ${money(s.total_value)}`],
        ["Annullerade", `${s.cancelled_orders} st`],
        ["Unika kunder", `${s.unique_customers} st`]
      ])
    : "";

  const groupRows: BarRow[] = groups.slice(0, 15).map((g) => ({
    label: g.key,
    value: g.total_value,
    note: `${money(g.total_value)} (${g.count} st)`
  }));

  return (
    heading("Orderflöde", periodLabel(data)) +
    status +
    (groups.length ? section(`Per ${String(data.group_by ?? "grupp")}`) + barChart(groupRows) : "") +
    (data.truncated ? `<p class="total">Urvalet är avkortat.</p>` : "")
  );
};
