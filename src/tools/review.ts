import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, fromPage, type FrameioContext, ok, omitUndefined } from "./helpers";

/** Comments (with attachments) and shares (review links + reviewers). */
export function registerReviewTools(server: McpServer, ctx: FrameioContext): void {
  // --- comments ------------------------------------------------------------ //
  server.registerTool(
    "list_comments",
    {
      description: "List comments on a file (includes the comment owner).",
      inputSchema: { file_id: z.string().describe("File id.") },
    },
    async ({ file_id }) => {
      try {
        const acct = await ctx.account();
        return ok(
          fromPage(await ctx.client().comments.index(acct, file_id, { include: "owner" } as never)),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "show_comment",
    {
      description: "Show a single comment (including replies if present).",
      inputSchema: { comment_id: z.string().describe("Comment id.") },
    },
    async ({ comment_id }) => {
      try {
        const acct = await ctx.account();
        return ok((await ctx.client().comments.show(acct, comment_id)).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_comment",
    {
      description:
        "Add a comment to a file, optionally anchored to a video timecode or frame. Timecode/frame anchoring is only valid on video/audio files.",
      inputSchema: {
        file_id: z.string().describe("File id."),
        text: z.string().describe("Comment text."),
        timecode: z
          .string()
          .optional()
          .describe("Optional video timecode 'HH:MM:SS:FF' to anchor the comment."),
        frame: z
          .number()
          .int()
          .optional()
          .describe("Optional frame number to anchor the comment (alternative to timecode)."),
        annotation: z
          .string()
          .optional()
          .describe("Optional stringified JSON geometry for on-screen drawings."),
      },
    },
    async ({ file_id, text, timecode, frame, annotation }) => {
      try {
        const acct = await ctx.account();
        const timestamp = timecode !== undefined ? timecode : frame;
        const res = await ctx.client().comments.create(acct, file_id, {
          timestamp_as_timecode: timecode !== undefined,
          data: omitUndefined({ text, timestamp, annotation }),
        } as never);
        return ok(res.data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_comment",
    {
      description: "Edit a comment's text and/or mark it resolved (completed).",
      inputSchema: {
        comment_id: z.string().describe("Comment id."),
        text: z.string().optional().describe("New comment text."),
        completed: z
          .boolean()
          .optional()
          .describe("Mark the comment resolved (true) or unresolved (false)."),
      },
    },
    async ({ comment_id, text, completed }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx.client().comments.update(acct, comment_id, {
              data: omitUndefined({ text, completed }),
            } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_comment",
    {
      description: "Delete a comment.",
      inputSchema: { comment_id: z.string().describe("Comment id.") },
    },
    async ({ comment_id }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().comments.delete(acct, comment_id);
        return ok({ deleted: comment_id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_comment_attachment",
    {
      description: "Remove an attachment from a comment.",
      inputSchema: {
        comment_id: z.string().describe("Comment id."),
        attachment_id: z.string().describe("Attachment id to remove."),
      },
    },
    async ({ comment_id, attachment_id }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().comments.deleteAttachment(acct, comment_id, attachment_id);
        return ok({ deleted: attachment_id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // --- shares (review links) ---------------------------------------------- //
  server.registerTool(
    "list_shares",
    {
      description: "List share (review/presentation) links for a project.",
      inputSchema: { project_id: z.string().describe("Project id.") },
    },
    async ({ project_id }) => {
      try {
        const acct = await ctx.account();
        return ok(fromPage(await ctx.client().shares.index(acct, project_id)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "show_share",
    {
      description: "Show a share's details (including its short_url).",
      inputSchema: { share_id: z.string().describe("Share id.") },
    },
    async ({ share_id }) => {
      try {
        const acct = await ctx.account();
        return ok((await ctx.client().shares.show(acct, share_id)).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_share",
    {
      description:
        "Create a shareable review link for one or more assets in a project. access 'public' = anyone with the link; 'secure' = named reviewers / passphrase.",
      inputSchema: {
        project_id: z.string().describe("Project id the assets belong to."),
        name: z.string().describe("Name of the share/review link."),
        asset_ids: z
          .array(z.string())
          .min(1)
          .describe("File/folder/version-stack ids to include in the share (1-100)."),
        access: z
          .enum(["public", "secure"])
          .optional()
          .describe("'public' (anyone with link) or 'secure' (named reviewers). Default public."),
        downloading_enabled: z
          .boolean()
          .optional()
          .describe("Allow reviewers to download assets. Default true."),
        expiration: z
          .string()
          .optional()
          .describe("Optional ISO-8601 expiry, e.g. 2026-07-01T00:00:00Z."),
        passphrase: z.string().optional().describe("Optional passphrase to access the share."),
      },
    },
    async ({
      project_id,
      name,
      asset_ids,
      access,
      downloading_enabled,
      expiration,
      passphrase,
    }) => {
      try {
        const acct = await ctx.account();
        const res = await ctx.client().shares.create(acct, project_id, {
          data: omitUndefined({
            type: "asset",
            name,
            asset_ids,
            access: access ?? "public",
            downloading_enabled: downloading_enabled ?? true,
            expiration,
            passphrase,
          }),
        } as never);
        return ok(res.data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_share",
    {
      description:
        "Update an existing share's settings (name, access, downloads, expiry, passphrase).",
      inputSchema: {
        share_id: z.string().describe("Share id."),
        name: z.string().optional().describe("New share name."),
        access: z.enum(["public", "secure"]).optional().describe("'public' or 'secure'."),
        downloading_enabled: z.boolean().optional().describe("Allow downloads."),
        expiration: z.string().optional().describe("ISO-8601 expiry."),
        passphrase: z.string().optional().describe("Set/replace the access passphrase."),
      },
    },
    async ({ share_id, name, access, downloading_enabled, expiration, passphrase }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx.client().shares.update(acct, share_id, {
              data: omitUndefined({ name, access, downloading_enabled, expiration, passphrase }),
            } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_share",
    {
      description: "Delete (revoke) a share/review link.",
      inputSchema: { share_id: z.string().describe("Share id.") },
    },
    async ({ share_id }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().shares.delete(acct, share_id);
        return ok({ deleted: share_id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "add_share_asset",
    {
      description: "Add an asset to an existing share.",
      inputSchema: {
        share_id: z.string().describe("Share id."),
        asset_id: z.string().describe("File/folder/version-stack id to add to the share."),
      },
    },
    async ({ share_id, asset_id }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (await ctx.client().shares.addAsset(acct, share_id, { data: { asset_id } } as never))
            .data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "remove_share_asset",
    {
      description: "Remove an asset from a share.",
      inputSchema: {
        share_id: z.string().describe("Share id."),
        asset_id: z.string().describe("Asset id to remove from the share."),
      },
    },
    async ({ share_id, asset_id }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().shares.removeAsset(acct, share_id, asset_id);
        return ok({ removed: asset_id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_share_reviewers",
    {
      description: "List reviewers on a secure share.",
      inputSchema: { share_id: z.string().describe("Share id.") },
    },
    async ({ share_id }) => {
      try {
        const acct = await ctx.account();
        return ok(fromPage(await ctx.client().shares.listReviewers(acct, share_id)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "add_share_reviewers",
    {
      description: "Invite reviewers (by email) to a secure share.",
      inputSchema: {
        share_id: z.string().describe("Share id."),
        emails: z.array(z.string()).min(1).describe("Reviewer email addresses to invite."),
        message: z.string().optional().describe("Invitation message to send to reviewers."),
      },
    },
    async ({ share_id, emails, message }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().shares.addReviewers(acct, share_id, {
          message: message ?? "",
          reviewers: { emails },
        } as never);
        return ok({ invited: emails });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "remove_share_reviewers",
    {
      description: "Remove reviewers (by email) from a secure share.",
      inputSchema: {
        share_id: z.string().describe("Share id."),
        emails: z.array(z.string()).min(1).describe("Reviewer email addresses to remove."),
      },
    },
    async ({ share_id, emails }) => {
      try {
        const acct = await ctx.account();
        await ctx
          .client()
          .shares.removeReviewers(acct, share_id, { reviewers: { emails } } as never);
        return ok({ removed: emails });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
