#!/usr/bin/env npx tsx
/**
 * Fortnox OAuth2 Token Helper
 *
 * This script helps you obtain a refresh token through the OAuth2 flow.
 *
 * Usage:
 *   1. Run: npx tsx scripts/get-token.ts
 *   2. Open the URL in your browser
 *   3. Authorize the app in Fortnox
 *   4. Copy the authorization code from the redirect URL
 *   5. Paste it when prompted
 *   6. Save the refresh token to your environment
 */

import http from "http";
import crypto from "crypto";
import { URL } from "url";
import readline from "readline";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} must be set in your environment.`);
    console.error("Register an app at https://developer.fortnox.se to get your credentials.");
    process.exit(1);
  }
  return value;
}

const CLIENT_ID = requireEnv("FORTNOX_CLIENT_ID");
const CLIENT_SECRET = requireEnv("FORTNOX_CLIENT_SECRET");
const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const OAUTH_STATE = crypto.randomBytes(16).toString("hex");
const AUTH_TIMEOUT_MS = 10 * 60 * 1000;

const SCOPES = [
  "customer",
  "invoice",
  "supplier",
  "bookkeeping",
  "companyinformation"
];

async function getAuthorizationCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    // Ignoring callbacks whose state does not match is the right call, but on
    // its own it can leave the script sitting at "Waiting for authorization..."
    // forever — e.g. if the authorization server drops `state` on its error
    // redirect. Bound the wait and report why it ended.
    const timer = setTimeout(() => {
      console.error(
        `\nTimed out after ${AUTH_TIMEOUT_MS / 60000} minutes waiting for the Fortnox callback.`
      );
      server.close();
      reject(new Error("Timed out waiting for authorization"));
    }, AUTH_TIMEOUT_MS);

    const finish = (fn: () => void): void => {
      clearTimeout(timer);
      fn();
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "", `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== "/callback") {
        // Always answer: an unanswered request (a favicon fetch, a stray probe)
        // leaves the browser spinning on a connection that is never closed.
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const state = url.searchParams.get("state");

      // Verify state before acting on anything else, so an unrelated request
      // to this port (any page the browser has open can send one) can't abort
      // the flow by passing ?error=...
      if (state !== OAUTH_STATE) {
        // Not the callback we initiated — ignore it and keep waiting. Say so
        // on the terminal too, so the user is not left guessing why nothing
        // happened after they authorized in the browser.
        console.error(
          `Ignored a /callback request with a ${state === null ? "missing" : "mismatched"} state parameter.`
        );
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("State mismatch: this response does not belong to the flow started by this script.");
        return;
      }

      if (error) {
        // Plain text so attacker-influenced params can't be interpreted as HTML
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(`OAuth error: ${error}\n${url.searchParams.get("error_description") || ""}`);
        finish(() => {
          reject(new Error(error));
          server.close();
        });
        return;
      }

      // State matched but the response carries neither a code nor an error:
      // nothing to act on, and leaving it unanswered would hang the browser.
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Callback contained neither an authorization code nor an error.");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>✓ Authorization Successful!</h1>
            <p>You can close this window and return to the terminal.</p>
            <p style="color: #666;">Authorization code received.</p>
          </body>
        </html>
      `);
      finish(() => {
        resolve(code);
        setTimeout(() => server.close(), 1000);
      });
    });

    server.listen(REDIRECT_PORT, () => {
      const authUrl = new URL("https://apps.fortnox.se/oauth-v1/auth");
      authUrl.searchParams.set("client_id", CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("scope", SCOPES.join(" "));
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("state", OAUTH_STATE);

      console.log("\n╔════════════════════════════════════════════════════════════╗");
      console.log("║           FORTNOX OAUTH2 AUTHORIZATION                      ║");
      console.log("╚════════════════════════════════════════════════════════════╝\n");
      console.log("Step 1: Open this URL in your browser:\n");
      console.log(`  ${authUrl.toString()}\n`);
      console.log("Step 2: Log in to Fortnox and authorize the application\n");
      console.log("Step 3: You will be redirected back here automatically\n");
      console.log("Waiting for authorization...\n");
    });

    server.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        console.error(`Port ${REDIRECT_PORT} is already in use. Please close other applications using it.`);
      }
      finish(() => reject(err));
    });
  });
}

async function exchangeCodeForTokens(code: string): Promise<{ access_token: string; refresh_token: string }> {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const response = await fetch("https://apps.fortnox.se/oauth-v1/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: REDIRECT_URI
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

async function main() {
  try {
    console.log("Starting OAuth2 authorization flow...\n");

    const code = await getAuthorizationCode();
    console.log("✓ Authorization code received\n");

    console.log("Exchanging code for tokens...\n");
    const tokens = await exchangeCodeForTokens(code);

    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║                    SUCCESS!                                 ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    console.log("Add this to your environment (FORTNOX_CLIENT_ID and");
    console.log("FORTNOX_CLIENT_SECRET are already set):\n");
    console.log("─────────────────────────────────────────────────────────────");
    console.log(`export FORTNOX_REFRESH_TOKEN="${tokens.refresh_token}"`);
    console.log("─────────────────────────────────────────────────────────────\n");

    console.log("Or add to Claude Desktop config:\n");
    console.log(JSON.stringify({
      "env": {
        "FORTNOX_CLIENT_ID": CLIENT_ID,
        "FORTNOX_CLIENT_SECRET": "<your FORTNOX_CLIENT_SECRET>",
        "FORTNOX_REFRESH_TOKEN": tokens.refresh_token
      }
    }, null, 2));

    console.log("\n✓ Done! You can now use the Fortnox MCP server.\n");

  } catch (error) {
    console.error("\n✗ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
