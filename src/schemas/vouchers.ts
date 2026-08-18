import { z } from "zod";
import { paginationMetaFields, truncationFields, writeResultFields } from "./common.js";
import { ResponseFormat, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import { DatePeriodEnum } from "./invoices.js";

/**
 * Voucher row schema for creating vouchers
 */
export const VoucherRowSchema = z.object({
  account_number: z.number()
    .int()
    .min(1000)
    .max(9999)
    .describe("Account number (1000-9999, required)"),
  debit: z.number()
    .min(0)
    .optional()
    .describe("Debit amount (use either debit or credit, not both)"),
  credit: z.number()
    .min(0)
    .optional()
    .describe("Credit amount (use either debit or credit, not both)"),
  description: z.string()
    .max(200)
    .optional()
    .describe("Description for this row"),
  cost_center: z.string()
    .max(20)
    .optional()
    .describe("Cost center code"),
  project: z.string()
    .max(20)
    .optional()
    .describe("Project code")
}).strict().refine(
  (data) => (data.debit !== undefined && data.debit > 0) || (data.credit !== undefined && data.credit > 0),
  { message: "Each row must have either a debit or credit amount greater than 0" }
);

export type VoucherRowInput = z.infer<typeof VoucherRowSchema>;

/**
 * Schema for listing vouchers
 */
export const ListVouchersSchema = z.object({
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
  voucher_series: z.string()
    .max(2)
    .optional()
    .describe("Filter by voucher series (e.g., 'A', 'B')"),
  financial_year: z.number()
    .int()
    .optional()
    .describe("Fortnox financial year ID (1, 2, 3...). NOT calendar year. Use fortnox_list_financial_years to find the correct ID."),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter vouchers from this date (YYYY-MM-DD). Applied client-side; the Fortnox API does not support date filtering on vouchers."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter vouchers to this date (YYYY-MM-DD). Applied client-side; the Fortnox API does not support date filtering on vouchers."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type ListVouchersInput = z.infer<typeof ListVouchersSchema>;

/**
 * Schema for getting a single voucher
 */
export const GetVoucherSchema = z.object({
  voucher_series: z.string()
    .min(1)
    .max(2)
    .describe("Voucher series (e.g., 'A')"),
  voucher_number: z.number()
    .int()
    .min(1)
    .describe("Voucher number within the series"),
  financial_year: z.number()
    .int()
    .optional()
    .describe("Fortnox financial year ID (1, 2, 3...). NOT calendar year. Use fortnox_list_financial_years to find the correct ID."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type GetVoucherInput = z.infer<typeof GetVoucherSchema>;

/**
 * Schema for creating a voucher
 */
export const CreateVoucherSchema = z.object({
  voucher_series: z.string()
    .min(1)
    .max(2)
    .describe("Voucher series (e.g., 'A', 'B') (required)"),
  description: z.string()
    .min(1)
    .max(200)
    .describe("Voucher description (required)"),
  transaction_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .describe("Transaction date (YYYY-MM-DD, required)"),
  rows: z.array(VoucherRowSchema)
    .min(2)
    .describe("Voucher rows (minimum 2 rows required, debit must equal credit)"),
  cost_center: z.string()
    .max(20)
    .optional()
    .describe("Default cost center for all rows"),
  project: z.string()
    .max(20)
    .optional()
    .describe("Default project for all rows"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type CreateVoucherInput = z.infer<typeof CreateVoucherSchema>;

/**
 * Schema for listing voucher series
 */
export const ListVoucherSeriesSchema = z.object({
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type ListVoucherSeriesInput = z.infer<typeof ListVoucherSeriesSchema>;

/**
 * Schema for account activity tool - filter vouchers by account number
 */
export const AccountActivitySchema = z.object({
  account_number: z.number()
    .int()
    .min(1000)
    .max(9999)
    .optional()
    .describe("Single account number to filter by (1000-9999)"),
  account_numbers: z.array(z.number().int().min(1000).max(9999))
    .max(20)
    .optional()
    .describe("Multiple account numbers to filter by (max 20)"),
  account_range: z.object({
    from: z.number().int().min(1000).max(9999),
    to: z.number().int().min(1000).max(9999)
  })
    .strict()
    .optional()
    .describe("Account number range (e.g., 3000-3999 for revenue accounts)"),
  financial_year: z.number()
    .int()
    .optional()
    .describe("Fortnox financial year ID (1, 2, 3...). NOT calendar year. Use fortnox_list_financial_years to find the correct ID."),
  period: DatePeriodEnum
    .optional()
    .describe("Convenience date period filter (e.g., 'this_month', 'last_quarter'). Overrides from_date/to_date."),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter vouchers from this date (YYYY-MM-DD). Applied client-side; the Fortnox API does not support date filtering on vouchers."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter vouchers to this date (YYYY-MM-DD). Applied client-side; the Fortnox API does not support date filtering on vouchers."),
  voucher_series: z.string()
    .max(2)
    .optional()
    .describe("Filter by voucher series (e.g., 'A', 'B')"),
  include_summary: z.boolean()
    .default(true)
    .describe("Include totals and summary per account"),
  max_vouchers: z.number()
    .int()
    .min(10)
    .max(500)
    .default(500)
    .describe("Maximum vouchers to scan (10-500). Use date filtering for larger datasets."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type AccountActivityInput = z.infer<typeof AccountActivitySchema>;

/**
 * "At least one account filter" is enforced by the tool rather than by a
 * `.refine()` on the schema above.
 *
 * A trailing `.refine()` turns a ZodObject into a ZodEffects, and the MCP SDK
 * can only read a field shape off the former: with the refine in place, this
 * tool published `{"type":"object","properties":{}}` and every parameter was
 * invisible to clients. Nested refinements are fine - only the top-level schema
 * of a tool has to stay an object.
 */
export const ACCOUNT_FILTER_REQUIRED_MESSAGE =
  "Must specify at least one of: account_number, account_numbers, or account_range";

export function hasAccountFilter(input: AccountActivityInput): boolean {
  return (
    input.account_number !== undefined ||
    input.account_numbers !== undefined ||
    input.account_range !== undefined
  );
}

/**
 * Schema for voucher text search tool
 */
export const SearchVouchersSchema = z.object({
  search_text: z.string()
    .min(2)
    .max(100)
    .describe("Text to search for in voucher descriptions (min 2 chars)"),
  financial_year: z.number()
    .int()
    .optional()
    .describe("Fortnox financial year ID (1, 2, 3...). NOT calendar year. Use fortnox_list_financial_years to find the correct ID."),
  period: DatePeriodEnum
    .optional()
    .describe("Convenience date period filter (e.g., 'this_month', 'last_quarter'). Overrides from_date/to_date."),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter vouchers from this date (YYYY-MM-DD). Applied client-side; the Fortnox API does not support date filtering on vouchers."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter vouchers to this date (YYYY-MM-DD). Applied client-side; the Fortnox API does not support date filtering on vouchers."),
  voucher_series: z.string()
    .max(2)
    .optional()
    .describe("Filter by voucher series (e.g., 'A', 'B')"),
  case_sensitive: z.boolean()
    .default(false)
    .describe("Whether search should be case-sensitive"),
  include_rows: z.boolean()
    .default(false)
    .describe("Also search row descriptions and include full voucher row details in results. Broadens the search: vouchers whose row descriptions match are included even if the voucher description does not."),
  max_vouchers: z.number()
    .int()
    .min(10)
    .max(500)
    .default(500)
    .describe("Maximum vouchers to scan (10-500). Use date filtering for larger datasets."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type SearchVouchersInput = z.infer<typeof SearchVouchersSchema>;

/* ---- output schemas (see src/schemas/common.ts for the rules) ---- */

export const ListVouchersOutputSchema = z.object({
  ...paginationMetaFields,
  vouchers: z.array(z.object({
    voucher_series: z.string(),
    voucher_number: z.number(),
    description: z.string(),
    transaction_date: z.string()
  }))
});

export const GetVoucherOutputSchema = z.object({
  voucher_series: z.string(),
  voucher_number: z.number(),
  year: z.number(),
  description: z.string(),
  transaction_date: z.string(),
  rows: z.array(z.object({
    account_number: z.number(),
    debit: z.number(),
    credit: z.number(),
    description: z.string().nullable(),
    cost_center: z.string().nullable(),
    project: z.string().nullable()
  }))
});

export const CreateVoucherOutputSchema = z.object({
  ...writeResultFields,
  voucher_series: z.string(),
  voucher_number: z.number(),
  description: z.string(),
  transaction_date: z.string()
});

export const ListVoucherSeriesOutputSchema = z.object({
  count: z.number(),
  series: z.array(z.object({
    code: z.string(),
    description: z.string(),
    manual: z.boolean()
  }))
});

export const AccountActivityOutputSchema = z.object({
  filter: z.object({
    accounts: z.array(z.number()),
    account_range: z.object({ from: z.number(), to: z.number() }).nullable(),
    financial_year: z.number().optional(),
    date_range: z.string().nullable(),
    voucher_series: z.string().nullable()
  }),
  vouchers_scanned: z.number(),
  total_vouchers_available: z.number(),
  total_vouchers_available_is_exact: z.boolean(),
  ...truncationFields,
  matching_transactions: z.number(),
  /** Only built when include_summary is set. */
  summary: z.array(z.object({
    account: z.number(),
    total_debit: z.number(),
    total_credit: z.number(),
    net_change: z.number(),
    transaction_count: z.number()
  })).optional(),
  transactions: z.array(z.object({
    voucher_series: z.string(),
    voucher_number: z.number(),
    transaction_date: z.string(),
    voucher_description: z.string(),
    account: z.number(),
    description: z.string().nullable(),
    debit: z.number(),
    credit: z.number()
  }))
});

export const SearchVouchersOutputSchema = z.object({
  search_text: z.string(),
  case_sensitive: z.boolean(),
  financial_year: z.number().optional(),
  date_range: z.string().nullable(),
  voucher_series: z.string().nullable(),
  vouchers_scanned: z.number(),
  total_vouchers_available: z.number(),
  total_vouchers_available_is_exact: z.boolean(),
  ...truncationFields,
  matching_count: z.number(),
  vouchers: z.array(z.object({
    voucher_series: z.string(),
    voucher_number: z.number(),
    transaction_date: z.string(),
    description: z.string(),
    matched_in: z.enum(["description", "row"]),
    rows: z.array(z.object({
      account: z.number(),
      description: z.string().nullable(),
      debit: z.number(),
      credit: z.number()
    })).optional()
  }))
});

export type ListVouchersOutput = z.infer<typeof ListVouchersOutputSchema>;
export type GetVoucherOutput = z.infer<typeof GetVoucherOutputSchema>;
export type CreateVoucherOutput = z.infer<typeof CreateVoucherOutputSchema>;
export type ListVoucherSeriesOutput = z.infer<typeof ListVoucherSeriesOutputSchema>;
export type AccountActivityOutput = z.infer<typeof AccountActivityOutputSchema>;
export type SearchVouchersOutput = z.infer<typeof SearchVouchersOutputSchema>;
