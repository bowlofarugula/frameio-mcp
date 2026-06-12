import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, fromList, fromPage, type FrameioContext, ok, omitUndefined } from "./helpers";

const role = z
  .string()
  .describe("Role, e.g. 'full_access', 'editor', 'edit_only', 'viewer', 'reviewer'.");

/** Lower-priority administration: webhooks, user permissions, and audit logs. */
export function registerAdminTools(server: McpServer, ctx: FrameioContext): void {
  // --- webhooks ------------------------------------------------------------ //
  server.registerTool(
    "list_webhooks",
    {
      description: "List webhooks configured in a workspace.",
      inputSchema: { workspace_id: z.string().describe("Workspace id.") },
    },
    async ({ workspace_id }) => {
      try {
        const acct = await ctx.account();
        return ok(fromPage(await ctx.client().webhooks.index(acct, workspace_id)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "show_webhook",
    {
      description: "Show a webhook's details.",
      inputSchema: { webhook_id: z.string().describe("Webhook id.") },
    },
    async ({ webhook_id }) => {
      try {
        const acct = await ctx.account();
        return ok((await ctx.client().webhooks.show(acct, webhook_id)).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_webhook",
    {
      description: "Create a webhook in a workspace.",
      inputSchema: {
        workspace_id: z.string().describe("Workspace id."),
        name: z.string().describe("Webhook name."),
        url: z.string().url().describe("Destination URL to POST events to."),
        events: z
          .array(z.string())
          .min(1)
          .describe("Event names to subscribe to, e.g. 'file.ready', 'comment.created'."),
      },
    },
    async ({ workspace_id, name, url, events }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx
              .client()
              .webhooks.create(acct, workspace_id, { data: { name, url, events } } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_webhook",
    {
      description: "Update a webhook (name, URL, events, or active state).",
      inputSchema: {
        webhook_id: z.string().describe("Webhook id."),
        name: z.string().optional().describe("New name."),
        url: z.string().url().optional().describe("New destination URL."),
        events: z.array(z.string()).optional().describe("Replacement event list."),
        active: z.boolean().optional().describe("Enable/disable the webhook."),
      },
    },
    async ({ webhook_id, name, url, events, active }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx.client().webhooks.update(acct, webhook_id, {
              data: omitUndefined({ name, url, events, active }),
            } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_webhook",
    {
      description: "Delete a webhook.",
      inputSchema: { webhook_id: z.string().describe("Webhook id.") },
    },
    async ({ webhook_id }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().webhooks.delete(acct, webhook_id);
        return ok({ deleted: webhook_id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // --- permissions / user roles ------------------------------------------- //
  server.registerTool(
    "list_account_users",
    {
      description: "List users (and roles) on the active account.",
      inputSchema: {
        include_deactivated: z.boolean().optional().describe("Include deactivated users."),
      },
    },
    async ({ include_deactivated }) => {
      try {
        const acct = await ctx.account();
        return ok(
          fromPage(
            await ctx.client().accountPermissions.index(acct, {
              include_deactivated: include_deactivated ?? false,
            } as never),
          ),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_workspace_users",
    {
      description: "List users and their roles in a workspace.",
      inputSchema: { workspace_id: z.string().describe("Workspace id.") },
    },
    async ({ workspace_id }) => {
      try {
        const acct = await ctx.account();
        return ok(fromPage(await ctx.client().workspacePermissions.index(acct, workspace_id)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_workspace_user_role",
    {
      description: "Set a user's role in a workspace.",
      inputSchema: {
        workspace_id: z.string().describe("Workspace id."),
        user_id: z.string().describe("User id."),
        role,
      },
    },
    async ({ workspace_id, user_id, role: r }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx
              .client()
              .workspacePermissions.workspaceUserRolesUpdate(acct, workspace_id, user_id, {
                data: { role: r },
              } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "remove_workspace_user",
    {
      description: "Remove a user from a workspace.",
      inputSchema: {
        workspace_id: z.string().describe("Workspace id."),
        user_id: z.string().describe("User id."),
      },
    },
    async ({ workspace_id, user_id }) => {
      try {
        const acct = await ctx.account();
        await ctx
          .client()
          .workspacePermissions.workspaceUserRolesDelete(acct, workspace_id, user_id);
        return ok({ removed: user_id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_project_users",
    {
      description: "List users and their roles on a project.",
      inputSchema: { project_id: z.string().describe("Project id.") },
    },
    async ({ project_id }) => {
      try {
        const acct = await ctx.account();
        return ok(fromPage(await ctx.client().projectPermissions.index(acct, project_id)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_project_user_role",
    {
      description: "Set a user's role on a project.",
      inputSchema: {
        project_id: z.string().describe("Project id."),
        user_id: z.string().describe("User id."),
        role,
      },
    },
    async ({ project_id, user_id, role: r }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx
              .client()
              .projectPermissions.projectUserRolesUpdate(acct, project_id, user_id, {
                data: { role: r },
              } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "remove_project_user",
    {
      description: "Remove a user from a project.",
      inputSchema: {
        project_id: z.string().describe("Project id."),
        user_id: z.string().describe("User id."),
      },
    },
    async ({ project_id, user_id }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().projectPermissions.delete(acct, project_id, user_id);
        return ok({ removed: user_id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // --- audit --------------------------------------------------------------- //
  server.registerTool(
    "list_audit_logs",
    {
      description:
        "List recent account audit-log entries. Depends on the account plan — Frame.io may error if audit logging isn't enabled.",
      inputSchema: {
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Entries to return (default 50)."),
      },
    },
    async ({ page_size }) => {
      try {
        const acct = await ctx.account();
        return ok(
          fromList(
            await ctx
              .client()
              .accounts.auditlogIndex(acct, { page_size: page_size ?? 50 } as never),
          ),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
}
