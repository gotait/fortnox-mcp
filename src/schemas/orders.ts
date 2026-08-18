import { z } from "zod";
import { listMetaFields } from "./common.js";
import { ResponseFormat, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import { DatePeriodEnum } from "./invoices.js";

/**
 * Order filter enum for Fortnox orders API
 */
export const OrderFilterEnum = z.enum([
  "cancelled",
  "expired",
  "invoicecreated",
  "invoicenotcreated"
]);

export type OrderFilter = z.infer<typeof OrderFilterEnum>;

/**
 * Offer filter enum for Fortnox offers API
 */
export const OfferFilterEnum = z.enum([
  "cancelled",
  "expired",
  "completed",
  "notcompleted",
  "ordercreated",
  "ordernotcreated"
]);

export type OfferFilter = z.infer<typeof OfferFilterEnum>;

/**
 * Schema for listing orders
 */
export const ListOrdersSchema = z.object({
  limit: z.number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe("Maximum number of results to return (1-100)"),
  page: z.number()
    .int()
    .min(1)
    .default(1)
    .describe("Page number for pagination"),
  filter: OrderFilterEnum
    .optional()
    .describe("Filter orders by status: 'cancelled' (order was cancelled), 'expired' (order has expired), 'invoicecreated' (an invoice was created from the order), 'invoicenotcreated' (no invoice has been created from the order)"),
  customer_number: z.string()
    .max(50)
    .optional()
    .describe("Filter by customer number"),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter orders from this date (YYYY-MM-DD)"),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter orders to this date (YYYY-MM-DD)"),
  period: DatePeriodEnum
    .optional()
    .describe("Convenience date period filter (e.g., 'last_month', 'this_quarter'). Overrides from_date/to_date if provided."),
  sortby: z.enum(["customername", "customernumber", "documentnumber", "orderdate", "total"])
    .optional()
    .describe("Field to sort results by"),
  sortorder: z.enum(["ascending", "descending"])
    .default("ascending")
    .describe("Sort order for results"),
  fetch_all: z.boolean()
    .default(false)
    .describe("Fetch all results by auto-paginating through all pages. WARNING: May take time for large datasets (max 10,000 results)."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type ListOrdersInput = z.infer<typeof ListOrdersSchema>;

/**
 * Schema for getting a single order
 */
export const GetOrderSchema = z.object({
  document_number: z.string()
    .min(1)
    .describe("The order document number to retrieve"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type GetOrderInput = z.infer<typeof GetOrderSchema>;

/**
 * Schema for listing offers
 */
export const ListOffersSchema = z.object({
  limit: z.number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe("Maximum number of results to return (1-100)"),
  page: z.number()
    .int()
    .min(1)
    .default(1)
    .describe("Page number for pagination"),
  filter: OfferFilterEnum
    .optional()
    .describe("Filter offers by status: 'cancelled' (offer was cancelled), 'expired' (offer has expired), 'completed' (offer is completed), 'notcompleted' (offer is not completed), 'ordercreated' (an order was created from the offer), 'ordernotcreated' (no order has been created from the offer)"),
  customer_number: z.string()
    .max(50)
    .optional()
    .describe("Filter by customer number"),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter offers from this date (YYYY-MM-DD)"),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter offers to this date (YYYY-MM-DD)"),
  period: DatePeriodEnum
    .optional()
    .describe("Convenience date period filter (e.g., 'last_month', 'this_quarter'). Overrides from_date/to_date if provided."),
  sortby: z.enum(["customerName", "id", "transactionDate", "total"])
    .optional()
    .describe("Field to sort results by. Values are case-sensitive and differ from the orders endpoint: 'customerName', 'id', 'transactionDate', 'total'"),
  sortorder: z.enum(["ascending", "descending"])
    .default("ascending")
    .describe("Sort order for results"),
  fetch_all: z.boolean()
    .default(false)
    .describe("Fetch all results by auto-paginating through all pages. WARNING: May take time for large datasets (max 10,000 results)."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type ListOffersInput = z.infer<typeof ListOffersSchema>;

/**
 * Schema for getting a single offer
 */
export const GetOfferSchema = z.object({
  document_number: z.string()
    .min(1)
    .describe("The offer document number to retrieve"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type GetOfferInput = z.infer<typeof GetOfferSchema>;

/* ---- output schemas (see src/schemas/common.ts for the rules) ---- */

export const ListOrdersOutputSchema = z.object({
  ...listMetaFields,
  period_description: z.string().optional(),
  orders: z.array(z.object({
    document_number: z.string(),
    customer_number: z.string(),
    customer_name: z.string().nullable(),
    order_date: z.string().nullable(),
    delivery_date: z.string().nullable(),
    total: z.number(),
    currency: z.string(),
    status: z.string(),
    invoice_reference: z.string().nullable()
  }))
});

export const ListOffersOutputSchema = z.object({
  ...listMetaFields,
  period_description: z.string().optional(),
  offers: z.array(z.object({
    document_number: z.string(),
    customer_number: z.string(),
    customer_name: z.string().nullable(),
    offer_date: z.string().nullable(),
    expire_date: z.string().nullable(),
    total: z.number(),
    currency: z.string(),
    status: z.string(),
    expired: z.boolean(),
    order_reference: z.string().nullable()
  }))
});

export type ListOrdersOutput = z.infer<typeof ListOrdersOutputSchema>;
export type ListOffersOutput = z.infer<typeof ListOffersOutputSchema>;
