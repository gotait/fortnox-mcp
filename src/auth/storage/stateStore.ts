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
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * In-memory state store for development and single-process deployments.
 * WARNING: state is lost on restart and not shared between instances.
 */
export class MemoryStateStore implements IStateStore {
  private entries: Map<string, { value: unknown; expiresAt: number | null }> = new Map();
  private ops = 0;

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }

    return entry.value as T;
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
