/**
 * Connection details for the Upstash Redis instance.
 *
 * The OAuth state store and the rate limiter both talk to it, and
 * @upstash/redis is an optional dependency, so the environment lookup and the
 * dynamic import live here rather than in each caller.
 */

export type UpstashRedis = import("@upstash/redis").Redis;

function credentials(): { url?: string; token?: string } {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}

/** Whether a shared Redis instance is configured for this deployment */
export function hasUpstashConfig(): boolean {
  const { url, token } = credentials();
  return Boolean(url && token);
}

/** One half of the configuration present — almost certainly a mistake */
export function hasPartialUpstashConfig(): boolean {
  const { url, token } = credentials();
  return Boolean(url) !== Boolean(token);
}

export async function createUpstashRedis(): Promise<UpstashRedis> {
  const { url, token } = credentials();
  if (!url || !token) {
    throw new Error(
      "Missing Redis configuration: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
    );
  }

  let Redis: typeof import("@upstash/redis").Redis;
  try {
    ({ Redis } = await import("@upstash/redis"));
  } catch {
    throw new Error(
      "Upstash Redis not available. Install @upstash/redis to use a shared store."
    );
  }

  return new Redis({ url, token });
}
