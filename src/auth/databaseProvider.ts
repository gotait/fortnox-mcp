import { FORTNOX_OAUTH_URL, TOKEN_REFRESH_BUFFER_MS } from "../constants.js";
import { ITokenProvider, TokenInfo, AuthRequiredError } from "./types.js";
import { ITokenStorage } from "./storage/types.js";
import { FortnoxCredentials, getFortnoxCredentials } from "./credentials.js";
import { HttpResponseError, basicAuthHeader, postForm } from "../services/http.js";

interface FortnoxTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

// Fortnox rejects an expired or revoked refresh token with 400 invalid_grant.
// Other 400s (invalid_request, invalid_client, unsupported_grant_type) mean the
// request or our credentials are wrong, and 401/5xx/network errors are
// transient or configuration problems — none of those invalidate the user's
// refresh token, so the error code has to be checked and not just the status.
function isRefreshTokenRejected(error: unknown): boolean {
  if (!(error instanceof HttpResponseError) || error.status !== 400) {
    return false;
  }

  const data = error.data;
  if (typeof data === "string") {
    return data.includes("invalid_grant");
  }
  return (data as { error?: unknown } | undefined)?.error === "invalid_grant";
}

// Token provider for remote mode (multi-user with database storage)
export class DatabaseTokenProvider implements ITokenProvider {
  private clientId: string;
  private clientSecret: string;
  private storage: ITokenStorage;
  private refreshPromises: Map<string, Promise<string>> = new Map();

  /**
   * @param credentials - Explicit Fortnox app credentials. Omit on Node to read
   *   them from the environment; the Worker passes them in, because there the
   *   secrets arrive on the `env` argument and module-scope process.env reads
   *   would run before any of it is populated.
   */
  constructor(storage: ITokenStorage, credentials?: FortnoxCredentials) {
    const { clientId, clientSecret } = credentials ?? getFortnoxCredentials();
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.storage = storage;
  }

  async getAccessToken(userId?: string): Promise<string> {
    if (!userId) {
      throw new AuthRequiredError();
    }

    const tokens = await this.storage.get(userId);
    if (!tokens) {
      throw new AuthRequiredError(userId);
    }

    const needsRefresh = Date.now() >= tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS;

    if (needsRefresh || !tokens.accessToken) {
      // Deduplicate concurrent refresh requests per user
      if (!this.refreshPromises.has(userId)) {
        const promise = this.refreshAccessToken(userId, tokens).finally(() => {
          this.refreshPromises.delete(userId);
        });
        this.refreshPromises.set(userId, promise);
      }
      return this.refreshPromises.get(userId)!;
    }

    return tokens.accessToken;
  }

  isAuthenticated(userId?: string): boolean {
    // For async storage, we can't check synchronously
    // Return true and let getAccessToken throw if not authenticated
    return !!userId;
  }

  getTokenInfo(userId?: string): TokenInfo | null {
    // For async storage, return null (caller should use async methods)
    return null;
  }

  async getTokenInfoAsync(userId: string): Promise<TokenInfo | null> {
    return this.storage.get(userId);
  }

  async storeTokens(userId: string, tokens: TokenInfo): Promise<void> {
    await this.storage.set(userId, tokens);
  }

  async deleteTokens(userId: string): Promise<void> {
    await this.storage.delete(userId);
  }

  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    userId: string
  ): Promise<TokenInfo> {
    const tokenUrl = `${FORTNOX_OAUTH_URL}/token`;

    try {
      const data = await postForm<FortnoxTokenResponse>(
        tokenUrl,
        new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: redirectUri
        }),
        { Authorization: basicAuthHeader(this.clientId, this.clientSecret) }
      );

      const tokens: TokenInfo = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        scope: data.scope
      };

      await this.storeTokens(userId, tokens);
      return tokens;
    } catch (error) {
      throw this.handleAuthError(error, "Failed to exchange authorization code");
    }
  }

  private async refreshAccessToken(userId: string, tokens: TokenInfo): Promise<string> {
    if (!tokens.refreshToken) {
      throw new Error("No refresh token available");
    }

    const tokenUrl = `${FORTNOX_OAUTH_URL}/token`;

    try {
      const data = await postForm<FortnoxTokenResponse>(
        tokenUrl,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken
        }),
        { Authorization: basicAuthHeader(this.clientId, this.clientSecret) }
      );

      const newTokens: TokenInfo = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        scope: data.scope
      };

      await this.storeTokens(userId, newTokens);
      return newTokens.accessToken;
    } catch (error) {
      if (isRefreshTokenRejected(error)) {
        await this.deleteRejectedTokens(userId, tokens.refreshToken);
      }
      throw this.handleAuthError(error, "Failed to refresh access token");
    }
  }

  // Refresh tokens rotate on every use, and refreshes are only deduplicated
  // within a single process: a concurrent invocation may already have refreshed
  // this user and stored a valid new token, which is what made the token we
  // just used invalid. Only drop the stored tokens if they are still the ones
  // Fortnox rejected, so a losing race can't wipe a working credential.
  private async deleteRejectedTokens(
    userId: string,
    rejectedRefreshToken: string
  ): Promise<void> {
    try {
      const current = await this.storage.get(userId);
      if (current && current.refreshToken !== rejectedRefreshToken) {
        return;
      }
      await this.storage.delete(userId);
    } catch (storageError) {
      // Storage is unavailable; keep the tokens rather than losing them to an
      // infrastructure blip. The refresh error is reported to the caller.
      console.error("[Auth] Failed to clear rejected tokens:", storageError);
    }
  }

  getAuthorizationUrl(redirectUri: string, scopes: string[], state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      response_type: "code",
      access_type: "offline"
    });

    if (state) {
      params.set("state", state);
    }

    return `${FORTNOX_OAUTH_URL}/auth?${params.toString()}`;
  }

  private handleAuthError(error: unknown, context: string): Error {
    if (error instanceof HttpResponseError) {
      const status = error.status;
      const data = error.data as
        | { error_description?: string; error?: string }
        | undefined;

      if (status === 401) {
        return new Error(
          `${context}: Invalid credentials. Check Fortnox client configuration.`
        );
      }
      if (status === 400) {
        const errorDesc = data?.error_description || data?.error || "Bad request";
        return new Error(
          `${context}: ${errorDesc}. The refresh token may be expired or revoked.`
        );
      }
      return new Error(
        `${context}: API error ${status} - ${JSON.stringify(data)}`
      );
    }

    return new Error(`${context}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
