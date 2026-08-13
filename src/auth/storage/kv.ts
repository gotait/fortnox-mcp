import { TokenInfo } from "../types.js";
import { ITokenStorage, StoredTokenInfo } from "./types.js";

// Token TTL: 90 days in seconds. Refreshing rewrites the entry, so the window
// only expires accounts that have genuinely gone idle.
const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * The slice of Cloudflare's KVNamespace this storage actually uses.
 *
 * Declared structurally rather than importing @cloudflare/workers-types so the
 * Node build (tsc over src/) does not need Workers globals in scope. A real
 * KVNamespace satisfies this shape.
 */
export interface KVNamespaceLike {
  get(key: string, options: { type: "json" }): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Cloudflare KV token storage.
 *
 * KV is eventually consistent across regions: a write is immediately readable
 * in the location that made it, but may take up to a minute elsewhere. That is
 * tolerable here because the value is refreshed well before it expires
 * (TOKEN_REFRESH_BUFFER_MS) and because DatabaseTokenProvider only deletes a
 * record after confirming the stored refresh token is the one Fortnox
 * rejected - a stale read makes it skip the delete rather than destroy a
 * working credential.
 */
export class KVTokenStorage implements ITokenStorage {
  constructor(
    private readonly kv: KVNamespaceLike,
    private readonly prefix = "fortnox_tokens:"
  ) {}

  private key(userId: string): string {
    return `${this.prefix}${userId}`;
  }

  private async read(userId: string): Promise<StoredTokenInfo | null> {
    const stored = (await this.kv.get(this.key(userId), {
      type: "json",
    })) as StoredTokenInfo | null;
    return stored ?? null;
  }

  async get(userId: string): Promise<TokenInfo | null> {
    const stored = await this.read(userId);
    if (!stored) return null;

    return {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
      scope: stored.scope,
    };
  }

  async set(userId: string, tokens: TokenInfo): Promise<void> {
    const existing = await this.read(userId);
    const now = Date.now();

    const stored: StoredTokenInfo = {
      ...tokens,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await this.kv.put(this.key(userId), JSON.stringify(stored), {
      expirationTtl: TOKEN_TTL_SECONDS,
    });
  }

  async delete(userId: string): Promise<void> {
    await this.kv.delete(this.key(userId));
  }

  async exists(userId: string): Promise<boolean> {
    // KV has no membership test, so this costs a full read.
    return (await this.read(userId)) !== null;
  }
}
