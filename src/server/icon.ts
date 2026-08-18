/**
 * The server's icon: the Fortnox mark, 128x128 PNG.
 *
 * The bytes live here as base64 rather than as a file read at runtime, because
 * the same module has to work in three places that cannot all read from disk:
 * the stdio process, the Node HTTP server, and a Cloudflare Worker.
 *
 * Regenerate from assets/fortnox-icon-128.png with:
 *
 *   sips -Z 128 <source>.png --out assets/fortnox-icon-128.png
 *   base64 -i assets/fortnox-icon-128.png
 *
 * The Fortnox name and mark are trademarks of Fortnox AB. They appear here to
 * identify which service this server connects to; this is not an official
 * Fortnox product.
 */

/** Path the HTTP deployments serve the icon from. */
export const ICON_PATH = "/icon.png";

export const ICON_MIME_TYPE = "image/png";

/** Dimensions of the encoded PNG, in the `WxH` form the MCP icon schema wants. */
export const ICON_SIZE = "128x128";

const ICON_PNG_BASE64 = [
  "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",
  "hrQ18e7DAAAAAElFTkSuQmCC"
].join("");

/** Self-contained form, for transports with no HTTP origin to serve from. */
export const ICON_DATA_URI = `data:${ICON_MIME_TYPE};base64,${ICON_PNG_BASE64}`;

let decoded: Uint8Array | undefined;

/**
 * The raw PNG bytes.
 *
 * Decoded once per isolate and cached: an icon is requested far more often than
 * it changes, and on a Worker this runs on the request path.
 */
export function iconPngBytes(): Uint8Array {
  if (!decoded) {
    const binary = atob(ICON_PNG_BASE64);
    decoded = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  return decoded;
}
