import { Request, Response, NextFunction, RequestHandler } from "express";
import {
  AugmentedRequest,
  rateLimit as expressRateLimit,
  ipKeyGenerator,
} from "express-rate-limit";
import { Ratelimit } from "@upstash/ratelimit";
import { createUpstashRedis, hasUpstashConfig } from "../auth/storage/upstashClient.js";

export interface RateLimitOptions {
  /** Window length in milliseconds */
  windowMs: number;
  /** Maximum requests per identity per window */
  max: number;
  /** Namespaces the counters; must be distinct per limiter */
  name: string;
  /**
   * Identity to limit on. Return undefined to fall back to the client address,
   * which is normalized the same way for both backends.
   */
  identity?: (req: Request) => string | undefined;
}

/**
 * Rate limiter for one endpoint or group of endpoints.
 *
 * Counts in Redis when one is configured, because that is the only way the
 * limit holds on the serverless deployment: every cold start and every
 * concurrent instance would otherwise be handed an allowance of its own.
 * Without Redis there is nothing to share, so counting falls back to the
 * process, which still bounds abuse per instance.
 *
 * Neither backend enforces during a Redis outage — @upstash/ratelimit allows
 * the request once its timeout elapses, and a hard failure is caught here.
 * The limiter guards the service and must not become a way to take it down.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const local = localLimiter(options);
  return hasUpstashConfig() ? sharedLimiter(options, local) : local;
}

function localLimiter(options: RateLimitOptions): RequestHandler {
  return expressRateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => options.identity?.(req) ?? clientAddress(req),
    handler: (req, res, _next, used) => {
      const info = (req as AugmentedRequest)[used.requestPropertyName];
      reject(res, info?.resetTime?.getTime() ?? Date.now() + options.windowMs);
    },
  });
}

function sharedLimiter(
  options: RateLimitOptions,
  fallback: RequestHandler
): RequestHandler {
  const window = `${Math.max(Math.ceil(options.windowMs / 1000), 1)} s` as const;

  // Built once per limiter rather than per request, so the ephemeral cache can
  // answer for identities already known to be over the limit without a round
  // trip — which is the difference between absorbing a flood and forwarding it
  // to Redis
  const ephemeralCache = new Map<string, number>();
  let limiter: Promise<Ratelimit | null> | null = null;

  function getLimiter(): Promise<Ratelimit | null> {
    if (!limiter) {
      limiter = createUpstashRedis()
        .then(
          (redis) =>
            new Ratelimit({
              redis,
              // Sliding window, so twice the limit can't land across a window
              // boundary the way it can with a fixed counter
              limiter: Ratelimit.slidingWindow(options.max, window),
              prefix: `ratelimit:${options.name}`,
              ephemeralCache,
              analytics: false,
              timeout: 1000,
            })
        )
        .catch((error) => {
          console.error(
            `[RateLimit] Redis unavailable; counting the ${options.name} limit in-process:`,
            error
          );
          return null;
        });
    }
    return limiter;
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    const shared = await getLimiter();
    if (!shared) {
      fallback(req, res, next);
      return;
    }

    const identity = options.identity?.(req) ?? clientAddress(req);

    let result: Awaited<ReturnType<Ratelimit["limit"]>>;
    try {
      result = await shared.limit(identity);
    } catch (error) {
      console.error(`[RateLimit] ${options.name} check failed; allowing:`, error);
      next();
      return;
    }

    if (!result.success) {
      reject(res, result.reset);
      return;
    }

    next();
  };
}

function reject(res: Response, resetAtMs: number): void {
  const retryAfter = Math.max(Math.ceil((resetAtMs - Date.now()) / 1000), 1);
  res.setHeader("Retry-After", String(retryAfter));
  res.status(429).json({ error: "too_many_requests" });
}

/**
 * req.ip reflects X-Forwarded-For whenever Express trusts proxies, which is
 * why createRemoteServer only enables that behind a proxy that overwrites the
 * header — otherwise this key is caller-supplied. ipKeyGenerator groups IPv6
 * addresses into their /56 subnet, so a caller with a v6 range can't mint a
 * fresh bucket per address.
 */
function clientAddress(req: Request): string {
  return ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown");
}
