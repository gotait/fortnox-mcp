import express, { Express, Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";

import {
  FortnoxProxyOAuthProvider,
  getUserIdFromAuth,
  initializeTokenProvider,
} from "../auth/index.js";
import { runWithContext } from "../auth/context.js";
import { isReadOnlyMode, applyReadOnlyMode } from "./readOnly.js";
import { ICON_MIME_TYPE, ICON_PATH, iconPngBytes } from "./icon.js";
import { serverInfo } from "./identity.js";
import { registerAllTools } from "./tools.js";
import { registerAppResources } from "../apps/index.js";
import { ITokenStorage } from "../auth/storage/types.js";

export interface RemoteServerOptions {
  serverUrl: string;
  jwtSecret: string;
  tokenStorage: ITokenStorage;
  port?: number;
}

export function createRemoteServer(options: RemoteServerOptions): Express {
  const { serverUrl, jwtSecret, tokenStorage } = options;

  const oauthProvider = new FortnoxProxyOAuthProvider(
    jwtSecret,
    serverUrl,
    tokenStorage
  );

  initializeTokenProvider(oauthProvider.getTokenProvider());

  const app = express();
  app.use(express.json());

  // Trust proxy headers (for Vercel, etc.)
  app.set("trust proxy", 1);

  // Health check endpoint (no auth required)
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: "fortnox-mcp-server",
      mode: "remote",
    });
  });

  // Public: clients fetch the icon while deciding whether to authorize, so it
  // cannot sit behind the bearer-token check.
  app.get(ICON_PATH, (_req, res) => {
    res
      .type(ICON_MIME_TYPE)
      .set("Cache-Control", "public, max-age=86400")
      .send(Buffer.from(iconPngBytes()));
  });

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(serverUrl),
      scopesSupported: ["fortnox:read", "fortnox:write"],
      resourceName: "Fortnox MCP Server",
    })
  );

  // Fortnox OAuth callback handler
  app.get("/oauth/fortnox/callback", async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query;

      if (error) {
        console.error(`[OAuth] Fortnox error: ${error} - ${error_description}`);
        res.status(400).type("text").send(`OAuth error: ${error_description || error}`);
        return;
      }

      if (!code || !state) {
        res.status(400).type("text").send("Missing code or state parameter");
        return;
      }

      const result = await oauthProvider.handleFortnoxCallback(
        code as string,
        state as string
      );

      // Redirect back to Claude with our authorization code
      const redirectUrl = new URL(result.redirectUri);
      redirectUrl.searchParams.set("code", result.code);
      if (result.state) {
        redirectUrl.searchParams.set("state", result.state);
      }

      res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error("[OAuth] Callback error:", error);
      res.status(500).type("text").send("OAuth callback failed");
    }
  });

  /**
   * A fresh server per request.
   *
   * The SDK's Protocol.connect() throws "Already connected to a transport"
   * while a transport is still attached, and closing that transport aborts
   * every in-flight request handler on the server. Sharing one McpServer
   * across requests therefore fails the second concurrent request outright
   * and takes the first one down with it. The deployment is stateless, so
   * building the pair per request costs only tool registration.
   */
  function buildServer(): McpServer {
    const server = new McpServer(serverInfo(serverUrl));

    // Must run before registration so the filter covers every tool.
    if (isReadOnlyMode()) {
      applyReadOnlyMode(server);
    }

    registerAllTools(server);
    registerAppResources(server);
    return server;
  }

  // Protected MCP endpoint
  app.post(
    "/mcp",
    requireBearerAuth({
      verifier: oauthProvider,
      resourceMetadataUrl: `${serverUrl}/.well-known/oauth-protected-resource`,
    }),
    async (req: Request, res: Response) => {
      try {
        const userId = req.auth ? getUserIdFromAuth(req.auth) : undefined;

        if (!userId) {
          res.status(401).json({ error: "No user context" });
          return;
        }

        const mcpServer = buildServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        // Covers a client that disconnects mid-handling; the finally below
        // handles the normal path. close() is idempotent.
        res.on("close", () => {
          void transport.close().catch(() => {});
        });

        await mcpServer.connect(transport);

        try {
          await runWithContext({ userId }, () =>
            transport.handleRequest(req, res, req.body)
          );
        } finally {
          // Release this request's pair instead of leaving it attached.
          await transport.close().catch(() => {});
        }
      } catch (error) {
        console.error("[MCP] Request error:", error);
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error" });
        }
      }
    }
  );

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Server] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

export async function runRemoteServer(options: RemoteServerOptions): Promise<void> {
  const app = createRemoteServer(options);
  const port = options.port || parseInt(process.env.PORT || "3000", 10);

  app.listen(port, () => {
    console.error(`[FortnoxMCP] Remote server: http://localhost:${port}`);
  });
}
