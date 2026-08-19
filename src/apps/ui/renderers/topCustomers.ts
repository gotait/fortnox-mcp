import { barChart, heading, money, periodLabel, type BarRow, type Renderer } from "../shell.js";

interface Customer {
  rank: number;
  customer_name: string;
  total_amount: number;
  invoice_count: number;
  unpaid_amount: number;
  average_invoice: number;
}

const METRIC_LABEL: Record<string, string> = {
  total_amount: "Fakturerat belopp",
  invoice_count: "Antal fakturor",
  unpaid_amount: "Obetalt belopp",
  average_invoice: "Snittfaktura"
};

/** Bars follow whichever metric the server ranked by. */
function valueFor(c: Customer, metric: string): number {
  if (metric === "invoice_count") return c.invoice_count;
  if (metric === "unpaid_amount") return c.unpaid_amount;
  if (metric === "average_invoice") return c.average_invoice;
  return c.total_amount;
}

export const renderTopCustomers: Renderer = (data) => {
  const customers = (data.customers as Customer[] | undefined) ?? [];
  const metric = String(data.metric ?? "total_amount");
  const isCount = metric === "invoice_count";

  const rows: BarRow[] = customers.map((c) => {
    const value = valueFor(c, metric);
    return {
      label: `${c.rank}. ${c.customer_name}`,
      value,
      note: isCount ? `${value} st` : money(value)
    };
  });
  const total = customers.reduce((sum, c) => sum + valueFor(c, metric), 0);

  return (
    heading(`Toppkunder — ${METRIC_LABEL[metric] ?? metric}`, periodLabel(data)) +
    barChart(rows) +
    (customers.length
      ? `<p class="total">Summa för visade kunder: ${
          isCount ? `${total} fakturor` : money(total)
        }${data.truncated ? " · urvalet är avkortat" : ""}</p>`
      : "")
  );
};
