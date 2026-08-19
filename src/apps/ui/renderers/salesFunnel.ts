import { barChart, factRows, heading, money, periodLabel, section, type Renderer } from "../shell.js";

interface Stage { count: number; value: number; converted?: number; open?: number }

export const renderSalesFunnel: Renderer = (data) => {
  const funnel = data.funnel as
    | { offers: Stage; orders: Stage; invoices: Stage }
    | undefined;
  const rates = data.conversion_rates as
    | { offer_to_order: number; order_to_invoice: number; overall: number }
    | undefined;

  if (!funnel) return heading("Säljtratt", periodLabel(data)) + `<p class="empty">Ingen data.</p>`;

  // one scale across the three stages, so the narrowing is visible
  const stages = barChart([
    { label: "Offerter", value: funnel.offers.value, note: `${money(funnel.offers.value)} (${funnel.offers.count} st)` },
    { label: "Order", value: funnel.orders.value, note: `${money(funnel.orders.value)} (${funnel.orders.count} st)` },
    { label: "Fakturor", value: funnel.invoices.value, note: `${money(funnel.invoices.value)} (${funnel.invoices.count} st)` }
  ]);

  const conversions = rates
    ? section("Konvertering") +
      factRows([
        ["Offert → order", `${Math.round(rates.offer_to_order * 10) / 10} %`],
        ["Order → faktura", `${Math.round(rates.order_to_invoice * 10) / 10} %`],
        ["Totalt (produkt av stegen)", `${Math.round(rates.overall * 10) / 10} %`]
      ])
    : "";

  const open = section("Öppet i tratten") +
    factRows([
      ["Öppna offerter", `${funnel.offers.open ?? 0} st`],
      ["Öppna order", `${funnel.orders.open ?? 0} st`]
    ]);

  return (
    heading("Säljtratt", periodLabel(data)) +
    stages +
    conversions +
    open +
    (data.truncated ? `<p class="total">Urvalet är avkortat.</p>` : "")
  );
};
