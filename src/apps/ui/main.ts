/**
 * Single entry point for every widget.
 *
 * One bundle serves all of them: the tool name is not part of the MCP Apps
 * protocol (the tool-result notification carries only the CallToolResult, and
 * tool-input carries only arguments), so the server injects the widget id into
 * the document it serves — `<body data-widget="…">` — and this dispatches on it.
 *
 * Bundling once instead of once per widget keeps the Worker to a single copy of
 * the ~300 KB MCP Apps client rather than one per view.
 */
import { App } from "@modelcontextprotocol/ext-apps";

import { paint, type Renderer } from "./shell.js";
import { renderCashFlow } from "./renderers/cashFlow.js";
import { renderInvoiceSummary } from "./renderers/invoiceSummary.js";
import { renderOrderPipeline } from "./renderers/orderPipeline.js";
import { renderPeriodComparison } from "./renderers/periodComparison.js";
import { renderSalesFunnel } from "./renderers/salesFunnel.js";
import { renderTopCustomers } from "./renderers/topCustomers.js";
import { renderUnpaidReport } from "./renderers/unpaidReport.js";

/**
 * id → renderer. The build script reads the quoted keys here to generate the
 * widget id list, so this is the single source of truth for which widgets exist.
 * Keep the keys as plain quoted strings on their own lines.
 */
export const RENDERERS = {
  "cash-flow": renderCashFlow,
  "invoice-summary": renderInvoiceSummary,
  "order-pipeline": renderOrderPipeline,
  "period-comparison": renderPeriodComparison,
  "sales-funnel": renderSalesFunnel,
  "top-customers": renderTopCustomers,
  "unpaid-report": renderUnpaidReport
} satisfies Record<string, Renderer>;

const id = document.body.dataset.widget ?? "";
const render = (RENDERERS as Record<string, Renderer | undefined>)[id];

const app = new App({ name: `Fortnox ${id || "widget"}`, version: "1.0.0" });
app.connect();

app.ontoolresult = (result) => {
  if (!render) {
    paint(`<p class="empty">Okänd vy: ${id || "(ingen)"}.</p>`);
    return;
  }
  const data = (result.structuredContent ?? {}) as Record<string, unknown>;
  try {
    paint(render(data));
  } catch (error) {
    // a renderer throwing should not leave the panel on "Laddar…" forever
    paint(
      `<p class="empty">Kunde inte rita vyn. Svaret i text finns kvar i konversationen.</p>`
    );
    console.error("[fortnox-widget] render failed", error);
  }
};
