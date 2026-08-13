import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/**
 * Bindings and secrets available to the Worker.
 *
 * OAUTH_KV and OAUTH_PROVIDER are supplied by @cloudflare/workers-oauth-provider
 * (the binding name OAUTH_KV is fixed by the library). FORTNOX_TOKENS is this
 * server's own namespace, holding the upstream Fortnox tokens keyed by the user
 * id minted during authorization.
 */
export interface Env {
  /** Grants, authorization codes and issued tokens. Owned by the OAuth library. */
  OAUTH_KV: KVNamespace;
  /** Fortnox access/refresh tokens, plus short-lived pending-authorization records. */
  FORTNOX_TOKENS: KVNamespace;
  /** Injected by OAuthProvider into handler environments. */
  OAUTH_PROVIDER: OAuthHelpers;

  FORTNOX_CLIENT_ID: string;
  FORTNOX_CLIENT_SECRET: string;

  /** When "true", only read-only tools are registered. */
  FORTNOX_READ_ONLY?: string;
}

/** Props carried on the grant and handed to the MCP handler on each request. */
export interface FortnoxProps {
  /** Key into FORTNOX_TOKENS for this grant's Fortnox credentials. */
  userId: string;
  [key: string]: unknown;
}
