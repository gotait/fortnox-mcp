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
import { registerAllTools } from "../server/tools.js";
import { FORTNOX_SCOPES } from "../auth/credentials.js";
// Only handlers may be named exports of a Worker entry module - the runtime
// treats every export as a service and rejects anything else - so constants
// from this module stay imported rather than re-exported.
import { fortnoxAuthHandler } from "./fortnoxAuthHandler.js";
import type { Env, FortnoxProps } from "./env.js";

const SERVER_VERSION = "1.0.1";

/**
 * Cached per isolate. Bindings are stable for an isolate's lifetime, so reusing
 * the provider keeps DatabaseTokenProvider's per-user refresh de-duplication
 * effective across requests instead of resetting it on every call.
 */
let cachedProvider: DatabaseTokenProvider | null = null;

function tokenProviderFor(env: Env): DatabaseTokenProvider {
  if (!cachedProvider) {
    cachedProvider = new DatabaseTokenProvider(
      new KVTokenStorage(env.FORTNOX_TOKENS),
      {
        clientId: env.FORTNOX_CLIENT_ID,
        clientSecret: env.FORTNOX_CLIENT_SECRET,
      }
    );
  }
  return cachedProvider;
}

function buildServer(env: Env): McpServer {
  const server = new McpServer({
    name: "fortnox-mcp-server",
    version: SERVER_VERSION,
  });

  // Must run before registration so the filter covers every tool.
  if (env.FORTNOX_READ_ONLY === "true") {
    applyReadOnlyMode(server);
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
    const userId = this.ctx.props?.userId;

    if (!userId) {
      return Response.json(
        { error: "invalid_token", error_description: "No user context" },
        { status: 401 }
      );
    }

    initializeTokenProvider(tokenProviderFor(this.env));

    const server = buildServer(this.env);
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

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: FortnoxMcpHandler,
  defaultHandler: fortnoxAuthHandler,

  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",

  scopesSupported: FORTNOX_SCOPES,
});
