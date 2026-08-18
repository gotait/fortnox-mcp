/**
 * Fortnox authorization handler.
 *
 * This is the `defaultHandler` behind @cloudflare/workers-oauth-provider: the
 * library is the OAuth *server* the MCP client talks to, and this handler is
 * the OAuth *client* that talks to Fortnox. Two legs:
 *
 *   /authorize                 MCP client arrives -> ask for an access level
 *   /authorize/mode            user picks -> redirect to Fortnox
 *   /oauth/fortnox/callback    Fortnox returns -> mint a grant, redirect back
 *
 * The access level is chosen here rather than set per deployment, so one host
 * can serve a customer who only wants reads alongside one who wants writes.
 * There is no deployment-wide override: the grant is the only thing that
 * decides, which keeps one place to look when asking what a client can do.
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
import { ICON_MIME_TYPE, ICON_PATH, iconPngBytes } from "../server/icon.js";
import {
  MODE_PATH,
  accessLevelPage,
  errorPage,
  fortnoxCallbackGuidance,
  type ErrorGuidance,
} from "./pages.js";
import {
  getConfiguredCredentials,
  getRequestedScopes,
  type Env,
} from "./env.js";

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
  /**
   * The access level the user picked, recorded before they leave for Fortnox.
   * Absent until they pick, and read as read-only if it somehow stays absent.
   */
  readOnly?: boolean;
}

/** Thrown when the Worker's Fortnox secrets have not been configured. */
class NotConfiguredError extends Error {}

function tokenProviderFor(env: Env): DatabaseTokenProvider {
  const credentials = getConfiguredCredentials(env);
  if (!credentials) {
    throw new NotConfiguredError(
      "FORTNOX_CLIENT_ID and FORTNOX_CLIENT_SECRET are not set"
    );
  }
  return new DatabaseTokenProvider(
    new KVTokenStorage(env.FORTNOX_TOKENS),
    credentials
  );
}

function callbackUri(request: Request): string {
  return new URL(FORTNOX_CALLBACK_PATH, new URL(request.url).origin).toString();
}

/** Where the user goes once the access level is settled. */
function fortnoxAuthorizationUrl(request: Request, env: Env, state: string): string {
  return tokenProviderFor(env).getAuthorizationUrl(
    callbackUri(request),
    getRequestedScopes(env),
    state
  );
}

function pendingKeyFor(state: string): string {
  return `${PENDING_PREFIX}${state}`;
}

async function putPending(
  env: Env,
  state: string,
  pending: PendingAuthorization
): Promise<void> {
  await env.FORTNOX_TOKENS.put(pendingKeyFor(state), JSON.stringify(pending), {
    expirationTtl: PENDING_AUTH_TTL_SECONDS,
  });
}

async function getPending(
  env: Env,
  state: string
): Promise<PendingAuthorization | null> {
  return (await env.FORTNOX_TOKENS.get(pendingKeyFor(state), {
    type: "json",
  })) as PendingAuthorization | null;
}

/**
 * Render a failure to the browser.
 *
 * Everything that reaches this point is being read by a person part-way through
 * connecting their accounting system, so each case says what happened and what
 * they can do about it rather than returning a bare status line.
 */
function errorResponse(
  env: Env,
  guidance: ErrorGuidance,
  technical?: string
): Response {
  return errorPage(guidance, technical, env.SUPPORT_EMAIL);
}

/**
 * Relay an authorization failure to the client's redirect URI when the library
 * has told us it is safe to do so, and render it locally otherwise.
 *
 * An unvalidated redirect target is an open redirect, so `error.redirectUri`
 * being absent is the signal to keep the response here.
 */
function authorizationErrorResponse(env: Env, error: AuthorizationError): Response {
  if (!error.redirectUri) {
    return errorResponse(
      env,
      {
        title: "Anslutningen kunde inte startas",
        explanation:
          "Appens begäran om åtkomst godtogs inte, så vi kom aldrig vidare till Fortnox.",
        steps: ["Starta anslutningen på nytt från appen."],
        status: 400,
      },
      `${error.code}: ${error.description}`
    );
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
      return authorizationErrorResponse(env, error);
    }
    throw error;
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  if (!client) {
    return errorResponse(env, {
      title: "Appen är inte registrerad här",
      explanation:
        "Anslutningen kom från en app som den här servern inte känner igen, så vi kan inte fortsätta.",
      steps: ["Starta anslutningen på nytt från appen."],
      status: 400,
    });
  }

  // Single-use nonce tying the Fortnox round trip back to this request.
  const state = crypto.randomUUID();

  // No access level yet: the /authorize/mode POST fills it in from what the
  // user picks, and the callback reads a still-absent choice as read-only.
  await putPending(env, state, { authRequest, createdAt: Date.now() });

  return accessLevelPage(state, client.clientName);
}

/** POST /authorize/mode - record the access level, then hand off to Fortnox. */
async function handleModeSelection(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(env, {
      title: "Valet kunde inte läsas",
      explanation: "Formuläret med åtkomstnivån gick inte att tolka.",
      steps: ["Starta anslutningen på nytt från appen."],
      status: 400,
    });
  }

  const state = form.get("state");
  if (typeof state !== "string" || !state) {
    return errorResponse(env, {
      title: "Valet kunde inte kopplas till din anslutning",
      explanation:
        "Formuläret saknade den referens som binder ditt val till pågående anslutning.",
      steps: ["Starta anslutningen på nytt från appen."],
      status: 400,
    });
  }

  // The pending record is the only proof this state belongs to a real
  // authorization; a forged or expired one gets no further.
  const pending = await getPending(env, state);
  if (!pending) {
    return errorResponse(env, {
      title: "Anslutningen tog för lång tid",
      explanation:
        "Förfrågan har gått ut eller är redan använd. Av säkerhetsskäl gäller den i tio minuter " +
        "och bara en gång.",
      steps: ["Starta anslutningen på nytt från appen."],
      status: 400,
    });
  }

  // Only an explicit choice of full access grants it. A missing, unexpected or
  // tampered value lands on read-only.
  const readOnly = form.get("mode") !== "full";

  // Re-put rather than mutate: KV holds JSON, and this also refreshes the TTL
  // so the Fortnox leg gets its full window from the moment of the choice.
  await putPending(env, state, { ...pending, readOnly });

  return Response.redirect(fortnoxAuthorizationUrl(request, env, state), 302);
}

/** GET /oauth/fortnox/callback - exchange the code and complete the grant. */
async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    const description = url.searchParams.get("error_description") || error;
    const guidance = fortnoxCallbackGuidance(error, description);
    console.error(`[OAuth] Fortnox returned ${error}: ${description}`);
    return errorResponse(env, guidance, `${error}: ${description}`);
  }

  if (!code || !state) {
    return errorResponse(env, {
      title: "Ofullständigt svar från Fortnox",
      explanation:
        "Fortnox skickade tillbaka dig utan de uppgifter som behövs för att slutföra anslutningen.",
      steps: ["Starta anslutningen på nytt från appen."],
      status: 400,
    });
  }

  const pending = await getPending(env, state);

  if (!pending) {
    return errorResponse(env, {
      title: "Anslutningen tog för lång tid",
      explanation:
        "Förfrågan har gått ut eller är redan använd. Av säkerhetsskäl gäller den i tio minuter " +
        "och bara en gång.",
      steps: ["Starta anslutningen på nytt från appen."],
      status: 400,
    });
  }

  // Burn the nonce before doing any work, so a replayed callback cannot mint a
  // second grant from the same state.
  await env.FORTNOX_TOKENS.delete(pendingKeyFor(state));

  // A record that never went through /authorize/mode has no choice on it, so
  // read-only is the reading.
  const readOnly = pending.readOnly !== false;

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
    return errorResponse(
      env,
      {
        title: "Kunde inte slutföra anslutningen mot Fortnox",
        explanation:
          "Inloggningen gick igenom, men utbytet av behörigheten mot Fortnox misslyckades. Ingen " +
          "åtkomst har sparats.",
        steps: ["Försök ansluta igen om en liten stund."],
        status: 502,
      },
      message
    );
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: pending.authRequest,
    userId,
    metadata: { provider: "fortnox", readOnly },
    scope: pending.authRequest.scope,
    props: { userId, readOnly },
  });

  return Response.redirect(redirectTo, 302);
}

export const fortnoxAuthHandler: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/authorize") {
        return await handleAuthorize(request, env);
      }

      if (request.method === "POST" && url.pathname === MODE_PATH) {
        return await handleModeSelection(request, env);
      }

      if (request.method === "GET" && url.pathname === FORTNOX_CALLBACK_PATH) {
        return await handleCallback(request, env);
      }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        console.error(`[OAuth] Not configured: ${error.message}`);
        return errorResponse(env, {
          title: "Servern är inte färdigkonfigurerad",
          explanation:
            "Fortnox-appens uppgifter saknas på den här servern, så ingen anslutning kan göras än.",
          footnote:
            "Till dig som driftar servern: sätt hemligheterna med " +
            "<code>wrangler secret put FORTNOX_CLIENT_ID</code> och " +
            "<code>wrangler secret put FORTNOX_CLIENT_SECRET</code>.",
          status: 503,
        });
      }
      throw error;
    }

    // Unauthenticated on purpose: a client renders the icon before it holds a
    // token, and the bytes are public branding either way.
    if (request.method === "GET" && url.pathname === ICON_PATH) {
      return new Response(iconPngBytes(), {
        headers: {
          "Content-Type": ICON_MIME_TYPE,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        server: "fortnox-mcp-server",
        mode: "cloudflare-worker",
      });
    }

    return errorResponse(env, {
      title: "Sidan finns inte",
      explanation: "Den här adressen hör inte till anslutningsflödet.",
      status: 404,
    });
  },
};
