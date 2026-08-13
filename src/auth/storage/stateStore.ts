/**
 * Generic JSON key-value store with per-key TTL, used for OAuth flow state
 * (pending authorizations, issued codes, revoked tokens, registered clients).
 *
 * Unlike ITokenStorage this is not user-keyed: callers namespace their own
 * keys. On serverless/multi-instance deployments the Redis implementation is
 * required for revocation and the authorize -> callback -> exchange handshake
 * to work across instances.
 */
export interface IStateStore {
  /**
   * Whether this store is visible to every instance. Callers whose guarantee
   * depends on that — a rate limit is only a rate limit if all instances count
   * against the same total — check this before relying on the store.
   */
  readonly shared: boolean;

  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;

  /**
   * Atomically read a key and remove it, returning what was there.
   *
   * One-time secrets (authorization codes, OAuth state) must be claimed this
   * way. A get followed by a delete leaves a window in which two concurrent
   * callers both read the value and both conclude it was unused.
   */
  take<T>(key: string): Promise<T | null>;

  /**
   * Reset an existing key's TTL, for records that should expire on idleness
   * rather than on a fixed deadline. No-op when the key is already gone.
   */
  touch(key: string, ttlSeconds: number): Promise<void>;

  /**
   * Atomically increment a counter, starting its TTL on the first increment.
   * Returns the new count and when the counter expires, which together
   * describe one fixed window of a rate limit.
   */
  increment(
    key: string,
    ttlSeconds: number
  ): Promise<{ count: number; resetAt: number }>;
}

/**
 * In-memory state store for development and single-process deployments.
 * WARNING: state is lost on restart and not shared between instances.
 */
export class MemoryStateStore implements IStateStore {
  readonly shared = false;

  private entries: Map<string, { value: unknown; expiresAt: number | null }> = new Map();
  private ops = 0;

  async get<T>(key: string): Promise<T | null> {
    return this.read(key) as T | null;
  }

  async take<T>(key: string): Promise<T | null> {
    // No await between the read and the delete, so this runs to completion in
    // a single tick and no other caller can observe the value in between.
    const value = this.read(key);
    this.entries.delete(key);
    return value as T | null;
  }

  async touch(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;

    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return;
    }

    entry.expiresAt = Date.now() + ttlSeconds * 1000;
  }

  async increment(
    key: string,
    ttlSeconds: number
  ): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const entry = this.entries.get(key);

    if (!entry || entry.expiresAt === null || now >= entry.expiresAt) {
      const expiresAt = now + ttlSeconds * 1000;
      this.entries.set(key, { value: 1, expiresAt });
      return { count: 1, resetAt: expiresAt };
    }

    const count = (typeof entry.value === "number" ? entry.value : 0) + 1;
    entry.value = count;
    return { count, resetAt: entry.expiresAt };
  }

  private read(key: string): unknown | null {
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this.entries.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });

    // Sweep expired entries periodically so long-lived processes don't grow
    if (++this.ops % 100 === 0) {
      const now = Date.now();
      for (const [k, entry] of this.entries) {
        if (entry.expiresAt !== null && now >= entry.expiresAt) {
          this.entries.delete(k);
        }
      }
    }
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

/**
 * Upstash Redis state store, sharing the connection configuration of
 * UpstashRedisTokenStorage (UPSTASH_REDIS_REST_URL / KV_REST_API_URL).
 */
export class UpstashRedisStateStore implements IStateStore {
  readonly shared = true;

  private prefix: string;
  private redis: import("@upstash/redis").Redis | null = null;

  constructor(prefix = "fortnox_state:") {
    this.prefix = prefix;
  }

  private async getRedis() {
    if (!this.redis) {
      try {
        const { Redis } = await import("@upstash/redis");

        const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
        const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

        if (!url || !token) {
          throw new Error("Missing Redis configuration");
        }

        this.redis = new Redis({ url, token });
      } catch (error) {
        throw new Error(
          "Upstash Redis not available. Install @upstash/redis and configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
        );
      }
    }
    return this.redis;
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const redis = await this.getRedis();
    const value = await redis.get<T>(this.key(key));
    return value ?? null;
  }

  async take<T>(key: string): Promise<T | null> {
    const redis = await this.getRedis();
    // GETDEL is a single command, so the read and the removal cannot be
    // interleaved by another instance exchanging the same code
    const value = await redis.getdel<T>(this.key(key));
    return value ?? null;
  }

  async touch(key: string, ttlSeconds: number): Promise<void> {
    const redis = await this.getRedis();
    await redis.expire(this.key(key), ttlSeconds);
  }

  async increment(
    key: string,
    ttlSeconds: number
  ): Promise<{ count: number; resetAt: number }> {
    const redis = await this.getRedis();
    const k = this.key(key);

    // One round trip for the count and the window's remaining lifetime
    const [count, ttlMs] = await redis
      .multi()
      .incr(k)
      .pttl(k)
      .exec<[number, number]>();

    // A negative PTTL means the counter has no expiry yet: either this is the
    // first request of the window, or a previous attempt died between the INCR
    // and the EXPIRE. Either way, start the window now.
    if (ttlMs < 0) {
      await redis.expire(k, ttlSeconds);
      return { count, resetAt: Date.now() + ttlSeconds * 1000 };
    }

    return { count, resetAt: Date.now() + ttlMs };
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const redis = await this.getRedis();
    if (ttlSeconds) {
      await redis.set(this.key(key), value, { ex: ttlSeconds });
    } else {
      await redis.set(this.key(key), value);
    }
  }

  async delete(key: string): Promise<void> {
    const redis = await this.getRedis();
    await redis.del(this.key(key));
  }
}

export function getStateStoreFromEnv(): IStateStore {
  if (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) {
    return new UpstashRedisStateStore();
  }

  console.error(
    "[Storage] Warning: Using in-memory OAuth state. Token revocation and " +
    "in-flight authorizations will not survive restarts or span multiple instances."
  );
  return new MemoryStateStore();
}
