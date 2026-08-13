/**
 * Fortnox OAuth Credentials
 *
 * These can be:
 * 1. Embedded at build time (for simplified user experience)
 * 2. Provided via environment variables (for flexibility)
 *
 * The embedded credentials are YOUR app's credentials, allowing users
 * to authorize your app without creating their own Fortnox developer account.
 */

// Embedded credentials (set via build-time env vars or replace directly)
// These are intentionally left as placeholders - replace with your actual credentials
// or set via FORTNOX_CLIENT_ID and FORTNOX_CLIENT_SECRET env vars
const EMBEDDED_CLIENT_ID = process.env.FORTNOX_CLIENT_ID || "";
const EMBEDDED_CLIENT_SECRET = process.env.FORTNOX_CLIENT_SECRET || "";

export interface FortnoxCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Get Fortnox OAuth credentials
 * Prefers embedded credentials, falls back to environment variables
 */
export function getFortnoxCredentials(): FortnoxCredentials {
  const clientId = EMBEDDED_CLIENT_ID || process.env.FORTNOX_CLIENT_ID;
  const clientSecret = EMBEDDED_CLIENT_SECRET || process.env.FORTNOX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Fortnox credentials. Set FORTNOX_CLIENT_ID and FORTNOX_CLIENT_SECRET environment variables."
    );
  }

  return { clientId, clientSecret };
}

/**
 * Check if credentials are available
 */
export function hasFortnoxCredentials(): boolean {
  const clientId = EMBEDDED_CLIENT_ID || process.env.FORTNOX_CLIENT_ID;
  const clientSecret = EMBEDDED_CLIENT_SECRET || process.env.FORTNOX_CLIENT_SECRET;
  return !!(clientId && clientSecret);
}

/**
 * Fortnox OAuth scopes required by this MCP server.
 *
 * One entry per endpoint family the tools call - Fortnox rejects the whole
 * authorization if a requested scope is not granted to the app, and answers
 * 403 per request if a needed one was never requested:
 *
 *   bookkeeping         /3/vouchers, /3/voucherseries, /3/accounts,
 *                       /3/financialyears
 *   companyinformation  /3/companyinformation
 *   costcenter          /3/costcenters
 *   customer            /3/customers
 *   invoice             /3/invoices
 *   offer               /3/offers
 *   order               /3/orders
 *   project             /3/projects
 *   supplier            /3/suppliers
 *   supplierinvoice     /3/supplierinvoices
 */
export const FORTNOX_SCOPES = [
  "bookkeeping",
  "companyinformation",
  "costcenter",
  "customer",
  "invoice",
  "offer",
  "order",
  "project",
  "supplier",
  "supplierinvoice"
];
