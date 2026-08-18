import { z } from "zod";
import { periodFields, truncationFields } from "./common.js";
import { ResponseFormat } from "../constants.js";
import { DatePeriodEnum } from "./invoices.js";

/**
 * Group by enum for time-based grouping
 */
export const TimeGroupByEnum = z.enum(["week", "month", "quarter"]);
export type TimeGroupBy = z.infer<typeof TimeGroupByEnum>;

/**
 * Schema for Cash Flow Forecast tool
 */
export const CashFlowForecastSchema = z.object({
  horizon_days: z.number()
    .int()
    .min(1)
    .max(365)
    .default(90)
    .describe("Number of days to forecast ahead (1-365, default: 90)"),
  group_by: z.enum(["week", "month"])
    .default("week")
    .describe("How to group the forecast: 'week' or 'month'"),
  include_overdue: z.boolean()
    .default(true)
    .describe("Include overdue receivables and payables in the forecast"),
  starting_balance: z.number()
    .optional()
    .describe("Optional starting cash balance to use for projection"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type CashFlowForecastInput = z.infer<typeof CashFlowForecastSchema>;

/**
 * Schema for Order Pipeline tool
 */
export const OrderPipelineSchema = z.object({
  period: DatePeriodEnum
    .optional()
    .describe("Date period to analyze (e.g., 'this_month', 'this_year')"),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Start date for analysis (YYYY-MM-DD). Ignored if period is specified."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("End date for analysis (YYYY-MM-DD). Ignored if period is specified."),
  group_by: z.enum(["customer", "month", "status"])
    .default("status")
    .describe("How to group order pipeline statistics"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type OrderPipelineInput = z.infer<typeof OrderPipelineSchema>;

/**
 * Schema for Sales Funnel tool
 */
export const SalesFunnelSchema = z.object({
  period: DatePeriodEnum
    .optional()
    .describe("Date period to analyze (e.g., 'this_quarter', 'this_year')"),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Start date for analysis (YYYY-MM-DD). Ignored if period is specified."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("End date for analysis (YYYY-MM-DD). Ignored if period is specified."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type SalesFunnelInput = z.infer<typeof SalesFunnelSchema>;

/**
 * Schema for Product Performance tool
 */
export const ProductPerformanceSchema = z.object({
  period: DatePeriodEnum
    .optional()
    .describe("Date period to analyze (e.g., 'this_year', 'last_quarter')"),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Start date for analysis (YYYY-MM-DD). Ignored if period is specified."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("End date for analysis (YYYY-MM-DD). Ignored if period is specified."),
  metric: z.enum(["revenue", "invoice_count"])
    .default("revenue")
    .describe("Metric to rank customers by: 'revenue' or 'invoice_count'. Quantity is not available (invoice list items carry no row/article data)."),
  top_n: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Number of top customers to return (1-100, default: 20)"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type ProductPerformanceInput = z.infer<typeof ProductPerformanceSchema>;

/**
 * Schema for Period Comparison tool
 */
export const PeriodComparisonSchema = z.object({
  current_period: DatePeriodEnum
    .describe("Current period to analyze (e.g., 'this_month', 'this_quarter')"),
  compare_to: DatePeriodEnum
    .optional()
    .describe("Period to compare against. If not specified, compares to the previous equivalent period."),
  metrics: z.array(z.enum(["revenue", "invoice_count", "average_invoice", "unique_customers"]))
    .default(["revenue", "invoice_count", "average_invoice"])
    .describe("Metrics to compare between periods. 'unique_customers' counts distinct customers invoiced in each period (not net-new customers)."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type PeriodComparisonInput = z.infer<typeof PeriodComparisonSchema>;

/**
 * Schema for Customer Growth tool
 */
export const CustomerGrowthSchema = z.object({
  current_period: DatePeriodEnum
    .describe("Current period to analyze (e.g., 'this_quarter', 'this_year')"),
  compare_to: DatePeriodEnum
    .optional()
    .describe("Period to compare against. If not specified, compares to the previous equivalent period."),
  min_revenue: z.number()
    .min(0)
    .optional()
    .describe("Only include customers with at least this much revenue in either period"),
  top_n: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Number of customers to return (1-100, default: 20)"),
  show: z.enum(["growing", "declining", "all"])
    .default("all")
    .describe("Filter to show only growing, declining, or all customers"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type CustomerGrowthInput = z.infer<typeof CustomerGrowthSchema>;

/**
 * Schema for Project Profitability tool
 */
export const ProjectProfitabilitySchema = z.object({
  project_number: z.string()
    .optional()
    .describe("Filter to a specific project number"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type ProjectProfitabilityInput = z.infer<typeof ProjectProfitabilitySchema>;

/**
 * Schema for Cost Center Analysis tool
 */
export const CostCenterAnalysisSchema = z.object({
  cost_center: z.string()
    .optional()
    .describe("Filter to a specific cost center code"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type CostCenterAnalysisInput = z.infer<typeof CostCenterAnalysisSchema>;

/**
 * Schema for Expense Analysis tool
 */
export const ExpenseAnalysisSchema = z.object({
  period: DatePeriodEnum
    .optional()
    .describe("Date period. Echoed in the output; no expense data is fetched."),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Start date (YYYY-MM-DD). Ignored if period is specified. Echoed in the output; no expense data is fetched."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("End date (YYYY-MM-DD). Ignored if period is specified. Echoed in the output; no expense data is fetched."),
  account_range_from: z.number()
    .int()
    .default(4000)
    .describe("Start of expense account range (default: 4000). Only filters which account classes appear in the structure."),
  account_range_to: z.number()
    .int()
    .default(8999)
    .describe("End of expense account range (default: 8999). Only filters which account classes appear in the structure."),
  group_by: z.enum(["account", "account_class"])
    .default("account_class")
    .describe("Group expenses by individual account or account class (e.g., 4xxx, 5xxx). Echoed in the output; no expense data is fetched."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type ExpenseAnalysisInput = z.infer<typeof ExpenseAnalysisSchema>;

/**
 * Schema for Yearly Comparison tool
 */
export const YearlyComparisonSchema = z.object({
  years: z.number()
    .int()
    .min(2)
    .max(5)
    .default(3)
    .describe("Number of years to compare (2-5, default: 3)"),
  metrics: z.array(z.enum(["revenue", "invoice_count", "average_invoice", "customer_count"]))
    .default(["revenue", "invoice_count"])
    .describe("Metrics to compare across years"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type YearlyComparisonInput = z.infer<typeof YearlyComparisonSchema>;

/**
 * Schema for Gross Margin Trend tool
 */
export const GrossMarginTrendSchema = z.object({
  period: DatePeriodEnum
    .optional()
    .describe("Date period (e.g., 'this_year', 'last_year'). Echoed in the output; no margin data is fetched."),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Start date (YYYY-MM-DD). Ignored if period is specified. Echoed in the output; no margin data is fetched."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("End date (YYYY-MM-DD). Ignored if period is specified. Echoed in the output; no margin data is fetched."),
  group_by: z.enum(["month", "quarter"])
    .default("month")
    .describe("How the margin trend would be grouped. Echoed in the output; not yet applied."),
  revenue_accounts: z.string()
    .optional()
    .describe("Revenue account range (e.g., '3000-3999'). Default: 3000-3999. Echoed in the output; not yet applied."),
  cogs_accounts: z.string()
    .optional()
    .describe("Cost of goods sold account range (e.g., '4000-4999'). Default: 4000-4999. Echoed in the output; not yet applied."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type GrossMarginTrendInput = z.infer<typeof GrossMarginTrendSchema>;

/* ---- output schemas (see src/schemas/common.ts for the rules) ----
 *
 * Sub-objects assembled by the aggregation helpers (period buckets, group
 * statistics, per-year rows) are declared z.unknown() rather than guessed at.
 * That keeps the advertised contract truthful — the top-level keys are the part
 * we actually guarantee — and it lets tsc still check the key set of every
 * literal, which is what catches a handler and its schema drifting apart.
 */

/** Assembled by an aggregation helper; shape intentionally not asserted. */
const helperBuilt = () => z.unknown();

export const CashFlowForecastOutputSchema = z.object({
  forecast: z.object({
    horizon_days: z.number(),
    group_by: z.string(),
    from_date: z.string(),
    to_date: z.string(),
    include_overdue: z.boolean(),
    starting_balance: z.number()
  }),
  summary: z.object({
    total_receivables: z.number(),
    total_payables: z.number(),
    net_position: z.number(),
    receivables_count: z.number(),
    payables_count: z.number(),
    ending_balance: z.number()
  }),
  periods: helperBuilt(),
  ...truncationFields,
  warning: z.string().optional().describe("Set when supplier invoices were unavailable")
});

export const OrderPipelineOutputSchema = z.object({
  ...periodFields,
  group_by: z.string(),
  summary: z.object({
    total_orders: z.number(),
    total_value: z.number(),
    pending_orders: z.number(),
    pending_value: z.number(),
    invoiced_orders: z.number(),
    invoiced_value: z.number(),
    cancelled_orders: z.number(),
    unique_customers: z.number()
  }),
  groups: helperBuilt(),
  ...truncationFields
});

export const SalesFunnelOutputSchema = z.object({
  ...periodFields,
  funnel: z.object({
    offers: z.object({ count: z.number(), value: z.number(), converted: z.number(), open: z.number() }),
    orders: z.object({ count: z.number(), value: z.number(), converted: z.number(), open: z.number() }),
    invoices: z.object({ count: z.number(), value: z.number() })
  }),
  conversion_rates: z.object({
    offer_to_order: z.number(),
    order_to_invoice: z.number(),
    overall: z.number().describe("Product of the two stage rates")
  }),
  truncated: z.boolean()
});

export const ProductPerformanceOutputSchema = z.object({
  ...periodFields,
  metric: z.string(),
  summary: z.object({
    total_revenue: z.number(),
    total_invoices: z.number(),
    unique_customers: z.number()
  }),
  top_performers: z.array(z.object({
    rank: z.number(),
    identifier: z.string(),
    name: z.string(),
    revenue: z.number(),
    invoice_count: z.number()
  })),
  note: z.string(),
  truncated: z.boolean()
});

export const PeriodComparisonOutputSchema = z.object({
  current_period: z.object({
    // the derived previous period has no name when the current one was a
    // custom date range, so both sides are nullable
    period: z.string().nullable(),
    description: z.string(),
    date_range: helperBuilt(),
    metrics: helperBuilt()
  }),
  previous_period: z.object({
    period: z.string().nullable(),
    description: z.string(),
    date_range: helperBuilt(),
    metrics: helperBuilt()
  }),
  comparison: helperBuilt(),
  truncated: z.boolean()
});

export const CustomerGrowthOutputSchema = z.object({
  current_period: helperBuilt(),
  previous_period: helperBuilt(),
  filter: z.string(),
  summary: z.object({
    total_customers_analyzed: z.number(),
    growing_customers: z.number(),
    declining_customers: z.number(),
    flat_customers: z.number()
  }),
  customers: helperBuilt(),
  truncated: z.boolean()
});

/** Two shapes: a not-found early return, and the full report. */
export const ProjectProfitabilityOutputSchema = z.object({
  message: z.string().optional().describe("Set when no matching project was found"),
  note: z.string().optional(),
  projects: helperBuilt(),
  truncated: z.boolean().optional()
});

export const CostCenterAnalysisOutputSchema = z.object({
  note: z.string(),
  cost_centers: helperBuilt(),
  truncated: z.boolean()
});

export const ExpenseAnalysisOutputSchema = z.object({
  ...periodFields,
  account_range: z.object({ from: z.number(), to: z.number() }),
  group_by: z.string(),
  note: z.string(),
  expense_classes: helperBuilt()
});

export const YearlyComparisonOutputSchema = z.object({
  years_compared: helperBuilt(),
  metrics: helperBuilt(),
  note: z.string().nullish(),
  years: helperBuilt(),
  truncated: z.boolean()
});

export const GrossMarginTrendOutputSchema = z.object({
  ...periodFields,
  group_by: z.string(),
  account_ranges: z.object({ revenue: helperBuilt(), cogs: helperBuilt() }),
  note: z.string(),
  periods: z.array(z.object({
    period: z.string(),
    revenue: z.number(),
    cogs: z.number(),
    gross_margin: z.number(),
    margin_percent: z.number()
  }))
});

export type CashFlowForecastOutput = z.infer<typeof CashFlowForecastOutputSchema>;
export type OrderPipelineOutput = z.infer<typeof OrderPipelineOutputSchema>;
export type SalesFunnelOutput = z.infer<typeof SalesFunnelOutputSchema>;
export type ProductPerformanceOutput = z.infer<typeof ProductPerformanceOutputSchema>;
export type PeriodComparisonOutput = z.infer<typeof PeriodComparisonOutputSchema>;
export type CustomerGrowthOutput = z.infer<typeof CustomerGrowthOutputSchema>;
export type ProjectProfitabilityOutput = z.infer<typeof ProjectProfitabilityOutputSchema>;
export type CostCenterAnalysisOutput = z.infer<typeof CostCenterAnalysisOutputSchema>;
export type ExpenseAnalysisOutput = z.infer<typeof ExpenseAnalysisOutputSchema>;
export type YearlyComparisonOutput = z.infer<typeof YearlyComparisonOutputSchema>;
export type GrossMarginTrendOutput = z.infer<typeof GrossMarginTrendOutputSchema>;
