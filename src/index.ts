#!/usr/bin/env node
/**
 * Fortnox MCP Server
 *
 * An MCP server for integrating with the Fortnox Swedish accounting system.
 * Provides tools for managing invoices, customers, suppliers, accounts, and vouchers.
 *
 * Supports two modes:
 *
 * LOCAL MODE (default):
 *   Run with npx, users provide their own refresh token
 *   - FORTNOX_CLIENT_ID: Fortnox app client ID (can be embedded)
 *   - FORTNOX_CLIENT_SECRET: Fortnox app client secret (can be embedded)
 *   - FORTNOX_REFRESH_TOKEN: User's OAuth2 refresh token
 *   - TRANSPORT: 'stdio' (default) or 'http'
 *   - PORT: HTTP server port (default: 3000)
 *
 * REMOTE MODE (AUTH_MODE=remote):
 *   Hosted server with OAuth flow
 *   - AUTH_MODE: Set to 'remote'
 *   - SERVER_URL: Public URL of the server
 *   - JWT_SECRET: Secret for signing JWT tokens
 *   - UPSTASH_REDIS_REST_URL: Redis URL for token storage
 *   - UPSTASH_REDIS_REST_TOKEN: Redis token
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { loadConfig, validateEnvironment, logConfig } from "./config.js";
import { getFortnoxAuth } from "./services/auth.js";
import { getStorageFromEnv } from "./auth/storage/index.js";
import { runRemoteServer } from "./server/remote.js";
import { isReadOnlyMode, applyReadOnlyMode } from "./server/readOnly.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerInvoiceTools } from "./tools/invoices.js";
import { registerSupplierTools } from "./tools/suppliers.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerVoucherTools } from "./tools/vouchers.js";
import { registerCompanyTools } from "./tools/company.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerSupplierInvoiceTools } from "./tools/supplierInvoices.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerBIAnalyticsTools } from "./tools/biAnalytics.js";

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "fortnox-mcp-server",
    version: "1.0.0"
  });

  if (isReadOnlyMode()) {
    applyReadOnlyMode(server);
  }

  registerCustomerTools(server);
  registerInvoiceTools(server);
  registerSupplierTools(server);
  registerSupplierInvoiceTools(server);
  registerAccountTools(server);
  registerVoucherTools(server);
  registerCompanyTools(server);
  registerAnalyticsTools(server);
  registerOrderTools(server);
  registerBIAnalyticsTools(server);

  return server;
}

async function runStdio(): Promise<void> {
  try {
    const auth = getFortnoxAuth();
    if (!auth.isAuthenticated()) {
      throw new Error("FORTNOX_REFRESH_TOKEN not set");
    }
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runLocalHTTP(): Promise<void> {
  try {
    const auth = getFortnoxAuth();
    if (!auth.isAuthenticated()) {
      throw new Error("FORTNOX_REFRESH_TOKEN not set");
    }
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const server = createMcpServer();
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "fortnox-mcp-server", mode: "local-http" });
  });

  // MCP endpoint
  app.post("/mcp", async (req, res) => {
    // Create new transport for each request (stateless)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    res.on("close", () => transport.close());

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  // The local HTTP transport has no authentication, so only bind beyond
  // loopback when explicitly requested via HOST.
  const host = process.env.HOST || "127.0.0.1";
  app.listen(port, host, () => {
    console.error(`[FortnoxMCP] http://${formatHostForUrl(host)}:${port}/mcp`);
    if (!isLoopbackBindAddress(host)) {
      console.error(
        `[FortnoxMCP] WARNING: /mcp has no authentication and is reachable by anyone who can connect to ${host}:${port}`
      );
    }
  });
}

// Any address in 127.0.0.0/8 and the IPv6 loopback are unreachable from other
// machines, so binding to them is as safe as the 127.0.0.1 default. Matching
// only the two literal strings warned about "HOST=::1" as if it were exposed.
function isLoopbackBindAddress(host: string): boolean {
  return (
    host === "localhost" ||
    host === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

// "0.0.0.0" and "::" are bind addresses, not connectable ones, and a bare IPv6
// address needs brackets in a URL — neither is something the user can paste.
function formatHostForUrl(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return "localhost";
  }
  return host.includes(":") ? `[${host}]` : host;
}

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    validateEnvironment(config);
    logConfig(config);

    if (config.authMode === "remote") {
      // Remote mode: OAuth with token storage
      const tokenStorage = getStorageFromEnv();
      await runRemoteServer({
        serverUrl: config.serverUrl!,
        jwtSecret: config.jwtSecret!,
        tokenStorage,
        port: config.port,
      });
    } else if (config.transport === "http") {
      // Local HTTP mode (no OAuth, uses env vars)
      await runLocalHTTP();
    } else {
      // Local stdio mode (default)
      await runStdio();
    }
  } catch (error) {
    console.error("Server error:", error);
    process.exit(1);
  }
}

main();
