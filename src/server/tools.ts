import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCustomerTools } from "../tools/customers.js";
import { registerInvoiceTools } from "../tools/invoices.js";
import { registerSupplierTools } from "../tools/suppliers.js";
import { registerSupplierInvoiceTools } from "../tools/supplierInvoices.js";
import { registerAccountTools } from "../tools/accounts.js";
import { registerVoucherTools } from "../tools/vouchers.js";
import { registerCompanyTools } from "../tools/company.js";
import { registerAnalyticsTools } from "../tools/analytics.js";
import { registerOrderTools } from "../tools/orders.js";
import { registerBIAnalyticsTools } from "../tools/biAnalytics.js";

/**
 * Register every Fortnox tool on a server.
 *
 * Shared by the stdio, local HTTP, remote Express and Cloudflare Worker entry
 * points so that a tool added in one transport cannot go missing in another.
 * Call applyReadOnlyMode() before this to filter out write tools.
 */
export function registerAllTools(server: McpServer): void {
  registerCustomerTools(server);
  registerInvoiceTools(server);
  registerSupplierTools(server);
  registerSupplierInvoiceTools(server);
  registerAccountTools(server);
  registerVoucherTools(server);
  registerCompanyTools(server);
  registerAnalyticsTools(server);
  registerOrderTools(server);
  registerBIAnalyticsTools(server);
}
