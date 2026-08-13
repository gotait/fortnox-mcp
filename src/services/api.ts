import { getTokenProvider } from "../auth/registry.js";
import { getCurrentUserId } from "../auth/context.js";
import {
  DEFAULT_TIMEOUT_MS,
  HttpResponseError,
  isTimeoutError,
  readBody
} from "./http.js";
import {
  FORTNOX_API_BASE_URL,
  RATE_LIMIT_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  MAX_FETCH_ALL_RESULTS,
  MAX_FETCH_ALL_PAGES,
  FETCH_ALL_PAGE_SIZE,
  FETCH_ALL_DELAY_MS
} from "../constants.js";

// Rate limiting state
let requestTimestamps: number[] = [];

/**
 * Simple rate limiter for Fortnox API (25 requests per 5 seconds)
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();

  // Remove timestamps outside the window
  requestTimestamps = requestTimestamps.filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );

  // If at limit, wait for oldest request to expire
  if (requestTimestamps.length >= RATE_LIMIT_REQUESTS) {
    const oldestTimestamp = requestTimestamps[0];
    const waitTime = RATE_LIMIT_WINDOW_MS - (now - oldestTimestamp) + 50; // +50ms buffer
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    // Clean up again after waiting
    requestTimestamps = requestTimestamps.filter(
      (ts) => Date.now() - ts < RATE_LIMIT_WINDOW_MS
    );
  }

  requestTimestamps.push(Date.now());
}

/**
 * Make an authenticated request to the Fortnox API
 * Automatically uses the current user context in remote mode
 */
export async function fortnoxRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  data?: unknown,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  await waitForRateLimit();

  // Get access token using the token provider
  // In local mode, userId is undefined and ignored
  // In remote mode, userId comes from the request context
  const tokenProvider = getTokenProvider();
  const userId = getCurrentUserId();
  const accessToken = await tokenProvider.getAccessToken(userId);

  // Clean undefined params
  const cleanParams: Record<string, string | number | boolean> = {};
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        cleanParams[key] = value;
      }
    }
  }

  const url = new URL(`${FORTNOX_API_BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(cleanParams)) {
    url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    });
  } catch (error) {
    // Never reached the server: a timeout, DNS failure or refused connection.
    throw handleApiError(error, endpoint);
  }

  const body = await readBody(response);

  if (!response.ok) {
    throw handleApiError(
      new HttpResponseError(response.status, body, url.toString()),
      endpoint
    );
  }

  return body as T;
}

/**
 * Handle API errors with descriptive messages
 */
export function handleApiError(error: unknown, context?: string): Error {
  const prefix = context ? `[${context}] ` : "";

  if (error instanceof HttpResponseError) {
    const status = error.status;
    const data = error.data as {
      ErrorInformation?: { message?: string; Message?: string };
      message?: string;
      error?: string;
    } | string | undefined;

    // Extract Fortnox-specific error message
    const fortnoxError = typeof data === "string"
      ? data
      : data?.ErrorInformation?.message ||
        data?.ErrorInformation?.Message ||
        data?.message ||
        data?.error;

    switch (status) {
      case 400:
        return new Error(
          `${prefix}Bad request: ${fortnoxError || "Invalid parameters"}. ` +
          `Check that all required fields are provided and values are valid.`
        );
      case 401:
        return new Error(
          `${prefix}Authentication failed. The access token may be expired or invalid. ` +
          `Try refreshing authentication.`
        );
      case 403:
        return new Error(
          `${prefix}Permission denied. Your API credentials don't have access to this resource. ` +
          `Check your Fortnox app scopes.`
        );
      case 404:
        return new Error(
          `${prefix}Resource not found. The requested item does not exist or has been deleted.`
        );
      case 429:
        return new Error(
          `${prefix}Rate limit exceeded. Fortnox allows 25 requests per 5 seconds. ` +
          `Please wait before retrying.`
        );
      case 500:
      case 502:
      case 503:
        return new Error(
          `${prefix}Fortnox server error (${status}). The service may be temporarily unavailable. ` +
          `Please try again later.`
        );
      default:
        return new Error(
          `${prefix}API error ${status}: ${fortnoxError || JSON.stringify(data)}`
        );
    }
  }

  if (error instanceof Error) {
    if (
      isTimeoutError(error) ||
      error.message.includes("ECONNABORTED") ||
      error.message.includes("timeout")
    ) {
      return new Error(
        `${prefix}Request timed out. The Fortnox API is not responding. Please try again.`
      );
    }
    if (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED")) {
      return new Error(
        `${prefix}Cannot connect to Fortnox API. Check your internet connection.`
      );
    }
    return new Error(`${prefix}${error.message}`);
  }

  return new Error(`${prefix}Unexpected error: ${String(error)}`);
}

/**
 * Format a date for Fortnox API (YYYY-MM-DD)
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Parse a Fortnox date string to Date object
 */
export function parseDate(dateStr: string): Date {
  return new Date(dateStr);
}

/**
 * Configuration for fetchAllPages
 */
export interface FetchAllConfig {
  /** Maximum total results to fetch (default: MAX_FETCH_ALL_RESULTS) */
  maxResults?: number;
  /** Maximum pages to fetch (default: MAX_FETCH_ALL_PAGES) */
  maxPages?: number;
  /** Page size for each request (default: FETCH_ALL_PAGE_SIZE) */
  pageSize?: number;
  /** Delay between page requests in ms (default: FETCH_ALL_DELAY_MS) */
  delayBetweenPages?: number;
}

/**
 * Result from fetchAllPages
 */
export interface FetchAllResult<T> {
  /** All items fetched */
  items: T[];
  /** Total count from API (may be higher than items.length if truncated) */
  total: number;
  /**
   * Whether the API reported the total. When false, `total` falls back to the
   * number of items fetched, which is only a lower bound if the fetch was
   * truncated - do not present it as an authoritative count.
   */
  totalIsExact: boolean;
  /** Number of pages fetched */
  pagesFetched: number;
  /** Whether results were truncated due to limits */
  truncated: boolean;
  /** Reason for truncation if truncated is true */
  truncationReason?: string;
}

/**
 * Delay execution for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch all pages of a paginated Fortnox API endpoint
 *
 * This function automatically paginates through all results from a Fortnox endpoint.
 * It includes safety limits to prevent runaway queries and respects rate limits.
 *
 * @param endpoint - API endpoint (e.g., "/3/invoices")
 * @param params - Query parameters to pass to each request
 * @param extractItems - Function to extract items array from response
 * @param extractTotal - Function to extract total count from response
 * @param config - Optional configuration for limits and delays
 * @returns All items fetched with metadata about the fetch operation
 *
 * @example
 * const result = await fetchAllPages<Invoice, InvoiceListResponse>(
 *   "/3/invoices",
 *   { filter: "unpaid" },
 *   (r) => r.Invoices || [],
 *   (r) => r.MetaInformation?.["@TotalResources"] || 0
 * );
 */
export async function fetchAllPages<T, R>(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined>,
  extractItems: (response: R) => T[],
  extractTotal: (response: R) => number,
  config?: FetchAllConfig
): Promise<FetchAllResult<T>> {
  const maxResults = config?.maxResults ?? MAX_FETCH_ALL_RESULTS;
  const maxPages = config?.maxPages ?? MAX_FETCH_ALL_PAGES;
  const pageSize = config?.pageSize ?? FETCH_ALL_PAGE_SIZE;
  const delayMs = config?.delayBetweenPages ?? FETCH_ALL_DELAY_MS;

  const allItems: T[] = [];
  const seenPages = new Set<string>();
  let page = 1;
  let pagesFetched = 0;
  let total = 0;
  let totalIsExact = false;
  let hasMore = true;
  let truncated = false;
  let truncationReason: string | undefined;

  while (hasMore) {
    // Check page limit
    if (page > maxPages) {
      truncated = true;
      truncationReason = `Reached maximum page limit (${maxPages} pages). Use filters to narrow results.`;
      break;
    }

    // Check result limit
    if (allItems.length >= maxResults) {
      truncated = true;
      truncationReason = `Reached maximum result limit (${maxResults} items). Use filters to narrow results.`;
      break;
    }

    // Make request
    const response = await fortnoxRequest<R>(endpoint, "GET", undefined, {
      ...params,
      limit: pageSize,
      page
    });

    pagesFetched++;

    const items = extractItems(response);

    // Keep the last total the API actually reported; a later page that omits
    // MetaInformation must not reset a known total back to "unknown".
    const reportedTotal = extractTotal(response);
    if (reportedTotal > 0) {
      total = reportedTotal;
      totalIsExact = true;
    }

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    if (!totalIsExact) {
      // Without a reported total there is no count to stop at, so we probe
      // until a page comes back empty. Some endpoints (e.g. /3/costcenters,
      // /3/projects) ignore `page` and answer every request with the same
      // records, which would otherwise loop until the page/result cap and
      // report each record dozens of times. Treat a repeated page as the end
      // and discard it.
      const fingerprint = JSON.stringify(items);
      if (seenPages.has(fingerprint)) {
        hasMore = false;
        break;
      }
      seenPages.add(fingerprint);
    }

    allItems.push(...items);

    if (totalIsExact && allItems.length >= total) {
      hasMore = false;
    } else {
      page++;
      // Delay to respect rate limits (except on last page)
      await delay(delayMs);
    }
  }

  return {
    items: allItems,
    // When the API never reported a total, fall back to what we actually
    // fetched instead of 0 - flagged via totalIsExact, since a truncated
    // fetch makes that a lower bound rather than the real total.
    total: totalIsExact ? total : allItems.length,
    totalIsExact,
    pagesFetched,
    truncated,
    truncationReason
  };
}
