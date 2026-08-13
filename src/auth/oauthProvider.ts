import { Response } from "express";
import * as jose from "jose";
import crypto from "crypto";
import {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidClientMetadataError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { ITokenStorage } from "./storage/types.js";
import { IStateStore } from "./storage/stateStore.js";
import { DatabaseTokenProvider } from "./databaseProvider.js";
import { FORTNOX_SCOPES } from "./credentials.js";

// JWT configuration
const JWT_ALGORITHM = "HS256";
const ACCESS_TOKEN_EXPIRES_IN = 3600; // 1 hour
const REFRESH_TOKEN_EXPIRES_IN = 90 * 24 * 3600; // 90 days

// OAuth flow state lifetimes. The pending window has to cover a full
// interactive Fortnox login — SSO, 2FA and company selection — so it is
// generous; the authorization code, which is machine-to-machine, is not.
const PENDING_AUTH_TTL_SECONDS = 30 * 60;
const AUTH_CODE_TTL_SECONDS = 5 * 60;
// Client registrations expire on idleness, not on a deadline: every refresh
// mints a token good for another REFRESH_TOKEN_EXPIRES_IN, so a fixed TTL
// would strand clients still holding valid refresh tokens. getClient extends
// this on every hit.
const CLIENT_TTL_SECONDS = REFRESH_TOKEN_EXPIRES_IN;

// Links MCP <-> Fortnox OAuth. Only JSON-serializable fields, since this
// round-trips through the state store.
interface PendingAuthorization {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  mcpState?: string;
  createdAt: number;
}

interface IssuedCode {
  userId: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  createdAt: number;
}

/**
 * MCP OAuth provider that proxies authentication to Fortnox
 *
 * Flow:
 * 1. Claude calls /authorize on this server
 * 2. We redirect to Fortnox OAuth
 * 3. User authorizes in Fortnox
 * 4. Fortnox redirects to our /oauth/fortnox/callback
 * 5. We store Fortnox tokens and redirect back to Claude with our auth code
 * 6. Claude exchanges our auth code for our JWT access token
 * 7. Claude uses our JWT for /mcp requests
 * 8. We verify JWT and use stored Fortnox tokens for API calls
 *
 * All flow state (pending authorizations, issued codes, revocations,
 * registered clients) lives in the state store, so the flow and token
 * revocation work across restarts and multiple instances when a shared
 * store (Redis) is configured.
 */
export class FortnoxProxyOAuthProvider implements OAuthServerProvider {
  private jwtSecret: Uint8Array;
  private serverUrl: string;
  private tokenProvider: DatabaseTokenProvider;
  private stateStore: IStateStore;
  private _clientsStore: StateStoreClientsStore;

  // Skip local PKCE validation since we handle it ourselves
  skipLocalPkceValidation = false;

  constructor(
    jwtSecret: string,
    serverUrl: string,
    tokenStorage: ITokenStorage,
    stateStore: IStateStore
  ) {
    if (jwtSecret.length < 32) {
      throw new Error(
        "JWT_SECRET must be at least 32 characters: every user's session " +
        "and token isolation depends on it being unguessable. " +
        "Generate one with: openssl rand -base64 32"
      );
    }
    this.jwtSecret = new TextEncoder().encode(jwtSecret);
    this.serverUrl = serverUrl;
    this.tokenProvider = new DatabaseTokenProvider(tokenStorage);
    this.stateStore = stateStore;
    this._clientsStore = new StateStoreClientsStore(stateStore);
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  getTokenProvider(): DatabaseTokenProvider {
    return this.tokenProvider;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    // Generate state to link MCP request to Fortnox OAuth
    const oauthState = crypto.randomUUID();

    // Store pending authorization; the TTL bounds the flow's lifetime
    const pending: PendingAuthorization = {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      scopes: params.scopes || [],
      mcpState: params.state,
      createdAt: Date.now(),
    };
    await this.stateStore.set(
      `pending_auth:${oauthState}`,
      pending,
      PENDING_AUTH_TTL_SECONDS
    );

    // Redirect to Fortnox OAuth
    const fortnoxAuthUrl = this.tokenProvider.getAuthorizationUrl(
      `${this.serverUrl}/oauth/fortnox/callback`,
      FORTNOX_SCOPES,
      oauthState
    );

    res.redirect(fortnoxAuthUrl);
  }

  async handleFortnoxCallback(
    code: string,
    state: string
  ): Promise<{ redirectUri: string; code: string; state?: string }> {
    // Claim the pending authorization; the state is single-use, and taking it
    // means a replayed callback can't ride the same pending record
    const pending = await this.stateStore.take<PendingAuthorization>(
      `pending_auth:${state}`
    );
    if (!pending) {
      throw new Error("Invalid or expired OAuth state");
    }

    // Exchange Fortnox code for tokens
    // Generate a unique user ID based on client ID and a random component
    const userId = `${pending.clientId}:${crypto.randomUUID()}`;

    await this.tokenProvider.exchangeAuthorizationCode(
      code,
      `${this.serverUrl}/oauth/fortnox/callback`,
      userId
    );

    // Issue our own authorization code
    const mcpAuthCode = crypto.randomUUID();
    const issued: IssuedCode = {
      userId,
      clientId: pending.clientId,
      codeChallenge: pending.codeChallenge,
      redirectUri: pending.redirectUri,
      scopes: pending.scopes,
      createdAt: Date.now(),
    };
    await this.stateStore.set(
      `auth_code:${mcpAuthCode}`,
      issued,
      AUTH_CODE_TTL_SECONDS
    );

    return {
      redirectUri: pending.redirectUri,
      code: mcpAuthCode,
      state: pending.mcpState,
    };
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const issued = await this.stateStore.get<IssuedCode>(
      `auth_code:${authorizationCode}`
    );
    if (!issued) {
      throw new Error("Invalid authorization code");
    }
    return issued.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL
  ): Promise<OAuthTokens> {
    // Claim the code before validating anything about it. Reading it and
    // deleting it separately would let two concurrent exchanges of the same
    // code both see it as unused and both receive a token pair, so a leaked
    // code stays redeemable for as long as its TTL. Taking it also burns the
    // code on a failed exchange, which is what RFC 6749 s4.1.2 asks for.
    const issued = await this.stateStore.take<IssuedCode>(
      `auth_code:${authorizationCode}`
    );
    if (!issued) {
      throw new Error("Invalid authorization code");
    }

    // Verify client
    if (issued.clientId !== client.client_id) {
      throw new Error("Client mismatch");
    }

    // Check if code is expired (5 minutes); the store TTL also enforces this
    if (Date.now() - issued.createdAt > AUTH_CODE_TTL_SECONDS * 1000) {
      throw new Error("Authorization code expired");
    }

    // Issue JWT tokens
    return this.issueTokens(issued.userId, issued.clientId, issued.scopes);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    _resource?: URL
  ): Promise<OAuthTokens> {
    // Verify refresh token
    const payload = await this.verifyToken(refreshToken, "refresh");

    if (payload.clientId !== client.client_id) {
      throw new Error("Client mismatch");
    }

    // Check if revoked
    if (await this.isRevoked(refreshToken)) {
      throw new Error("Token has been revoked");
    }

    // Issue new tokens
    return this.issueTokens(
      payload.userId,
      payload.clientId,
      scopes || payload.scopes
    );
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // Verify the signature first. The revocation lookup is a state store
    // round trip, and this runs on unauthenticated input: checking it before
    // the signature lets anyone turn a stream of junk bearer strings into a
    // stream of store reads.
    const payload = await this.verifyToken(token, "access");

    if (await this.isRevoked(token)) {
      throw new Error("Token has been revoked");
    }

    return {
      token,
      clientId: payload.clientId,
      scopes: payload.scopes,
      expiresAt: payload.exp,
      extra: {
        userId: payload.userId,
      },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    // Determine the token's remaining lifetime so the revocation record
    // outlives it; tokens that don't verify can't be used, so there is
    // nothing to revoke.
    let ttlSeconds: number;
    try {
      const { payload } = await jose.jwtVerify(request.token, this.jwtSecret, {
        issuer: this.serverUrl,
        algorithms: [JWT_ALGORITHM],
      });
      const exp =
        typeof payload.exp === "number"
          ? payload.exp
          : Math.floor(Date.now() / 1000) + REFRESH_TOKEN_EXPIRES_IN;
      ttlSeconds = Math.max(exp - Math.floor(Date.now() / 1000), 60);
    } catch {
      return;
    }

    await this.stateStore.set(this.revocationKey(request.token), true, ttlSeconds);
  }

  private async isRevoked(token: string): Promise<boolean> {
    return (await this.stateStore.get<boolean>(this.revocationKey(token))) === true;
  }

  private revocationKey(token: string): string {
    // Store a digest rather than the raw token
    const digest = crypto.createHash("sha256").update(token).digest("hex");
    return `revoked:${digest}`;
  }

  private async issueTokens(
    userId: string,
    clientId: string,
    scopes: string[]
  ): Promise<OAuthTokens> {
    const now = Math.floor(Date.now() / 1000);

    // Create access token
    const accessToken = await new jose.SignJWT({
      userId,
      clientId,
      scopes,
      type: "access",
    })
      .setProtectedHeader({ alg: JWT_ALGORITHM })
      .setIssuedAt()
      .setExpirationTime(now + ACCESS_TOKEN_EXPIRES_IN)
      .setIssuer(this.serverUrl)
      .sign(this.jwtSecret);

    // Create refresh token
    const refreshToken = await new jose.SignJWT({
      userId,
      clientId,
      scopes,
      type: "refresh",
    })
      .setProtectedHeader({ alg: JWT_ALGORITHM })
      .setIssuedAt()
      .setExpirationTime(now + REFRESH_TOKEN_EXPIRES_IN)
      .setIssuer(this.serverUrl)
      .sign(this.jwtSecret);

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_EXPIRES_IN,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }

  private async verifyToken(
    token: string,
    expectedType: "access" | "refresh"
  ): Promise<{
    userId: string;
    clientId: string;
    scopes: string[];
    exp: number;
  }> {
    try {
      const { payload } = await jose.jwtVerify(token, this.jwtSecret, {
        issuer: this.serverUrl,
        algorithms: [JWT_ALGORITHM],
      });

      if (payload.type !== expectedType) {
        throw new Error(`Expected ${expectedType} token`);
      }

      return {
        userId: payload.userId as string,
        clientId: payload.clientId as string,
        scopes: payload.scopes as string[],
        exp: payload.exp as number,
      };
    } catch (error) {
      if (error instanceof jose.errors.JWTExpired) {
        throw new Error("Token expired");
      }
      throw new Error("Invalid token");
    }
  }
}

// RFC 8252 lets native clients use any loopback address, not just 127.0.0.1
// (the OS may hand out 127.0.0.2 and up). URL normalizes every IPv6 loopback
// spelling to "[::1]" and lowercases hostnames, but it preserves the trailing
// dot of a fully qualified "localhost." — strip it before comparing, otherwise
// a legitimate loopback redirect URI is rejected as non-loopback.
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  return (
    host === "localhost" ||
    host === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

// Registration is open (no authentication), and the OAuth callback redirects
// the browser to whatever redirect_uri the client registered. Only https and
// loopback http can be reasoned about as safe delivery channels, so everything
// else has to be a native app's custom scheme (cursor://, vscode://, ... per
// RFC 8252) — allowlisting the two web schemes keeps script-capable and
// fetchable schemes (javascript:, data:, blob:, file:, ftp:, ws:, ...) out
// without having to enumerate them.
const ALLOWED_CUSTOM_SCHEME = /^[a-z][a-z0-9+.-]*$/;
const RESERVED_SCHEMES = new Set([
  "javascript",
  "data",
  "blob",
  "file",
  "vbscript",
  "about",
  "view-source",
  "ftp",
  "ws",
  "wss",
  "mailto",
  "tel",
]);

function validateRedirectUris(redirectUris: string[] | undefined): void {
  if (!redirectUris || redirectUris.length === 0) {
    throw new InvalidClientMetadataError("At least one redirect_uri is required");
  }

  for (const uri of redirectUris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new InvalidClientMetadataError(`redirect_uri is not a valid URL: ${uri}`);
    }

    if (parsed.protocol === "https:") {
      continue;
    }

    if (parsed.protocol === "http:") {
      if (!isLoopbackHost(parsed.hostname)) {
        throw new InvalidClientMetadataError(
          `http redirect_uri is only allowed on loopback: ${uri}`
        );
      }
      continue;
    }

    const scheme = parsed.protocol.slice(0, -1);
    if (!ALLOWED_CUSTOM_SCHEME.test(scheme) || RESERVED_SCHEMES.has(scheme)) {
      throw new InvalidClientMetadataError(`redirect_uri scheme is not allowed: ${uri}`);
    }
  }
}

// Dynamic client registration store, backed by the shared state store so
// registrations survive restarts and are visible to all instances
class StateStoreClientsStore implements OAuthRegisteredClientsStore {
  constructor(private stateStore: IStateStore) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const key = `client:${clientId}`;
    const client = await this.stateStore.get<OAuthClientInformationFull>(key);
    if (!client) return undefined;

    // Slide the expiry forward on use. Every /token call authenticates through
    // here, so a client that keeps refreshing keeps its registration; only one
    // idle for a full refresh token lifetime is dropped.
    await this.stateStore.touch(key, CLIENT_TTL_SECONDS);

    return client;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
  ): Promise<OAuthClientInformationFull> {
    validateRedirectUris(client.redirect_uris);

    const clientId = `client_${crypto.randomUUID()}`;
    const fullClient: OAuthClientInformationFull = {
      ...client,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };

    await this.stateStore.set(`client:${clientId}`, fullClient, CLIENT_TTL_SECONDS);
    return fullClient;
  }
}

export function getUserIdFromAuth(auth: AuthInfo): string | undefined {
  return auth.extra?.userId as string | undefined;
}
