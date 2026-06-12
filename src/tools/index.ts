import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAdminTools } from "./admin";
import { registerAssetTools } from "./assets";
import { registerCoreTools } from "./core";
import { FrameioContext } from "./helpers";
import { registerMetadataTools } from "./metadata";
import { registerReviewTools } from "./review";
import { registerSearchTools } from "./search";

export { FrameioContext } from "./helpers";

/** Register the full Frame.io tool set on the MCP server. */
export function registerFrameioTools(server: McpServer, ctx: FrameioContext): void {
  registerCoreTools(server, ctx);
  registerAssetTools(server, ctx);
  registerReviewTools(server, ctx);
  registerMetadataTools(server, ctx);
  registerSearchTools(server, ctx);
  registerAdminTools(server, ctx);
}
