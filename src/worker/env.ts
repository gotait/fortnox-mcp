import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { FORTNOX_SCOPES } from "../auth/credentials.js";

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

  /**
   * Scopes requested from Fortnox, separated by spaces or commas. Defaults to
   * FORTNOX_SCOPES. Override when the Fortnox app grants a different set -
   * requesting a scope the app does not have fails the whole authorization.
   */
  FORTNOX_SCOPES?: string;

  /**
   * Support address shown on the authorization error pages. Optional — the
   * pages simply omit the "contact us" line when it is unset, rather than
   * printing an address nobody reads.
   */
  SUPPORT_EMAIL?: string;
}

/** Scopes to request from Fortnox, from the environment or the default set. */
export function getRequestedScopes(env: Env): string[] {
  const configured = env.FORTNOX_SCOPES?.trim();
  if (!configured) {
    return FORTNOX_SCOPES;
  }
  return configured.split(/[\s,]+/).filter(Boolean);
}

/**
 * Read the Fortnox app credentials, or null when the Worker is not configured.
 *
 * Secrets are absent until `wrangler secret put` has run. Without this check
 * the undefined values flow into the authorization URL as
 * `client_id=undefined`, sending the user to a Fortnox error page instead of
 * telling the operator what is missing.
 */
export function getConfiguredCredentials(
  env: Env
): { clientId: string; clientSecret: string } | null {
  if (!env.FORTNOX_CLIENT_ID || !env.FORTNOX_CLIENT_SECRET) {
    return null;
  }
  return {
    clientId: env.FORTNOX_CLIENT_ID,
    clientSecret: env.FORTNOX_CLIENT_SECRET,
  };
}

/** Props carried on the grant and handed to the MCP handler on each request. */
export interface FortnoxProps {
  /** Key into FORTNOX_TOKENS for this grant's Fortnox credentials. */
  userId: string;
  /**
   * Whether this grant is limited to read-only tools, chosen by the user at
   * authorization. This is the only thing that decides the tool surface — there
   * is no deployment-wide override. Optional because grants issued before the
   * choice existed carry no flag; absent is read as read-only rather than as
   * write access.
   */
  readOnly?: boolean;
  [key: string]: unknown;
}
