import { TokenInfo } from "../types.js";

/**
 * Interface for token storage backends
 * Allows different storage implementations (memory, Vercel KV, Postgres, etc.)
 */
export interface ITokenStorage {
  /**
   * Get tokens for a user
   * @param userId - Unique user identifier
   * @returns Token info or null if not found
   */
  get(userId: string): Promise<TokenInfo | null>;

  /**
   * Store tokens for a user
   * @param userId - Unique user identifier
   * @param tokens - Token information to store
   */
  set(userId: string, tokens: TokenInfo): Promise<void>;

  /**
   * Delete tokens for a user
   * @param userId - Unique user identifier
   */
  delete(userId: string): Promise<void>;

  /**
   * Check if tokens exist for a user
   * @param userId - Unique user identifier
   */
  exists(userId: string): Promise<boolean>;

  /**
   * Whether a `get` is guaranteed to observe the most recent `set`, including
   * one made by another process or region.
   *
   * DatabaseTokenProvider guards its cleanup of a rejected refresh token by
   * re-reading the record: a refresh token that no longer matches means someone
   * else already rotated it, so the rejection was a lost race and the stored
   * credential must be kept. That guard is only meaningful when reads are
   * immediately consistent - on an eventually consistent store the stale read
   * returns the very record that was just replaced, the guard passes, and the
   * fresh credential is destroyed. Backends that cannot promise this set it to
   * false, and the provider keeps the record instead of deleting it.
   *
   * Omitted means true, which holds for in-process and transactional stores.
   */
  readonly readsAreImmediatelyConsistent?: boolean;
}

/**
 * Extended token info with additional metadata for storage
 */
export interface StoredTokenInfo extends TokenInfo {
  /** Fortnox company ID associated with these tokens */
  fortnoxCompanyId?: string;
  /** When the tokens were first stored */
  createdAt: number;
  /** When the tokens were last updated */
  updatedAt: number;
}
