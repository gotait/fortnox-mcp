import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fortnoxRequest, fetchAllPages } from "../services/api.js";
import { ResponseFormat } from "../constants.js";
import {
  buildToolResponse,
  buildErrorResponse,
  formatMoney,
  formatDisplayDate,
  formatListMarkdown,
  buildPaginationMeta
} from "../services/formatters.js";
import {
  periodToDateRange,
  getPeriodDescription
} from "../services/dateHelpers.js";
import {
  ListOrdersSchema,
  ListOffersSchema,
  type ListOrdersInput,
  type ListOffersInput,
  ListOrdersOutputSchema,
  ListOffersOutputSchema,
  type ListOrdersOutput,
  type ListOffersOutput,
} from "../schemas/orders.js";

// API response types for Orders
interface FortnoxOrderListItem {
  DocumentNumber: string;
  CustomerNumber: string;
  CustomerName?: string;
  OrderDate?: string;
  DeliveryDate?: string;
  Total?: number;
  Currency?: string;
  Cancelled?: boolean;
  Sent?: boolean;
  InvoiceReference?: string;
  "@url"?: string;
}

interface OrderListResponse {
  Orders: FortnoxOrderListItem[];
  MetaInformation?: {
    "@TotalResources": number;
    "@TotalPages": number;
    "@CurrentPage": number;
  };
}

// API response types for Offers
interface FortnoxOfferListItem {
  DocumentNumber: string;
  CustomerNumber: string;
  CustomerName?: string;
  OfferDate?: string;
  ExpireDate?: string;
  Total?: number;
  Currency?: string;
  Cancelled?: boolean;
  Sent?: boolean;
  OrderReference?: string;
  "@url"?: string;
}

interface OfferListResponse {
  Offers: FortnoxOfferListItem[];
  MetaInformation?: {
    "@TotalResources": number;
    "@TotalPages": number;
    "@CurrentPage": number;
  };
}

/**
 * Get order status based on properties
 */
function getOrderStatus(order: FortnoxOrderListItem): string {
  if (order.Cancelled) return "cancelled";
  if (order.InvoiceReference) return "invoiced";
  if (order.Sent) return "sent";
  return "draft";
}

/**
 * Get offer status based on properties
 */
function getOfferStatus(offer: FortnoxOfferListItem): string {
  if (offer.Cancelled) return "cancelled";
  if (offer.OrderReference) return "converted";
  if (offer.Sent) return "sent";
  return "draft";
}

/**
 * Check if offer is expired
 */
function isOfferExpired(offer: FortnoxOfferListItem): boolean {
  if (!offer.ExpireDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expireDate = new Date(offer.ExpireDate);
  return expireDate < today;
}

/**
 * Register order and offer related tools
 */
export function registerOrderTools(server: McpServer): void {
  // List Orders Tool
  server.registerTool(
    "fortnox_list_orders",
    {
      title: "List Fortnox Orders",
      description: `List sales orders from Fortnox accounting system.

Retrieves a paginated list of orders with optional filtering by status, customer, or date range.
Supports convenience period filters and can fetch all results for large datasets.

Args:
  - limit (number): Max results per page, 1-100 (default: 20)
  - page (number): Page number for pagination (default: 1)
  - filter ('cancelled' | 'expired' | 'invoicecreated' | 'invoicenotcreated'): Filter by order status ('invoicecreated' = an invoice was created from the order, 'invoicenotcreated' = no invoice has been created from the order)
  - customer_number (string): Filter by customer number
  - from_date (string): Filter orders from this date (YYYY-MM-DD)
  - to_date (string): Filter orders to this date (YYYY-MM-DD)
  - period ('today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'last_year'): Convenience date period, overrides from_date/to_date
  - sortby ('customername' | 'customernumber' | 'documentnumber' | 'orderdate' | 'total'): Field to sort by
  - sortorder ('ascending' | 'descending'): Sort order (default: ascending)
  - fetch_all (boolean): Fetch all results by auto-paginating (max 10,000 results)
  - response_format ('markdown' | 'json'): Output format (default: markdown)

Returns:
  For JSON: { total, page, limit, count, has_more, total_pages, next_offset?, truncated?, orders: [...] }
  For Markdown: Formatted list with pagination info

Examples:
  - Orders not yet invoiced: filter="invoicenotcreated"
  - Last month's orders: period="last_month"
  - Top orders by amount: sortby="total", sortorder="descending"
  - Customer orders this year: customer_number="1001", period="this_year"

Error Handling:
  - Returns "Error: Rate limit exceeded..." if API limit hit
  - Returns truncation info if fetch_all hits safety limits`,
      inputSchema: ListOrdersSchema,
      outputSchema: ListOrdersOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: ListOrdersInput) => {
      try {
        // Build query params
        const queryParams: Record<string, string | number | boolean | undefined> = {};

        if (params.filter) queryParams.filter = params.filter;
        if (params.customer_number) queryParams.customernumber = params.customer_number;

        // Handle period convenience filter
        if (params.period) {
          const dateRange = periodToDateRange(params.period);
          queryParams.fromdate = dateRange.from_date;
          queryParams.todate = dateRange.to_date;
        } else {
          if (params.from_date) queryParams.fromdate = params.from_date;
          if (params.to_date) queryParams.todate = params.to_date;
        }

        if (params.sortby) queryParams.sortby = params.sortby;
        if (params.sortorder) queryParams.sortorder = params.sortorder;

        let orders: FortnoxOrderListItem[];
        let total: number;
        let totalIsExact = true;
        let pagesFetched = 1;
        let truncated = false;
        let truncationReason: string | undefined;

        if (params.fetch_all) {
          const result = await fetchAllPages<FortnoxOrderListItem, OrderListResponse>(
            "/3/orders",
            queryParams,
            (r) => r.Orders || [],
            (r) => r.MetaInformation?.["@TotalResources"] || 0
          );
          orders = result.items;
          total = result.total;
          totalIsExact = result.totalIsExact;
          pagesFetched = result.pagesFetched;
          truncated = result.truncated;
          truncationReason = result.truncationReason;
        } else {
          queryParams.limit = params.limit;
          queryParams.page = params.page;

          const response = await fortnoxRequest<OrderListResponse>("/3/orders", "GET", undefined, queryParams);
          orders = response.Orders || [];
          total = response.MetaInformation?.["@TotalResources"] || orders.length;
        }

        const paginationMeta = params.fetch_all
          ? {
              total,
              total_is_exact: totalIsExact,
              count: orders.length,
              fetched_all: true,
              pages_fetched: pagesFetched,
              truncated,
              truncation_reason: truncationReason
            }
          : {
              ...buildPaginationMeta(total, params.page, params.limit, orders.length),
              next_offset: params.page * params.limit < total ? params.page * params.limit : undefined
            };

        const output: ListOrdersOutput = {
          ...paginationMeta,
          period_description: params.period ? getPeriodDescription(params.period) : undefined,
          orders: orders.map((order) => ({
            document_number: order.DocumentNumber,
            customer_number: order.CustomerNumber,
            customer_name: order.CustomerName || null,
            order_date: order.OrderDate || null,
            delivery_date: order.DeliveryDate || null,
            total: order.Total || 0,
            currency: order.Currency || "SEK",
            status: getOrderStatus(order),
            invoice_reference: order.InvoiceReference || null
          }))
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          const title = params.period
            ? `Orders - ${getPeriodDescription(params.period)}`
            : "Orders";

          if (params.fetch_all) {
            const lines: string[] = [
              `# ${title}`,
              "",
              `Showing ${orders.length} of ${totalIsExact ? total : `at least ${total}`} total orders`,
              `(${pagesFetched} pages fetched)`
            ];

            if (truncated) {
              lines.push("");
              lines.push(`**Results truncated**: ${truncationReason}`);
            }

            lines.push("");

            for (const order of orders) {
              const status = getOrderStatus(order);
              lines.push(`## Order #${order.DocumentNumber}`);
              lines.push(`- **Customer**: ${order.CustomerName || order.CustomerNumber}`);
              lines.push(`- **Date**: ${formatDisplayDate(order.OrderDate)} | **Delivery**: ${formatDisplayDate(order.DeliveryDate)}`);
              lines.push(`- **Total**: ${formatMoney(order.Total, order.Currency)}`);
              lines.push(`- **Status**: ${status.toUpperCase()}${order.InvoiceReference ? ` (Invoice: ${order.InvoiceReference})` : ""}`);
              lines.push("");
            }

            textContent = lines.join("\n");
          } else {
            textContent = formatListMarkdown(
              title,
              orders,
              total,
              params.page,
              params.limit,
              (order) => {
                const status = getOrderStatus(order);
                return `## Order #${order.DocumentNumber}\n` +
                  `- **Customer**: ${order.CustomerName || order.CustomerNumber}\n` +
                  `- **Date**: ${formatDisplayDate(order.OrderDate)} | **Delivery**: ${formatDisplayDate(order.DeliveryDate)}\n` +
                  `- **Total**: ${formatMoney(order.Total, order.Currency)}\n` +
                  `- **Status**: ${status.toUpperCase()}${order.InvoiceReference ? ` (Invoice: ${order.InvoiceReference})` : ""}`;
              }
            );
          }
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // List Offers Tool
  server.registerTool(
    "fortnox_list_offers",
    {
      title: "List Fortnox Offers",
      description: `List sales offers/quotes from Fortnox accounting system.

Retrieves a paginated list of offers with optional filtering by status, customer, or date range.
Supports convenience period filters and can fetch all results for large datasets.

Args:
  - limit (number): Max results per page, 1-100 (default: 20)
  - page (number): Page number for pagination (default: 1)
  - filter ('cancelled' | 'expired' | 'completed' | 'notcompleted' | 'ordercreated' | 'ordernotcreated'): Filter by offer status ('ordercreated' = an order was created from the offer, 'ordernotcreated' = no order has been created from the offer)
  - customer_number (string): Filter by customer number
  - from_date (string): Filter offers from this date (YYYY-MM-DD)
  - to_date (string): Filter offers to this date (YYYY-MM-DD)
  - period ('today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'last_year'): Convenience date period, overrides from_date/to_date
  - sortby ('customerName' | 'id' | 'transactionDate' | 'total'): Field to sort by (case-sensitive, differs from the orders endpoint)
  - sortorder ('ascending' | 'descending'): Sort order (default: ascending)
  - fetch_all (boolean): Fetch all results by auto-paginating (max 10,000 results)
  - response_format ('markdown' | 'json'): Output format (default: markdown)

Returns:
  For JSON: { total, page, limit, count, has_more, total_pages, next_offset?, truncated?, offers: [...] }
  For Markdown: Formatted list with pagination info

Examples:
  - Offers not yet converted to orders: filter="ordernotcreated"
  - Last month's offers: period="last_month"
  - Top offers by amount: sortby="total", sortorder="descending"
  - Customer offers this year: customer_number="1001", period="this_year"

Error Handling:
  - Returns "Error: Rate limit exceeded..." if API limit hit
  - Returns truncation info if fetch_all hits safety limits`,
      inputSchema: ListOffersSchema,
      outputSchema: ListOffersOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: ListOffersInput) => {
      try {
        // Build query params
        const queryParams: Record<string, string | number | boolean | undefined> = {};

        if (params.filter) queryParams.filter = params.filter;
        if (params.customer_number) queryParams.customernumber = params.customer_number;

        // Handle period convenience filter
        if (params.period) {
          const dateRange = periodToDateRange(params.period);
          queryParams.fromdate = dateRange.from_date;
          queryParams.todate = dateRange.to_date;
        } else {
          if (params.from_date) queryParams.fromdate = params.from_date;
          if (params.to_date) queryParams.todate = params.to_date;
        }

        if (params.sortby) queryParams.sortby = params.sortby;
        if (params.sortorder) queryParams.sortorder = params.sortorder;

        let offers: FortnoxOfferListItem[];
        let total: number;
        let totalIsExact = true;
        let pagesFetched = 1;
        let truncated = false;
        let truncationReason: string | undefined;

        if (params.fetch_all) {
          const result = await fetchAllPages<FortnoxOfferListItem, OfferListResponse>(
            "/3/offers",
            queryParams,
            (r) => r.Offers || [],
            (r) => r.MetaInformation?.["@TotalResources"] || 0
          );
          offers = result.items;
          total = result.total;
          totalIsExact = result.totalIsExact;
          pagesFetched = result.pagesFetched;
          truncated = result.truncated;
          truncationReason = result.truncationReason;
        } else {
          queryParams.limit = params.limit;
          queryParams.page = params.page;

          const response = await fortnoxRequest<OfferListResponse>("/3/offers", "GET", undefined, queryParams);
          offers = response.Offers || [];
          total = response.MetaInformation?.["@TotalResources"] || offers.length;
        }

        const paginationMeta = params.fetch_all
          ? {
              total,
              total_is_exact: totalIsExact,
              count: offers.length,
              fetched_all: true,
              pages_fetched: pagesFetched,
              truncated,
              truncation_reason: truncationReason
            }
          : {
              ...buildPaginationMeta(total, params.page, params.limit, offers.length),
              next_offset: params.page * params.limit < total ? params.page * params.limit : undefined
            };

        const output: ListOffersOutput = {
          ...paginationMeta,
          period_description: params.period ? getPeriodDescription(params.period) : undefined,
          offers: offers.map((offer) => ({
            document_number: offer.DocumentNumber,
            customer_number: offer.CustomerNumber,
            customer_name: offer.CustomerName || null,
            offer_date: offer.OfferDate || null,
            expire_date: offer.ExpireDate || null,
            total: offer.Total || 0,
            currency: offer.Currency || "SEK",
            status: getOfferStatus(offer),
            expired: isOfferExpired(offer),
            order_reference: offer.OrderReference || null
          }))
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          const title = params.period
            ? `Offers - ${getPeriodDescription(params.period)}`
            : "Offers";

          if (params.fetch_all) {
            const lines: string[] = [
              `# ${title}`,
              "",
              `Showing ${offers.length} of ${totalIsExact ? total : `at least ${total}`} total offers`,
              `(${pagesFetched} pages fetched)`
            ];

            if (truncated) {
              lines.push("");
              lines.push(`**Results truncated**: ${truncationReason}`);
            }

            lines.push("");

            for (const offer of offers) {
              const status = getOfferStatus(offer);
              const expired = isOfferExpired(offer);
              lines.push(`## Offer #${offer.DocumentNumber}`);
              lines.push(`- **Customer**: ${offer.CustomerName || offer.CustomerNumber}`);
              lines.push(`- **Date**: ${formatDisplayDate(offer.OfferDate)} | **Expires**: ${formatDisplayDate(offer.ExpireDate)}${expired ? " (EXPIRED)" : ""}`);
              lines.push(`- **Total**: ${formatMoney(offer.Total, offer.Currency)}`);
              lines.push(`- **Status**: ${status.toUpperCase()}${offer.OrderReference ? ` (Order: ${offer.OrderReference})` : ""}`);
              lines.push("");
            }

            textContent = lines.join("\n");
          } else {
            textContent = formatListMarkdown(
              title,
              offers,
              total,
              params.page,
              params.limit,
              (offer) => {
                const status = getOfferStatus(offer);
                const expired = isOfferExpired(offer);
                return `## Offer #${offer.DocumentNumber}\n` +
                  `- **Customer**: ${offer.CustomerName || offer.CustomerNumber}\n` +
                  `- **Date**: ${formatDisplayDate(offer.OfferDate)} | **Expires**: ${formatDisplayDate(offer.ExpireDate)}${expired ? " (EXPIRED)" : ""}\n` +
                  `- **Total**: ${formatMoney(offer.Total, offer.Currency)}\n` +
                  `- **Status**: ${status.toUpperCase()}${offer.OrderReference ? ` (Order: ${offer.OrderReference})` : ""}`;
              }
            );
          }
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );
}
