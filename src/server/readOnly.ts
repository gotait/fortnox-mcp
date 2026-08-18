import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Read-only deployment mode.
 *
 * When active, only tools annotated with readOnlyHint: true are registered.
 * Write tools (create/update/delete/approve/bookkeep/cancel/credit/send-email)
 * are never exposed to the client.
 *
 * What turns it on depends on the deployment. The Worker asks each user at
 * authorization and reads the answer off their grant, so two clients on one host
 * can see different tool surfaces; it builds a server per request anyway, so
 * that costs nothing beyond registration. The single-user Node entry points have
 * no authorization step to ask at, so there FORTNOX_READ_ONLY=true is what sets
 * it (see isReadOnlyMode).
 */

/**
 * Check whether read-only mode is enabled via the environment.
 *
 * For the Node entry points only — single-user local mode and the Express remote
 * server, neither of which has a per-user access-level choice to read. The
 * Worker ignores this and uses the grant.
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
