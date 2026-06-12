import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, fromList, type FrameioContext, ok, pageInputs } from "./helpers";

/** Folders, files, transfers (remote/import), and version stacks. */
export function registerAssetTools(server: McpServer, ctx: FrameioContext): void {
  // --- folders ------------------------------------------------------------- //
  server.registerTool(
    "list_folder",
    {
      description:
        "List the children (files, subfolders, version stacks) of a folder. Use a project's root_folder_id to start.",
      inputSchema: {
        folder_id: z.string().describe("Folder id (e.g. a project's root_folder_id)."),
        type: z
          .string()
          .optional()
          .describe('Optional filter, comma-separated: "file", "folder", "version_stack".'),
        include: z
          .string()
          .optional()
          .describe('Comma-separated includes, e.g. "media_links.thumbnail,creator".'),
        ...pageInputs,
      },
    },
    async ({ folder_id, type, include, page_size, after }) => {
      try {
        const acct = await ctx.account();
        const res = await ctx
          .client()
          .folders.index(acct, folder_id, { type, include, page_size, after } as never);
        return ok(fromList(res));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_project_contents",
    {
      description:
        "Resolve a project's root folder and list its top-level contents (convenience for 'what's in this project').",
      inputSchema: { project_id: z.string().describe("Project id; its root folder is listed.") },
    },
    async ({ project_id }) => {
      try {
        const acct = await ctx.account();
        const proj = await ctx.client().projects.show(acct, project_id);
        const root = proj.data?.root_folder_id;
        if (!root) throw new Error(`Could not determine root folder for project ${project_id}.`);
        return ok(fromList(await ctx.client().folders.index(acct, root)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "show_folder",
    {
      description: "Show a folder's details.",
      inputSchema: { folder_id: z.string().describe("Folder id.") },
    },
    async ({ folder_id }) => {
      try {
        const acct = await ctx.account();
        return ok((await ctx.client().folders.show(acct, folder_id)).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_folder",
    {
      description: "Create a subfolder inside an existing folder.",
      inputSchema: {
        parent_folder_id: z.string().describe("Parent folder id to create the folder inside."),
        name: z.string().describe("Name for the new folder."),
      },
    },
    async ({ parent_folder_id, name }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (await ctx.client().folders.create(acct, parent_folder_id, { data: { name } })).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "rename_folder",
    {
      description: "Rename a folder.",
      inputSchema: {
        folder_id: z.string().describe("Folder id."),
        name: z.string().describe("New folder name."),
      },
    },
    async ({ folder_id, name }) => {
      try {
        const acct = await ctx.account();
        return ok((await ctx.client().folders.update(acct, folder_id, { data: { name } })).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "move_folder",
    {
      description: "Move a folder into a different parent folder.",
      inputSchema: {
        folder_id: z.string().describe("Folder id."),
        new_parent_id: z.string().describe("Destination parent folder id."),
      },
    },
    async ({ folder_id, new_parent_id }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (await ctx.client().folders.move(acct, folder_id, { data: { parent_id: new_parent_id } }))
            .data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "copy_folder",
    {
      description: "Copy a folder (and its contents) into another folder.",
      inputSchema: {
        folder_id: z.string().describe("Folder id."),
        new_parent_id: z.string().describe("Destination parent folder id for the copy."),
        copy_metadata: z.boolean().optional().describe("Also copy custom metadata values."),
      },
    },
    async ({ folder_id, new_parent_id, copy_metadata }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx.client().folders.copy(acct, folder_id, {
              copy_metadata,
              data: { parent_id: new_parent_id },
            } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_folder",
    {
      description: "Permanently delete a folder and everything in it. Cannot be undone.",
      inputSchema: { folder_id: z.string().describe("Folder id to permanently delete.") },
    },
    async ({ folder_id }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().folders.delete(acct, folder_id);
        return ok({ deleted: folder_id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // --- files --------------------------------------------------------------- //
  server.registerTool(
    "list_files",
    {
      description: "List only the files (not subfolders) directly in a folder.",
      inputSchema: { folder_id: z.string().describe("Folder id."), ...pageInputs },
    },
    async ({ folder_id, page_size, after }) => {
      try {
        const acct = await ctx.account();
        return ok(
          fromList(await ctx.client().files.list(acct, folder_id, { page_size, after } as never)),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "show_file",
    {
      description:
        "Show a file's details (name, status, file_size, media_type, view_url) and media links. Pass include for download/inline URLs (null while transcoding; 403 without download permission).",
      inputSchema: {
        file_id: z.string().describe("File id."),
        include: z
          .string()
          .optional()
          .describe(
            'Optional extra, e.g. "media_links.original" for {download_url, inline_url}, "media_links.thumbnail", "project", "creator".',
          ),
      },
    },
    async ({ file_id, include }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx
              .client()
              .files.show(acct, file_id, { include: include ?? "media_links.original" } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_file_status",
    {
      description:
        "Get a file's upload/processing status (useful after an upload while Frame.io is still transcoding).",
      inputSchema: { file_id: z.string().describe("File id.") },
    },
    async ({ file_id }) => {
      try {
        const acct = await ctx.account();
        return ok((await ctx.client().files.showFileUploadStatus(acct, file_id)).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "rename_file",
    {
      description: "Rename a file.",
      inputSchema: {
        file_id: z.string().describe("File id."),
        name: z.string().describe("New file name."),
      },
    },
    async ({ file_id, name }) => {
      try {
        const acct = await ctx.account();
        return ok((await ctx.client().files.update(acct, file_id, { data: { name } })).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "move_file",
    {
      description: "Move a file into a different folder.",
      inputSchema: {
        file_id: z.string().describe("File id."),
        new_parent_id: z.string().describe("Destination folder id."),
      },
    },
    async ({ file_id, new_parent_id }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (await ctx.client().files.move(acct, file_id, { data: { parent_id: new_parent_id } }))
            .data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "copy_file",
    {
      description: "Copy a file into another folder.",
      inputSchema: {
        file_id: z.string().describe("File id."),
        new_parent_id: z.string().describe("Destination folder id for the copy."),
        copy_metadata: z.boolean().optional().describe("Also copy custom metadata values."),
        copy_comments: z.boolean().optional().describe("Also copy comments."),
      },
    },
    async ({ file_id, new_parent_id, copy_metadata, copy_comments }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx.client().files.copy(acct, file_id, {
              copy_metadata,
              copy_comments,
              data: { parent_id: new_parent_id },
            } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_file",
    {
      description: "Permanently delete a file. Cannot be undone.",
      inputSchema: { file_id: z.string().describe("File id to permanently delete.") },
    },
    async ({ file_id }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().files.delete(acct, file_id);
        return ok({ deleted: file_id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // --- transfers ----------------------------------------------------------- //
  server.registerTool(
    "remote_upload",
    {
      description:
        "Import a file into a folder from a publicly reachable source URL (Frame.io fetches it server-side; no local file needed).",
      inputSchema: {
        folder_id: z.string().describe("Destination folder id."),
        name: z.string().describe("File name to give the uploaded asset."),
        source_url: z.string().url().describe("Publicly accessible source URL."),
      },
    },
    async ({ folder_id, name, source_url }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx
              .client()
              .files.createRemoteUpload(acct, folder_id, { data: { name, source_url } })
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "import_file",
    {
      description:
        "Import a file into a folder from a connected storage location (BYOS) by object key.",
      inputSchema: {
        folder_id: z.string().describe("Destination folder id."),
        name: z.string().describe("File name for the imported asset."),
        key: z.string().describe("Object key/path within the storage location."),
        storage_location: z.string().describe("Configured storage location identifier."),
      },
    },
    async ({ folder_id, name, key, storage_location }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx
              .client()
              .files.importFile(acct, folder_id, { data: { name, key, storage_location } } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  // --- version stacks ------------------------------------------------------ //
  server.registerTool(
    "list_version_stacks",
    {
      description: "List version stacks in a folder.",
      inputSchema: { folder_id: z.string().describe("Folder id."), ...pageInputs },
    },
    async ({ folder_id, page_size, after }) => {
      try {
        const acct = await ctx.account();
        return ok(
          fromList(
            await ctx.client().versionStacks.list(acct, folder_id, { page_size, after } as never),
          ),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "show_version_stack",
    {
      description: "Show a version stack's details.",
      inputSchema: { version_stack_id: z.string().describe("Version stack id.") },
    },
    async ({ version_stack_id }) => {
      try {
        const acct = await ctx.account();
        return ok((await ctx.client().versionStacks.show(acct, version_stack_id)).data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_versions",
    {
      description: "List the individual file versions inside a version stack (oldest→newest).",
      inputSchema: { version_stack_id: z.string().describe("Version stack id.") },
    },
    async ({ version_stack_id }) => {
      try {
        const acct = await ctx.account();
        return ok(fromList(await ctx.client().versionStacks.index(acct, version_stack_id)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_version_stack",
    {
      description:
        "Create a version stack from existing files (e.g. group cut v1, v2, v3 of a clip), ordered oldest→newest.",
      inputSchema: {
        folder_id: z.string().describe("Folder id the stack lives in."),
        file_ids: z
          .array(z.string())
          .min(2)
          .describe("File ids to stack as versions, ordered oldest→newest."),
      },
    },
    async ({ folder_id, file_ids }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx
              .client()
              .versionStacks.create(acct, folder_id, { data: { file_ids } } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "move_version_stack",
    {
      description: "Move a version stack into a different folder.",
      inputSchema: {
        version_stack_id: z.string().describe("Version stack id to move."),
        new_parent_id: z.string().describe("Destination folder id."),
      },
    },
    async ({ version_stack_id, new_parent_id }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx
              .client()
              .versionStacks.move(acct, version_stack_id, { data: { parent_id: new_parent_id } })
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "copy_version_stack",
    {
      description: "Copy a version stack into another folder.",
      inputSchema: {
        version_stack_id: z.string().describe("Version stack id to copy."),
        new_parent_id: z.string().describe("Destination folder id for the copy."),
        copy_metadata: z.boolean().optional().describe("Also copy custom metadata values."),
      },
    },
    async ({ version_stack_id, new_parent_id, copy_metadata }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx.client().versionStacks.copy(acct, version_stack_id, {
              copy_metadata,
              data: { parent_id: new_parent_id },
            } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
}
