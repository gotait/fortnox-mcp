import { z } from "zod";
import { listMetaFields, truncationFields, writeResultFields } from "./common.js";
import { ResponseFormat, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import { DatePeriodEnum } from "./invoices.js";

/**
 * Schema for listing supplier invoices
 */
export const ListSupplierInvoicesSchema = z.object({
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
  filter: z.enum([
    "cancelled",
    "fullypaid",
    "unpaid",
    "unpaidoverdue",
    "unbooked",
    "pendingpayment",
    "authorizepending"
  ])
    .optional()
    .describe("Filter supplier invoices by status (the only server-side filter this endpoint supports)"),
  supplier_number: z.string()
    .max(50)
    .optional()
    .describe("Filter by supplier number (client-side filter, applied after fetching)"),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter by invoice date from this date (YYYY-MM-DD, client-side filter, applied after fetching)"),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter by invoice date to this date (YYYY-MM-DD, client-side filter, applied after fetching)"),
  period: DatePeriodEnum
    .optional()
    .describe("Convenience date period filter (e.g., 'last_month', 'this_quarter'). Overrides from_date/to_date if provided."),
  from_final_pay_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter by final pay date from (YYYY-MM-DD, client-side filter, applied after fetching)"),
  to_final_pay_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter by final pay date to (YYYY-MM-DD, client-side filter, applied after fetching)"),
  sortby: z.enum(["suppliername", "suppliernumber", "invoicenumber", "invoicedate", "total"])
    .optional()
    .describe("Field to sort results by (client-side sort, applied after fetching)"),
  sortorder: z.enum(["ascending", "descending"])
    .optional()
    .describe("Sort order for results, used with sortby (default: ascending)"),
  fetch_all: z.boolean()
    .default(false)
    .describe("Fetch all results by auto-paginating through all pages. WARNING: May take time for large datasets (max 10,000 results)."),
  min_amount: z.number()
    .min(0)
    .optional()
    .describe("Filter invoices with total >= this amount (client-side filter)"),
  max_amount: z.number()
    .min(0)
    .optional()
    .describe("Filter invoices with total <= this amount (client-side filter)"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type ListSupplierInvoicesInput = z.infer<typeof ListSupplierInvoicesSchema>;

/**
 * Schema for getting a single supplier invoice
 */
export const GetSupplierInvoiceSchema = z.object({
  given_number: z.string()
    .min(1)
    .describe("The supplier invoice given number to retrieve"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type GetSupplierInvoiceInput = z.infer<typeof GetSupplierInvoiceSchema>;

/**
 * Schema for approving a supplier invoice
 */
export const ApproveSupplierInvoiceSchema = z.object({
  given_number: z.string()
    .min(1)
    .describe("The supplier invoice given number to approve"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type ApproveSupplierInvoiceInput = z.infer<typeof ApproveSupplierInvoiceSchema>;

/**
 * Schema for payables aging report
 */
export const PayablesReportSchema = z.object({
  min_amount: z.number()
    .min(0)
    .optional()
    .describe("Only include invoices with outstanding balance >= this amount"),
  supplier_number: z.string()
    .max(50)
    .optional()
    .describe("Filter by specific supplier number (client-side filter, applied after fetching)"),
  group_by: z.enum(["supplier", "age_bucket", "both"])
    .default("both")
    .describe("How to group unpaid supplier invoices in the report"),
  include_details: z.boolean()
    .default(true)
    .describe("Include list of individual unpaid invoices"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type PayablesReportInput = z.infer<typeof PayablesReportSchema>;

/* ---- output schemas (see src/schemas/common.ts for the rules) ---- */

export const ListSupplierInvoicesOutputSchema = z.object({
  ...listMetaFields,
  period_description: z.string().optional(),
  invoices: z.array(z.object({
    given_number: z.string(),
    supplier_number: z.string(),
    supplier_name: z.string().nullable(),
    invoice_number: z.string().nullable(),
    invoice_date: z.string().nullable(),
    due_date: z.string().nullable(),
    total: z.number(),
    balance: z.number(),
    currency: z.string(),
    booked: z.boolean(),
    cancelled: z.boolean(),
    status: z.string()
  }))
});

export const GetSupplierInvoiceOutputSchema = z.object({
  given_number: z.string(),
  supplier_number: z.string(),
  supplier_name: z.string().nullable(),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable(),
  due_date: z.string().nullable(),
  total: z.number(),
  balance: z.number(),
  currency: z.string(),
  ocr: z.string().nullable(),
  booked: z.boolean(),
  cancelled: z.boolean(),
  credit: z.boolean(),
  payment_pending: z.boolean(),
  comments: z.string().nullable(),
  rows: z.array(z.object({
    article_number: z.string().nullable(),
    account: z.number().nullable(),
    account_description: z.string().nullable(),
    debit: z.number(),
    credit: z.number(),
    total: z.number(),
    project: z.string().nullable(),
    cost_center: z.string().nullable()
  }))
});

export const ApproveSupplierInvoiceOutputSchema = z.object({
  ...writeResultFields,
  given_number: z.string(),
  supplier_name: z.string().nullable(),
  total: z.number(),
  payment_pending: z.boolean()
});

/**
 * The handler builds this one mutably as a Record, adding groupings that depend
 * on `group_by` and `include_details` — so tsc cannot check it against the
 * schema the way it does for the others. The three conditional keys are declared
 * optional and were read off the handler directly.
 */
export const PayablesReportOutputSchema = z.object({
  summary: z.object({
    total_invoices: z.number(),
    total_invoice_amount: z.number(),
    total_payable_balance: z.number(),
    unique_suppliers: z.number()
  }),
  ...truncationFields,
  by_age_bucket: z.array(z.object({
    bucket: z.string(),
    count: z.number(),
    total_balance: z.number()
  })).optional().describe("Present when group_by is 'age_bucket' or 'both'"),
  by_supplier: z.array(z.object({
    supplier: z.string(),
    count: z.number(),
    total_balance: z.number()
  })).optional().describe("Present when group_by is 'supplier' or 'both'"),
  invoices: z.array(z.object({
    given_number: z.string(),
    supplier_number: z.string(),
    supplier_name: z.string().nullable(),
    invoice_number: z.string().nullable(),
    invoice_date: z.string().nullable(),
    due_date: z.string().nullable(),
    total: z.number(),
    balance: z.number(),
    age_bucket: z.string()
  })).optional().describe("Present when include_details is true")
});

export type ListSupplierInvoicesOutput = z.infer<typeof ListSupplierInvoicesOutputSchema>;
export type GetSupplierInvoiceOutput = z.infer<typeof GetSupplierInvoiceOutputSchema>;
export type ApproveSupplierInvoiceOutput = z.infer<typeof ApproveSupplierInvoiceOutputSchema>;
export type PayablesReportOutput = z.infer<typeof PayablesReportOutputSchema>;
