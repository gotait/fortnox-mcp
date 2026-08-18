/**
 * How this server introduces itself in the MCP initialize response.
 *
 * Kept in one place because there are three entry points - stdio, the Node
 * remote server and the Worker - and they had already drifted apart on the
 * version number. A client that reconnects to a different deployment should see
 * the same server, icon included.
 */

import type { Icon, Implementation } from "@modelcontextprotocol/sdk/types.js";

import { ICON_DATA_URI, ICON_MIME_TYPE, ICON_PATH, ICON_SIZE } from "./icon.js";

/** Programmatic identifier. Stable; clients may key configuration off it. */
export const SERVER_NAME = "fortnox-mcp-server";

/** Display name, shown next to the icon. */
export const SERVER_TITLE = "Fortnox";

export const SERVER_VERSION = "1.0.1";

/** One line about the server, alongside the name in a client's UI. */
export const SERVER_DESCRIPTION =
  "MCP server for the Fortnox Swedish accounting API";

/**
 * Where a user can find out what this server is.
 *
 * The repository rather than fortnox.se: this is an integration with Fortnox,
 * not something Fortnox publishes.
 */
export const SERVER_WEBSITE_URL = "https://github.com/gotait/fortnox-mcp";

/**
 * Build the icon list for a deployment.
 *
 * Two forms, because the transports differ in what they can offer:
 *
 * - An HTTP deployment passes its own origin and advertises an absolute URL.
 *   Same-origin matters: the spec tells clients to "verify that icon URIs are
 *   from the same origin as the server", so a URL on some other host (a CDN, a
 *   raw.githubusercontent link) is one a strict client may refuse. The bytes are
 *   also cached by the client and stay out of every handshake. The route serving
 *   them must stay unauthenticated, because clients fetch icons "without
 *   credentials" - behind the bearer check it would never load.
 * - stdio has no origin to serve from, so the PNG travels inline as a data URI.
 *   That is ~11 KB once per session.
 */
function serverIcons(baseUrl?: string): Icon[] {
  return [
    {
      src: baseUrl ? new URL(ICON_PATH, baseUrl).toString() : ICON_DATA_URI,
      mimeType: ICON_MIME_TYPE,
      sizes: [ICON_SIZE],
    },
  ];
}

/**
 * @param baseUrl - Origin of an HTTP deployment that serves {@link ICON_PATH}.
 *   Omit for stdio, which inlines the icon instead.
 */
export function serverInfo(baseUrl?: string): Implementation {
  return {
    name: SERVER_NAME,
    title: SERVER_TITLE,
    version: SERVER_VERSION,
    description: SERVER_DESCRIPTION,
    websiteUrl: SERVER_WEBSITE_URL,
    icons: serverIcons(baseUrl),
  };
}
