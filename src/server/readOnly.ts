import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Read-only deployment mode.
 *
 * When FORTNOX_READ_ONLY=true, only tools annotated with readOnlyHint: true
 * are registered. Write tools (create/update/delete/approve/bookkeep/cancel/
 * credit/send-email) are never exposed to the client, which lets operators
 * run a read-only deployment separately from a write-capable one.
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
export function applyReadOnlyMode(server: McpServer): void {
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
    "[FortnoxMCP] Read-only mode active (FORTNOX_READ_ONLY=true): write tools will not be registered"
  );
}
