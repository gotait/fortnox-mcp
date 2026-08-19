/**
 * MCP Apps (SEP-1865) — interactive widgets for the analytics tools.
 *
 * How the pieces fit:
 *
 *   1. Each widget is a `ui://` resource whose body is a self-contained HTML
 *      document (src/apps/generated/widgets.ts, built by scripts/build-apps.mjs).
 *   2. A tool opts in by carrying `_meta.ui.resourceUri`. The host then fetches
 *      the resource and hands the tool result to it.
 *   3. The widget renders from `structuredContent` — the same payload the
 *      outputSchema declares — and never fetches anything itself.
 *
 * Deliberate choices:
 *
 * - No `_meta.ui.csp` on the resources. The host's default is
 *   `default-src 'none'; connect-src 'none'`, which is exactly right here: the
 *   widgets carry their CSS and JS inline and make no requests. Widening the
 *   policy would only be needed by a widget that loads or calls out, and one
 *   that called back to us would put accounting data on a second path — which
 *   the biträdesavtal would then have to describe. Keeping the widgets
 *   render-only avoids that question entirely.
 *
 * - Tools are annotated unconditionally rather than gated on the client
 *   advertising `io.modelcontextprotocol/ui`. Every tool here already returns a
 *   full markdown answer, which the extension requires as the text fallback, so
 *   a host that ignores `_meta.ui` loses nothing. Gating would also be awkward:
 *   this server builds its tool list per request, before it has seen the
 *   client's capabilities.
 *
 * - One bundled document serves every widget, with the id injected at
 *   resource-read time. The tool name is not part of the protocol, so the
 *   document has to be told which renderer to run; bundling once rather than
 *   per widget keeps a single copy of the ~300 KB MCP Apps client in the Worker.
 *
 * - Only read-only analytics tools get widgets. A widget can call tools back
 *   through the host (`app.callServerTool`), so keeping write tools out of the
 *   UI surface means a rendered chart can never become a write path.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  WIDGET_ID_PLACEHOLDER,
  WIDGET_IDS,
  WIDGET_SHELL_HTML,
  type WidgetId
} from "./generated/widgets.js";

/** Per the extension: `text/html` with the mcp-app profile. */
export const APP_MIME_TYPE = "text/html;profile=mcp-app";

/** Resource URI for a widget. The path shape is ours to choose. */
export function widgetUri(id: WidgetId): string {
  return `ui://fortnox/${id}.html`;
}

/**
 * Which tools render through which widget.
 *
 * `satisfies` ties this to the generated widget ids, so deleting or renaming a
 * widget file breaks the build instead of leaving a tool pointing at a resource
 * that no longer exists.
 */
export const TOOL_WIDGETS = {
  fortnox_top_customers: "top-customers",
  fortnox_invoice_summary: "invoice-summary",
  fortnox_unpaid_report: "unpaid-report",
  fortnox_sales_funnel: "sales-funnel",
  fortnox_cash_flow_forecast: "cash-flow",
  fortnox_order_pipeline: "order-pipeline",
  fortnox_period_comparison: "period-comparison"
} satisfies Record<string, WidgetId>;

export type WidgetToolName = keyof typeof TOOL_WIDGETS;

/**
 * The `_meta` to spread into a tool's registerTool config.
 *
 * Typed to the mapping above so a typo in the tool name is a compile error.
 */
export function uiMeta(tool: WidgetToolName): { ui: { resourceUri: string } } {
  return { ui: { resourceUri: widgetUri(TOOL_WIDGETS[tool]) } };
}

const WIDGET_TITLES: Record<WidgetId, string> = {
  "top-customers": "Toppkunder",
  "invoice-summary": "Fakturasammanställning",
  "unpaid-report": "Obetalda kundfakturor",
  "sales-funnel": "Säljtratt",
  "cash-flow": "Kassaflödesprognos",
  "order-pipeline": "Orderflöde",
  "period-comparison": "Periodjämförelse"
};

/**
 * Register one resource per widget.
 *
 * Call this alongside registerAllTools in every entry point — a tool carrying
 * `_meta.ui.resourceUri` whose resource is not registered would leave the host
 * unable to read the UI it was told about.
 */
export function registerAppResources(server: McpServer): void {
  for (const id of WIDGET_IDS) {
    const uri = widgetUri(id);
    server.registerResource(
      id,
      uri,
      {
        title: WIDGET_TITLES[id],
        description: `Interactive view for ${
          Object.entries(TOOL_WIDGETS).find(([, w]) => w === id)?.[0] ?? id
        }`,
        mimeType: APP_MIME_TYPE
      },
      // every widget shares one bundled document; the id tells main.ts which
      // renderer to run, since the tool name never reaches the iframe
      async () => ({
        contents: [
          {
            uri,
            mimeType: APP_MIME_TYPE,
            text: WIDGET_SHELL_HTML.replace(WIDGET_ID_PLACEHOLDER, id)
          }
        ]
      })
    );
  }
}
