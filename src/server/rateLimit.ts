import { Request, Response, NextFunction, RequestHandler } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Window length in milliseconds */
  windowMs: number;
  /** Maximum requests per key per window */
  max: number;
  /** Derives the bucket key; defaults to the client IP */
  key?: (req: Request) => string;
}

/**
 * Fixed-window in-memory rate limiter.
 *
 * State is per-process: on serverless/multi-instance deployments each
 * instance enforces the limit independently, which still bounds abuse per
 * instance. Enforcing a global limit would require a shared store.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = options.key ? options.key(req) : req.ip || "unknown";
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;

    // Bound memory under key churn
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) {
        if (now >= b.resetAt) {
          buckets.delete(k);
        }
      }
    }

    if (bucket.count > options.max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: "too_many_requests" });
      return;
    }

    next();
  };
}
