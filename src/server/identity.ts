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

/**
 * Build the icon list for a deployment.
 *
 * Two forms, because the transports differ in what they can offer:
 *
 * - An HTTP deployment passes its own origin and advertises an absolute URL.
 *   The icon is then same-origin with the server, which is what clients are
 *   told to prefer, it is cached by the client, and it stays out of every
 *   initialize response.
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
    icons: serverIcons(baseUrl),
  };
}
