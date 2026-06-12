import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, type FrameioContext, ok } from "./helpers";

/** Account-scoped search (not surfaced by the SDK — uses the authenticated passthrough). */
export function registerSearchTools(server: McpServer, ctx: FrameioContext): void {
  server.registerTool(
    "search",
    {
      description:
        "Search the active account for files, folders, and/or projects. Each result has a `type` (e.g. 'file_result'), `matches`, and a `result` object holding the matched entity (id, name, view_url, ...).",
      inputSchema: {
        query: z.string().describe("Search query text."),
        engine: z
          .enum(["lexical", "nlp"])
          .optional()
          .describe("'lexical' (keyword) or 'nlp' (natural language). Default lexical."),
        include_files: z
          .boolean()
          .optional()
          .describe("Include files & version stacks. Default true."),
        include_folders: z.boolean().optional().describe("Include folders. Default true."),
        include_projects: z.boolean().optional().describe("Include projects. Default false."),
      },
    },
    async ({ query, engine, include_files, include_folders, include_projects }) => {
      try {
        const acct = await ctx.account();
        const body = {
          engine: engine ?? "lexical",
          query,
          filters: {
            files_and_version_stacks: include_files ?? true,
            folders: include_folders ?? true,
            projects: include_projects ?? false,
          },
        };
        const resp = await ctx.client().fetch(`https://api.frame.io/v4/accounts/${acct}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await resp.text();
        if (!resp.ok) {
          return {
            isError: true,
            content: [
              { type: "text", text: `Search failed (${resp.status}): ${text.slice(0, 500)}` },
            ],
          };
        }
        const parsed = text ? (JSON.parse(text) as { data?: unknown[] }) : {};
        return ok({ items: parsed.data ?? [] });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
