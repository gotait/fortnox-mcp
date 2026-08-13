/**
 * Fortnox authorization handler.
 *
 * This is the `defaultHandler` behind @cloudflare/workers-oauth-provider: the
 * library is the OAuth *server* the MCP client talks to, and this handler is
 * the OAuth *client* that talks to Fortnox. Two legs:
 *
 *   /authorize                 MCP client arrives -> redirect to Fortnox
 *   /oauth/fortnox/callback    Fortnox returns -> mint a grant, redirect back
 *
 * The MCP client never sees a Fortnox token. It receives a token minted by the
 * OAuth library, whose props carry only the user id used to look the Fortnox
 * credentials up in KV.
 */

import {
  AuthorizationError,
  type AuthRequest,
} from "@cloudflare/workers-oauth-provider";

import { DatabaseTokenProvider } from "../auth/databaseProvider.js";
import { KVTokenStorage } from "../auth/storage/kv.js";
import { FORTNOX_SCOPES } from "../auth/credentials.js";
import type { Env } from "./env.js";

/** Path Fortnox redirects back to. Must match the app's registered redirect URI. */
export const FORTNOX_CALLBACK_PATH = "/oauth/fortnox/callback";

/** How long a user has to complete the Fortnox consent screen. */
const PENDING_AUTH_TTL_SECONDS = 10 * 60;

const PENDING_PREFIX = "pending_auth:";

/**
 * The MCP client's authorization request, parked while the user is at Fortnox.
 *
 * It is held server-side rather than packed into the `state` parameter so that
 * nothing the client sent can be tampered with in transit, and so `state`
 * stays an opaque single-use nonce.
 */
interface PendingAuthorization {
  authRequest: AuthRequest;
  createdAt: number;
}

function tokenProviderFor(env: Env): DatabaseTokenProvider {
  return new DatabaseTokenProvider(new KVTokenStorage(env.FORTNOX_TOKENS), {
    clientId: env.FORTNOX_CLIENT_ID,
    clientSecret: env.FORTNOX_CLIENT_SECRET,
  });
}

function callbackUri(request: Request): string {
  return new URL(FORTNOX_CALLBACK_PATH, new URL(request.url).origin).toString();
}

function errorResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Relay an authorization failure to the client's redirect URI when the library
 * has told us it is safe to do so, and render it locally otherwise.
 *
 * An unvalidated redirect target is an open redirect, so `error.redirectUri`
 * being absent is the signal to keep the response here.
 */
function authorizationErrorResponse(error: AuthorizationError): Response {
  if (!error.redirectUri) {
    return errorResponse(error.description, 400);
  }

  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return Response.redirect(redirect.toString(), 302);
}

/** GET /authorize - hand the user off to Fortnox. */
async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  let authRequest: AuthRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authorizationErrorResponse(error);
    }
    throw error;
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  if (!client) {
    return errorResponse("Unknown OAuth client", 400);
  }

  // Single-use nonce tying the Fortnox round trip back to this request.
  const state = crypto.randomUUID();
  const pending: PendingAuthorization = {
    authRequest,
    createdAt: Date.now(),
  };

  await env.FORTNOX_TOKENS.put(
    `${PENDING_PREFIX}${state}`,
    JSON.stringify(pending),
    { expirationTtl: PENDING_AUTH_TTL_SECONDS }
  );

  const authorizationUrl = tokenProviderFor(env).getAuthorizationUrl(
    callbackUri(request),
    FORTNOX_SCOPES,
    state
  );

  return Response.redirect(authorizationUrl, 302);
}

/** GET /oauth/fortnox/callback - exchange the code and complete the grant. */
async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    const description = url.searchParams.get("error_description") || error;
    return errorResponse(`Fortnox authorization failed: ${description}`, 400);
  }

  if (!code || !state) {
    return errorResponse("Missing code or state parameter", 400);
  }

  const pendingKey = `${PENDING_PREFIX}${state}`;
  const pending = (await env.FORTNOX_TOKENS.get(pendingKey, {
    type: "json",
  })) as PendingAuthorization | null;

  if (!pending) {
    return errorResponse(
      "Authorization request expired or already used. Please start again.",
      400
    );
  }

  // Burn the nonce before doing any work, so a replayed callback cannot mint a
  // second grant from the same state.
  await env.FORTNOX_TOKENS.delete(pendingKey);

  // Opaque per-grant identity. Fortnox issues no stable user identifier here,
  // and the tokens are what actually scope access, so a fresh id per
  // authorization keeps one user's credentials out of another's grant.
  const userId = crypto.randomUUID();

  try {
    await tokenProviderFor(env).exchangeAuthorizationCode(
      code,
      callbackUri(request),
      userId
    );
  } catch (exchangeError) {
    const message =
      exchangeError instanceof Error
        ? exchangeError.message
        : String(exchangeError);
    console.error("[OAuth] Fortnox code exchange failed:", message);
    return errorResponse("Failed to complete Fortnox authorization", 502);
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: pending.authRequest,
    userId,
    metadata: { provider: "fortnox" },
    scope: pending.authRequest.scope,
    props: { userId },
  });

  return Response.redirect(redirectTo, 302);
}

export const fortnoxAuthHandler: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/authorize") {
      return handleAuthorize(request, env);
    }

    if (request.method === "GET" && url.pathname === FORTNOX_CALLBACK_PATH) {
      return handleCallback(request, env);
    }

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        server: "fortnox-mcp-server",
        mode: "cloudflare-worker",
      });
    }

    return errorResponse("Not found", 404);
  },
};
