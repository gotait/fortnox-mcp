/**
 * Cloudflare Worker entry point.
 *
 * @cloudflare/workers-oauth-provider owns the OAuth 2.1 surface (/authorize,
 * /token, /register and the discovery documents) and hands authenticated
 * requests to the MCP handler with the grant's props attached. The MCP
 * protocol itself runs over WebStandardStreamableHTTPServerTransport, which
 * speaks Request/Response and so needs no Node HTTP shim.
 *
 * Every request builds a fresh McpServer and transport: the deployment is
 * stateless, so there is no session to resume and nothing to keep between
 * requests. The token provider is the one exception - it is cached per isolate
 * so that concurrent tool calls share a single Fortnox token refresh.
 */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { WorkerEntrypoint } from "cloudflare:workers";

import { DatabaseTokenProvider } from "../auth/databaseProvider.js";
import { KVTokenStorage } from "../auth/storage/kv.js";
import { initializeTokenProvider } from "../auth/registry.js";
import { runWithContext } from "../auth/context.js";
import { applyReadOnlyMode } from "../server/readOnly.js";
import { serverInfo } from "../server/identity.js";
import { registerAllTools } from "../server/tools.js";
// Only handlers may be named exports of a Worker entry module - the runtime
// treats every export as a service and rejects anything else - so constants
// from this module stay imported rather than re-exported.
import { fortnoxAuthHandler } from "./fortnoxAuthHandler.js";
import {
  getConfiguredCredentials,
  getRequestedScopes,
  type Env,
  type FortnoxProps,
} from "./env.js";

/**
 * Cached per isolate. Bindings are stable for an isolate's lifetime, so reusing
 * the provider keeps DatabaseTokenProvider's per-user refresh de-duplication
 * effective across requests instead of resetting it on every call.
 */
let cachedProvider: DatabaseTokenProvider | null = null;

function tokenProviderFor(env: Env): DatabaseTokenProvider | null {
  const credentials = getConfiguredCredentials(env);
  if (!credentials) {
    return null;
  }
  if (!cachedProvider) {
    cachedProvider = new DatabaseTokenProvider(
      new KVTokenStorage(env.FORTNOX_TOKENS),
      credentials
    );
  }
  return cachedProvider;
}

/**
 * @param baseUrl - This request's origin, so the advertised icon URL points at
 *   the host the client actually reached, whether that is workers.dev or a
 *   custom domain.
 * @param readOnly - This grant's access level, decided when the user authorized.
 *   The server is built per request, so two clients on the same deployment can
 *   see different tool surfaces.
 */
function buildServer(baseUrl: string, readOnly: boolean): McpServer {
  const server = new McpServer(serverInfo(baseUrl));

  // Must run before registration so the filter covers every tool.
  if (readOnly) {
    applyReadOnlyMode(server, "chosen at authorization");
  }

  registerAllTools(server);
  return server;
}

/**
 * The protected MCP endpoint.
 *
 * OAuthProvider has already verified the bearer token by the time this runs;
 * `this.ctx.props` holds what the authorization handler stored on the grant.
 */
export class FortnoxMcpHandler extends WorkerEntrypoint<Env, FortnoxProps> {
  async fetch(request: Request): Promise<Response> {
    const props = this.ctx.props;
    const userId = props?.userId;

    if (!userId) {
      return Response.json(
        { error: "invalid_token", error_description: "No user context" },
        { status: 401 }
      );
    }

    const provider = tokenProviderFor(this.env);
    if (!provider) {
      console.error(
        "[MCP] Not configured: FORTNOX_CLIENT_ID / FORTNOX_CLIENT_SECRET are not set"
      );
      return Response.json(
        {
          error: "server_not_configured",
          error_description:
            "The Fortnox app credentials are not set on this deployment.",
        },
        { status: 503 }
      );
    }

    initializeTokenProvider(provider);

    // The grant is the only input. Only an explicit `false` means write access:
    // a grant issued before the access-level choice existed carries no flag, and
    // is read as read-only rather than assumed to be write-capable.
    const readOnly = props?.readOnly !== false;

    const server = buildServer(new URL(request.url).origin, readOnly);
    const transport = new WebStandardStreamableHTTPServerTransport({
      // Stateless: no session id, and JSON responses rather than SSE streams,
      // which suits a Worker that does not hold connections open.
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);

    try {
      return await runWithContext({ userId }, () =>
        transport.handleRequest(request)
      );
    } finally {
      // Release the per-request server/transport pair rather than leaving it
      // attached to the isolate.
      await transport.close().catch(() => {});
    }
  }
}

/**
 * Cached per isolate for the same reason as the token provider: bindings are
 * stable for an isolate's lifetime.
 *
 * Built lazily rather than at module scope because the advertised scopes have to
 * match what authorization actually requests, and that depends on env - a
 * deployment that narrows FORTNOX_SCOPES must not keep advertising the full set
 * in its discovery document.
 */
let cachedOAuthProvider: OAuthProvider<Env> | null = null;

function oauthProviderFor(env: Env): OAuthProvider<Env> {
  if (!cachedOAuthProvider) {
    cachedOAuthProvider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: FortnoxMcpHandler,
      defaultHandler: fortnoxAuthHandler,

      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",

      scopesSupported: getRequestedScopes(env),
    });
  }
  return cachedOAuthProvider;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return oauthProviderFor(env).fetch(request, env, ctx);
  },
};
