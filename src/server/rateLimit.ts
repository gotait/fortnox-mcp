import { Request, Response, NextFunction, RequestHandler } from "express";
import { IStateStore } from "../auth/storage/stateStore.js";

interface Bucket {
  count: number;
  resetAt: number;
}

// Hard bound on locally tracked keys. A flood from many distinct addresses has
// no expired buckets to reclaim, so the map is capped and the least recently
// active keys are evicted instead. Eviction is what makes the bound real, and
// it costs something: a caller who can churn more than this many keys inside
// one window can push their own bucket out and start over. Counting in a shared
// store has no such ceiling, which is the other reason to prefer it.
const MAX_LOCAL_BUCKETS = 10_000;

export interface RateLimitOptions {
  /** Window length in milliseconds */
  windowMs: number;
  /** Maximum requests per key per window */
  max: number;
  /** Namespaces the counters; must be distinct per limiter */
  name: string;
  /** Derives the bucket key; defaults to the client IP */
  key?: (req: Request) => string;
  /**
   * Store to count in. Used only when it spans instances — counting in a
   * per-process store is no better than counting in this module's own map.
   */
  store?: IStateStore;
}

/**
 * Fixed-window rate limiter.
 *
 * Counts in the shared state store when one is configured, so all instances
 * count against the same total; that matters on serverless, where each
 * concurrent instance and each cold start would otherwise get its own
 * allowance. Falls back to a per-process map, which bounds abuse per instance.
 *
 * Store failures fail open: the limiter is a guard on the service, not the
 * service, so a Redis outage must not turn every request into a 429.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const store = options.store?.shared ? options.store : undefined;
  const ttlSeconds = Math.ceil(options.windowMs / 1000);

  const buckets = new Map<string, Bucket>();
  let lastSweep = 0;
  let storeFailures = 0;

  function countLocally(key: string, now: number): Bucket {
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
    }
    bucket.count++;

    // Re-insert so iteration order is least-recently-active first, which is
    // what eviction below relies on
    buckets.delete(key);
    buckets.set(key, bucket);

    // Reclaim expired buckets at most once per window rather than on every
    // request: the sweep is O(n), and under a wide flood it is both useless
    // (nothing has expired yet) and hot
    if (now - lastSweep >= options.windowMs) {
      lastSweep = now;
      for (const [k, b] of buckets) {
        if (now >= b.resetAt) {
          buckets.delete(k);
        }
      }
    }

    while (buckets.size > MAX_LOCAL_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }

    return bucket;
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = options.key ? options.key(req) : clientAddress(req);
    const now = Date.now();

    let count: number;
    let resetAt: number;

    if (store) {
      try {
        ({ count, resetAt } = await store.increment(
          `ratelimit:${options.name}:${key}`,
          ttlSeconds
        ));
      } catch (error) {
        if (storeFailures++ === 0) {
          console.error(
            `[RateLimit] State store unavailable; not enforcing the ${options.name} limit:`,
            error
          );
        }
        next();
        return;
      }
    } else {
      ({ count, resetAt } = countLocally(key, now));
    }

    if (count > options.max) {
      res.setHeader(
        "Retry-After",
        String(Math.max(Math.ceil((resetAt - now) / 1000), 1))
      );
      res.status(429).json({ error: "too_many_requests" });
      return;
    }

    next();
  };
}

/**
 * req.ip reflects X-Forwarded-For whenever Express trusts proxies, which is
 * why createRemoteServer only enables that behind a proxy that overwrites the
 * header — otherwise the key here is caller-supplied. The socket address is a
 * fallback for hosts where req.ip is unset.
 */
function clientAddress(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}
