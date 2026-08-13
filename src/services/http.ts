/**
 * Minimal fetch helpers shared by the API client and the token providers.
 *
 * axios was replaced with fetch so the same code can run on Node and on
 * Cloudflare Workers, where axios' Node HTTP adapter is unavailable. The error
 * shape below stands in for AxiosError: callers previously branched on
 * `error.response.status` and `error.response.data`, and keep doing so through
 * `status` and `data` here.
 */

/** Wall-clock budget for a single upstream request. */
export const DEFAULT_TIMEOUT_MS = 30000;

/**
 * An upstream responded with a non-2xx status.
 *
 * Network failures and timeouts are *not* represented by this class - they
 * surface as the underlying TypeError/AbortError, so that callers can tell
 * "the server said no" apart from "we never got an answer".
 */
export class HttpResponseError extends Error {
  constructor(
    public readonly status: number,
    public readonly data: unknown,
    public readonly url?: string
  ) {
    super(`HTTP ${status}`);
    this.name = "HttpResponseError";
  }
}

/** True when a request failed before any response was received. */
export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Read a response body as JSON where possible, falling back to text.
 *
 * Fortnox answers some errors with HTML or an empty body, and 204/205 carry no
 * body at all, so this never assumes the content type is honest.
 */
export async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) {
    return undefined;
  }

  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * POST an application/x-www-form-urlencoded body and return the parsed JSON.
 *
 * Throws HttpResponseError on a non-2xx response so callers can inspect the
 * OAuth error code in the body.
 */
export async function postForm<T>(
  url: string,
  body: URLSearchParams,
  headers: Record<string, string>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...headers,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = await readBody(response);

  if (!response.ok) {
    throw new HttpResponseError(response.status, data, url);
  }

  return data as T;
}

/**
 * HTTP Basic credentials for the Fortnox token endpoint.
 *
 * btoa is used rather than Buffer so this works unchanged on Workers. Client
 * IDs and secrets are ASCII, which is all btoa accepts.
 */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}
