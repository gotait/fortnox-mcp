import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Read-only deployment mode.
 *
 * When active, only tools annotated with readOnlyHint: true are registered.
 * Write tools (create/update/delete/approve/bookkeep/cancel/credit/send-email)
 * are never exposed to the client.
 *
 * Two things can turn it on: FORTNOX_READ_ONLY=true, which forces it for the
 * whole deployment, or a user choosing read-only when they authorize. The
 * Worker builds a server per request, so the per-grant choice costs nothing
 * beyond the registration it already does.
 */

/**
 * Check whether read-only mode is enabled via the environment
 */
export function isReadOnlyMode(): boolean {
  return process.env.FORTNOX_READ_ONLY === "true";
}

/**
 * Patch server.registerTool so that any tool whose annotations do not
 * explicitly set readOnlyHint: true is skipped instead of registered.
 *
 * Must be applied before the register*Tools() calls so the filter covers
 * every tool, including tools added in the future.
 */
export function applyReadOnlyMode(server: McpServer, reason = "FORTNOX_READ_ONLY=true"): void {
  const originalRegisterTool = server.registerTool.bind(server);

  // registerTool is generic over the tool's input/output schemas. The wrapper
  // only needs to inspect config.annotations before delegating, so we go
  // through targeted casts here; they are contained to this assignment.
  server.registerTool = ((
    name: string,
    config: { annotations?: { readOnlyHint?: boolean } },
    callback: unknown
  ) => {
    if (config.annotations?.readOnlyHint !== true) {
      return undefined;
    }
    return originalRegisterTool(name, config as never, callback as never);
  }) as unknown as typeof server.registerTool;

  console.error(
    `[FortnoxMCP] Read-only mode active (${reason}): write tools will not be registered`
  );
}
