import { z } from "zod";
import { periodFields, truncationFields } from "./common.js";
import { ResponseFormat } from "../constants.js";
import { DatePeriodEnum } from "./invoices.js";

/**
 * Schema for invoice summary analytics tool
 */
export const InvoiceSummarySchema = z.object({
  period: DatePeriodEnum
    .optional()
    .describe("Date period to analyze (e.g., 'this_month', 'last_quarter'). If not specified, analyzes all invoices."),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Start date for analysis (YYYY-MM-DD). Ignored if period is specified."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("End date for analysis (YYYY-MM-DD). Ignored if period is specified."),
  filter: z.enum([
    "cancelled",
    "fullypaid",
    "unpaid",
    "unpaidoverdue",
    "unbooked"
  ])
    .optional()
    .describe("Filter invoices by status before calculating summary"),
  customer_number: z.string()
    .max(50)
    .optional()
    .describe("Filter by specific customer number"),
  group_by: z.enum(["customer", "month", "status"])
    .optional()
    .describe("Group summary statistics by this dimension"),
  include_details: z.boolean()
    .default(false)
    .describe("Include list of individual invoices in the response"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type InvoiceSummaryInput = z.infer<typeof InvoiceSummarySchema>;

/**
 * Schema for top customers analytics tool
 */
export const TopCustomersSchema = z.object({
  metric: z.enum(["total_amount", "invoice_count", "unpaid_amount", "average_invoice"])
    .default("total_amount")
    .describe("Metric to rank customers by"),
  period: DatePeriodEnum
    .optional()
    .describe("Date period to analyze (e.g., 'this_year', 'last_month')"),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Start date for analysis (YYYY-MM-DD). Ignored if period is specified."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("End date for analysis (YYYY-MM-DD). Ignored if period is specified."),
  top_n: z.number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Number of top customers to return (1-50)"),
  include_details: z.boolean()
    .default(false)
    .describe("Include invoice breakdown for each customer"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type TopCustomersInput = z.infer<typeof TopCustomersSchema>;

/**
 * Schema for unpaid invoices report tool
 */
export const UnpaidReportSchema = z.object({
  min_amount: z.number()
    .min(0)
    .optional()
    .describe("Only include invoices with balance >= this amount"),
  customer_number: z.string()
    .max(50)
    .optional()
    .describe("Filter by specific customer number"),
  group_by: z.enum(["customer", "age_bucket", "both"])
    .default("both")
    .describe("How to group unpaid invoices in the report"),
  include_details: z.boolean()
    .default(true)
    .describe("Include list of individual unpaid invoices"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type UnpaidReportInput = z.infer<typeof UnpaidReportSchema>;

/* ---- output schemas (see src/schemas/common.ts for the rules) ---- */

/** calculateStats() in src/tools/analytics.ts */
const InvoiceStatsSchema = z.object({
  count: z.number(),
  total: z.number(),
  average: z.number(),
  min: z.number(),
  max: z.number(),
  paid_count: z.number(),
  unpaid_count: z.number(),
  draft_count: z.number(),
  cancelled_count: z.number(),
  total_balance: z.number()
});

const AgeGroupSchema = z.object({
  bucket: z.string(),
  count: z.number(),
  total_balance: z.number()
});

export const InvoiceSummaryOutputSchema = z.object({
  ...periodFields,
  api_total: z.number(),
  api_total_is_exact: z.boolean(),
  fetched: z.number(),
  ...truncationFields,
  summary: InvoiceStatsSchema,
  groups: z.array(z.object({ key: z.string(), stats: InvoiceStatsSchema }))
    .optional().describe("Present when group_by is set"),
  invoices: z.array(z.object({
    document_number: z.string().nullable(),
    customer_number: z.string().nullable(),
    customer_name: z.string().nullable(),
    invoice_date: z.string().nullable(),
    total: z.number(),
    balance: z.number(),
    status: z.string()
  })).optional().describe("Present when include_details is true")
});

export const TopCustomersOutputSchema = z.object({
  metric: z.string(),
  ...periodFields,
  total_invoices_analyzed: z.number(),
  unique_customers: z.number(),
  ...truncationFields,
  customers: z.array(z.object({
    rank: z.number(),
    // Locally computed group key with an "unknown" fallback — always present.
    customer_number: z.string(),
    customer_name: z.string(),
    total_amount: z.number(),
    invoice_count: z.number(),
    unpaid_amount: z.number(),
    average_invoice: z.number(),
    invoices: z.array(z.object({
      document_number: z.string().nullable(),
      // read straight off the payload here, unlike the top-level list which
      // applies a `|| null` fallback
      invoice_date: z.string().nullish(),
      total: z.number(),
      balance: z.number()
    })).optional().describe("Present when include_details is true")
  }))
});

export const UnpaidReportOutputSchema = z.object({
  summary: z.object({
    total_invoices: z.number(),
    total_invoice_amount: z.number(),
    total_unpaid_balance: z.number(),
    unique_customers: z.number()
  }),
  ...truncationFields,
  by_age_bucket: z.array(AgeGroupSchema)
    .optional().describe("Present when group_by is 'age_bucket' or 'both'"),
  by_customer: z.array(z.object({
    customer: z.string(),
    count: z.number(),
    total_balance: z.number()
  })).optional().describe("Present when group_by is 'customer' or 'both'"),
  invoices: z.array(z.object({
    document_number: z.string().nullable(),
    customer_number: z.string().nullable(),
    customer_name: z.string().nullable(),
    invoice_date: z.string().nullable(),
    due_date: z.string().nullable(),
    total: z.number(),
    balance: z.number(),
    age_bucket: z.string()
  })).optional().describe("Present when include_details is true")
});

export type InvoiceSummaryOutput = z.infer<typeof InvoiceSummaryOutputSchema>;
export type TopCustomersOutput = z.infer<typeof TopCustomersOutputSchema>;
export type UnpaidReportOutput = z.infer<typeof UnpaidReportOutputSchema>;
