/**
 * Widget for fortnox_top_customers — ranked customers as horizontal bars.
 *
 * Renders from structuredContent, whose shape is declared by
 * TopCustomersOutputSchema in src/schemas/analytics.ts.
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { barChart, heading, money, paint, periodLabel, type BarRow } from "./shell.js";

interface Customer {
  rank: number;
  customer_number: string;
  customer_name: string;
  total_amount: number;
  invoice_count: number;
  unpaid_amount: number;
  average_invoice: number;
}

interface TopCustomers {
  metric?: string;
  period?: string | null;
  date_range?: string | null;
  customers?: Customer[];
  truncated?: boolean;
}

/** Which field the server ranked by, so the bars match the ranking. */
function valueFor(c: Customer, metric: string): number {
  if (metric === "invoice_count") return c.invoice_count;
  if (metric === "unpaid_amount") return c.unpaid_amount;
  if (metric === "average_invoice") return c.average_invoice;
  return c.total_amount;
}

const METRIC_LABEL: Record<string, string> = {
  total_amount: "Fakturerat belopp",
  invoice_count: "Antal fakturor",
  unpaid_amount: "Obetalt belopp",
  average_invoice: "Snittfaktura"
};

const app = new App({ name: "Fortnox top customers", version: "1.0.0" });
app.connect();

app.ontoolresult = (result) => {
  const data = (result.structuredContent ?? {}) as TopCustomers;
  const customers = data.customers ?? [];
  const metric = data.metric ?? "total_amount";
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
  const label = METRIC_LABEL[metric] ?? metric;

  paint(
    heading(`Toppkunder — ${label}`, periodLabel(data)) +
      barChart(rows) +
      (customers.length
        ? `<p class="total">Summa för visade kunder: ${
            isCount ? `${total} fakturor` : money(total)
          }${data.truncated ? " · urvalet är avkortat" : ""}</p>`
        : "")
  );
};
