import { barChart, heading, money, section, type BarRow, type Renderer } from "../shell.js";

interface Bucket { bucket: string; count: number; total_balance: number }
interface ByCustomer { customer: string; count: number; total_balance: number }

export const renderUnpaidReport: Renderer = (data) => {
  const s = data.summary as
    | { total_invoices: number; total_unpaid_balance: number; unique_customers: number }
    | undefined;
  const buckets = (data.by_age_bucket as Bucket[] | undefined) ?? [];
  const customers = (data.by_customer as ByCustomer[] | undefined) ?? [];

  const headline = s
    ? `<p class="total" style="margin-top:0;border-top:0;padding-top:0">${money(
        s.total_unpaid_balance
      )} obetalt över ${s.total_invoices} fakturor och ${s.unique_customers} kunder</p>`
    : "";

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

  // aging first: it is the question this report is usually asked to answer
  const body =
    (buckets.length ? section("Förfallostruktur") + barChart(bucketRows) : "") +
    (customers.length ? section("Största fordringar per kund") + barChart(customerRows) : "");

  return (
    heading("Obetalda kundfakturor") +
    headline +
    (body ||
      `<p class="empty">Anropa verktyget med group_by="age_bucket", "customer" eller "both" för en uppdelning.</p>`) +
    (data.truncated ? `<p class="total">Urvalet är avkortat.</p>` : "")
  );
};
