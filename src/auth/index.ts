export * from "./types.js";
export * from "./context.js";
export * from "./credentials.js";
export { EnvVarTokenProvider } from "./envVarProvider.js";
export { DatabaseTokenProvider } from "./databaseProvider.js";
export { FortnoxProxyOAuthProvider, getUserIdFromAuth } from "./oauthProvider.js";
export * from "./storage/index.js";

import { ITokenProvider } from "./types.js";
import { EnvVarTokenProvider } from "./envVarProvider.js";
import { DatabaseTokenProvider } from "./databaseProvider.js";
import { getStorageFromEnv } from "./storage/index.js";
import { setDefaultTokenProviderFactory } from "./registry.js";

export { initializeTokenProvider, getTokenProvider } from "./registry.js";

// Importing this barrel means running on Node, where an uninitialized provider
// should still fall back to reading credentials out of the environment.
setDefaultTokenProviderFactory(() => new EnvVarTokenProvider());

export function createTokenProvider(mode: "local" | "remote"): ITokenProvider {
  if (mode === "remote") {
    const storage = getStorageFromEnv();
    return new DatabaseTokenProvider(storage);
  }
  return new EnvVarTokenProvider();
}
