import { z } from "zod";
import { ResponseFormat, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";

/**
 * Common pagination schema for list endpoints
 */
export const PaginationSchema = z.object({
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
    .describe("Page number for pagination (starts at 1)"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' for human-readable or 'json' for structured data")
}).strict();

export type PaginationInput = z.infer<typeof PaginationSchema>;

/**
 * Common response format schema
 */
export const ResponseFormatSchema = z.object({
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' for human-readable or 'json' for structured data")
}).strict();

export type ResponseFormatInput = z.infer<typeof ResponseFormatSchema>;

/**
 * Date range filter schema
 */
export const DateRangeSchema = z.object({
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter from date (YYYY-MM-DD)"),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter to date (YYYY-MM-DD)")
}).strict();

export type DateRangeInput = z.infer<typeof DateRangeSchema>;

/* -------------------------------------------------------------------------- *
 * Output schemas
 *
 * Declared so `tools/list` advertises the shape of `structuredContent`, which
 * every tool already returns through buildToolResponse(). Without an
 * outputSchema the SDK skips validation entirely (validateToolOutput returns
 * early) and clients have to fall back to parsing the markdown.
 *
 * Three rules keep these from turning working tools into runtime failures —
 * the SDK throws "Output validation error" when structuredContent does not
 * parse:
 *
 *   1. Plain z.object, never .strict(). Zod strips unknown keys on parse, so a
 *      handler that gains a field later still validates. (The opposite of the
 *      input schemas, where .strict() is what catches a misspelled parameter.)
 *   2. A key is required only when the handler always produces a value for it:
 *      a `|| 0` / `?? false` / `|| "SEK"` fallback, or a locally computed
 *      count. A `|| null` fallback is required-but-nullable.
 *   3. A bare property read off an API response, or a conditional spread, is
 *      .optional() — the field may be absent from Fortnox's payload entirely.
 *
 * Sub-objects assembled by helpers (period buckets, group statistics) are typed
 * as open records rather than guessed at: better to advertise the contract we
 * actually guarantee than to invent one the handler may not honour.
 * -------------------------------------------------------------------------- */

/** Optional value read straight off an API payload with no fallback. */
const apiString = () => z.string().nullish();
const apiNumber = () => z.number().nullish();

/** buildPaginationMeta() — always all six. */
export const paginationMetaFields = {
  total: z.number().describe("Total matching records reported by Fortnox"),
  page: z.number().describe("Page returned"),
  limit: z.number().describe("Page size used"),
  count: z.number().describe("Records in this page"),
  has_more: z.boolean().describe("Whether further pages exist"),
  total_pages: z.number().describe("Total page count")
};

/** Present only when a fetch stopped early. */
export const truncationFields = {
  truncated: z.boolean().optional().describe("Whether results were cut short"),
  truncation_reason: z.string().nullish().describe("Why results were cut short")
};

/** Period-scoped analytics preamble. */
export const periodFields = {
  period: z.string().nullable().describe("Named period filter, if one was used"),
  date_range: z.string().nullable().describe("Resolved date range, if one was used")
};

/** Shared prefix of every write tool's result. */
export const writeResultFields = {
  success: z.literal(true),
  message: z.string().describe("Human-readable confirmation")
};

/**
 * List tools that accept `fetch_all` return one of two pagination shapes, and
 * which one depends on that flag:
 *
 *   fetch_all=false  page, limit, has_more, total_pages, next_offset?
 *   fetch_all=true   total_is_exact, fetched_all, pages_fetched
 *
 * Only `total` and `count` are common to both. Declaring the mode-specific keys
 * optional is what makes the contract honest — previously a client had no way to
 * know the shape changed under it.
 */
export const listMetaFields = {
  total: z.number().describe("Total matching records"),
  count: z.number().describe("Records returned"),

  // paged mode
  page: z.number().optional(),
  limit: z.number().optional(),
  has_more: z.boolean().optional(),
  total_pages: z.number().optional(),
  next_offset: z.number().optional(),

  // fetch_all mode
  total_is_exact: z.boolean().optional().describe("Whether `total` is exact or a floor"),
  fetched_all: z.boolean().optional().describe("True when every page was fetched"),
  pages_fetched: z.number().optional(),

  ...truncationFields
};

/** An object whose internals are assembled by a helper. */
export const openRecord = () => z.record(z.unknown());

export { apiString, apiNumber };
