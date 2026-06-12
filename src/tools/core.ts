import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, fromPage, type FrameioContext, ok } from "./helpers";

/**
 * Identity, account selection, workspaces, and projects.
 *
 * Account context is held for the session: most tools operate on the *active*
 * account (resolved automatically when you have one, or chosen via set_account)
 * rather than taking an account_id argument.
 */
export function registerCoreTools(server: McpServer, ctx: FrameioContext): void {
  // --- identity ------------------------------------------------------------ //
  server.registerTool(
    "whoami",
    {
      description: "Return the signed-in Frame.io user's profile (id, name, email).",
      inputSchema: {},
    },
    async () => {
      try {
        return ok((await ctx.client().users.show()).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // --- account selection --------------------------------------------------- //
  server.registerTool(
    "list_accounts",
    {
      description:
        "List the Frame.io accounts the signed-in user can access. Use set_account to choose which one subsequent tools operate on.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok({ items: await ctx.accounts() });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_account",
    {
      description:
        "Show the account that tools currently operate on (auto-resolved when you have a single account).",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await ctx.currentAccount());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_account",
    {
      description:
        "Choose which Frame.io account subsequent tools operate on (persists for the session). Required only when you have more than one account.",
      inputSchema: {
        account_id: z.string().describe("Account id (from list_accounts)."),
      },
    },
    async ({ account_id }) => {
      try {
        return ok({ active_account: await ctx.setActive(account_id) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // --- workspaces ---------------------------------------------------------- //
  server.registerTool(
    "list_workspaces",
    {
      description: "List workspaces in the active account. Workspaces contain projects.",
      inputSchema: {},
    },
    async () => {
      try {
        const acct = await ctx.account();
        return ok(fromPage(await ctx.client().workspaces.index(acct)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "show_workspace",
    {
      description: "Show a workspace's details.",
      inputSchema: { workspace_id: z.string().describe("Workspace id.") },
    },
    async ({ workspace_id }) => {
      try {
        const acct = await ctx.account();
        return ok((await ctx.client().workspaces.show(acct, workspace_id)).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_workspace",
    {
      description: "Create a new workspace in the active account.",
      inputSchema: { name: z.string().describe("Name for the new workspace.") },
    },
    async ({ name }) => {
      try {
        const acct = await ctx.account();
        return ok((await ctx.client().workspaces.create(acct, { data: { name } } as never)).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_workspace",
    {
      description: "Rename a workspace.",
      inputSchema: {
        workspace_id: z.string().describe("Workspace id."),
        name: z.string().describe("New workspace name."),
      },
    },
    async ({ workspace_id, name }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (await ctx.client().workspaces.update(acct, workspace_id, { data: { name } } as never))
            .data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_workspace",
    {
      description: "Permanently delete a workspace and all its projects. Cannot be undone.",
      inputSchema: { workspace_id: z.string().describe("Workspace id to permanently delete.") },
    },
    async ({ workspace_id }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().workspaces.delete(acct, workspace_id);
        return ok({ deleted: workspace_id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // --- projects ------------------------------------------------------------ //
  server.registerTool(
    "list_projects",
    {
      description:
        "List projects within a workspace. Each project carries a root_folder_id used to browse its contents.",
      inputSchema: { workspace_id: z.string().describe("Workspace id (from list_workspaces).") },
    },
    async ({ workspace_id }) => {
      try {
        const acct = await ctx.account();
        return ok(fromPage(await ctx.client().projects.index(acct, workspace_id)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "show_project",
    {
      description: "Show a project's details, including its root_folder_id and view_url.",
      inputSchema: { project_id: z.string().describe("Project id.") },
    },
    async ({ project_id }) => {
      try {
        const acct = await ctx.account();
        return ok((await ctx.client().projects.show(acct, project_id)).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_project",
    {
      description: "Create a new project in a workspace.",
      inputSchema: {
        workspace_id: z.string().describe("Workspace id to create the project in."),
        name: z.string().describe("Name for the new project."),
        restricted: z
          .boolean()
          .optional()
          .describe("If true, access is restricted to explicitly-added members."),
      },
    },
    async ({ workspace_id, name, restricted }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx
              .client()
              .projects.create(acct, workspace_id, { data: { name, restricted } } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_project",
    {
      description: "Update a project's name, status, or restricted flag.",
      inputSchema: {
        project_id: z.string().describe("Project id."),
        name: z.string().optional().describe("New project name."),
        status: z.enum(["active", "inactive"]).optional().describe("Project status."),
        restricted: z.boolean().optional().describe("Restrict project access."),
      },
    },
    async ({ project_id, name, status, restricted }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx
              .client()
              .projects.update(acct, project_id, { data: { name, status, restricted } } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_project",
    {
      description: "Permanently delete a project and all its contents. Cannot be undone.",
      inputSchema: { project_id: z.string().describe("Project id to permanently delete.") },
    },
    async ({ project_id }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().projects.delete(acct, project_id);
        return ok({ deleted: project_id });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
