/**
 * Widget for fortnox_unpaid_report — the aging buckets as horizontal bars.
 *
 * Shape comes from UnpaidReportOutputSchema (src/schemas/analytics.ts). Bars are
 * only drawn when the tool was called with group_by, which is what produces
 * by_age_bucket / by_customer.
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { barChart, heading, money, paint, type BarRow } from "./shell.js";

interface Bucketed {
  count: number;
  total_balance: number;
}

interface UnpaidReport {
  summary?: {
    total_invoices: number;
    total_invoice_amount: number;
    total_unpaid_balance: number;
    unique_customers: number;
  };
  by_age_bucket?: Array<Bucketed & { bucket: string }>;
  by_customer?: Array<Bucketed & { customer: string }>;
  truncated?: boolean;
}

const app = new App({ name: "Fortnox unpaid report", version: "1.0.0" });
app.connect();

app.ontoolresult = (result) => {
  const data = (result.structuredContent ?? {}) as UnpaidReport;
  const s = data.summary;
  const buckets = data.by_age_bucket ?? [];
  const customers = data.by_customer ?? [];

  const headline = s
    ? `<p class="total" style="margin-top:0;border-top:0;padding-top:0">` +
      `${money(s.total_unpaid_balance)} obetalt över ${s.total_invoices} fakturor` +
      ` och ${s.unique_customers} kunder</p>`
    : "";

  // aging first — it is the question this report is usually asked to answer
  const bucketRows: BarRow[] = buckets.map((b) => ({
    label: b.bucket,
    value: b.total_balance,
    note: `${money(b.total_balance)} (${b.count} st)`
  }));
  const customerRows: BarRow[] = customers.slice(0, 12).map((c) => ({
    label: c.customer,
    value: c.total_balance,
    note: `${money(c.total_balance)} (${c.count} st)`
  }));

  const sections =
    (buckets.length
      ? `<p class="sub" style="margin:1.1rem 0 .3rem">Förfallostruktur</p>${barChart(bucketRows)}`
      : "") +
    (customers.length
      ? `<p class="sub" style="margin:1.3rem 0 .3rem">Största fordringar per kund</p>${barChart(
          customerRows
        )}`
      : "");

  paint(
    heading("Obetalda kundfakturor") +
      headline +
      (sections ||
        `<p class="empty">Anropa verktyget med group_by="age_bucket", "customer" eller "both" för en uppdelning.</p>`) +
      (data.truncated ? `<p class="total">Urvalet är avkortat.</p>` : "")
  );
};
