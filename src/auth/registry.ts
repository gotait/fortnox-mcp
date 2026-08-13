/**
 * Token provider registry
 *
 * The active ITokenProvider lives here rather than in auth/index.ts so that
 * request-path code (services/api.ts) can reach it without importing the
 * barrel. The barrel pulls in oauthProvider.ts (express) and, through
 * storage/index.ts, the Upstash client - neither of which can be bundled for
 * Cloudflare Workers. Keeping the registry standalone lets the Worker entry
 * point import only what it can actually run.
 */

import { ITokenProvider } from "./types.js";

let tokenProvider: ITokenProvider | null = null;
let defaultProviderFactory: (() => ITokenProvider) | null = null;

export function initializeTokenProvider(provider: ITokenProvider): void {
  tokenProvider = provider;
}

/**
 * Register the provider to fall back to when nothing has been initialized.
 *
 * The Node entry points rely on getTokenProvider() lazily constructing an
 * EnvVarTokenProvider; registering that as a factory keeps the behaviour
 * without hard-wiring the import, which would drag process.env credential
 * loading into every consumer.
 */
export function setDefaultTokenProviderFactory(
  factory: () => ITokenProvider
): void {
  defaultProviderFactory = factory;
}

export function getTokenProvider(): ITokenProvider {
  if (!tokenProvider) {
    if (!defaultProviderFactory) {
      throw new Error(
        "No token provider initialized. Call initializeTokenProvider() during startup."
      );
    }
    tokenProvider = defaultProviderFactory();
  }
  return tokenProvider;
}

/** Reset the registry. Intended for tests. */
export function resetTokenProvider(): void {
  tokenProvider = null;
}
