import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, fromList, type FrameioContext, ok } from "./helpers";

/**
 * Custom metadata. Two layers:
 *   1. Field *definitions* live at the account level (create_metadata_field) —
 *      e.g. a 'Client' text field, a 'Content Type' select, a 'Shoot Date' date.
 *   2. Field *values* are set per-file (set_file_metadata), referencing a field
 *      definition id. Use set_file_metadata to tag many files at once.
 */

const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "select",
  "select_multi",
  "date",
  "rating",
  "toggle",
  "user_single",
  "user_multi",
] as const;

/** Merge `options` (select display names) into the type-specific field configuration. */
function buildConfig(
  fieldType: string,
  options: string[] | undefined,
  fieldConfiguration: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const cfg: Record<string, unknown> = { ...fieldConfiguration };
  if (fieldType === "select" || fieldType === "select_multi") {
    if (options) cfg.options = options.map((o) => ({ display_name: o }));
    if (!("options" in cfg)) throw new Error(`field_type '${fieldType}' requires \`options\`.`);
  }
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

export function registerMetadataTools(server: McpServer, ctx: FrameioContext): void {
  // --- file metadata values ----------------------------------------------- //
  server.registerTool(
    "get_file_metadata",
    {
      description: "Show the custom metadata field values set on a file.",
      inputSchema: {
        file_id: z.string().describe("File id."),
        show_null: z.boolean().optional().describe("Include fields with no value set."),
      },
    },
    async ({ file_id, show_null }) => {
      try {
        const acct = await ctx.account();
        return ok(
          (
            await ctx
              .client()
              .metadata.show(acct, file_id, { show_null: show_null ?? false } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_file_metadata",
    {
      description:
        "Set custom metadata values on one or more files at once (bulk tagging). select/select_multi values are a LIST of option UUIDs (not display names) from list_metadata_fields; user_* are lists of user UUIDs.",
      inputSchema: {
        project_id: z.string().describe("Project the files belong to."),
        file_ids: z.array(z.string()).min(1).describe("File ids to apply the values to."),
        values: z
          .record(z.string(), z.any())
          .describe(
            "Map of field_definition_id -> value. text/long_text->string; number->number; toggle->bool; date->ISO date; rating->int; select/select_multi->list of option UUIDs; user_*->list of user UUIDs.",
          ),
      },
    },
    async ({ project_id, file_ids, values }) => {
      try {
        const acct = await ctx.account();
        const items = Object.entries(values).map(([field_definition_id, value]) => ({
          field_definition_id,
          value,
        }));
        await ctx
          .client()
          .metadata.bulkUpdate(acct, project_id, { data: { file_ids, values: items } } as never);
        return ok({ updated_files: file_ids, fields: Object.keys(values) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // --- field definitions (account level) ----------------------------------- //
  server.registerTool(
    "list_metadata_fields",
    {
      description: "List the active account's custom metadata field definitions.",
      inputSchema: {},
    },
    async () => {
      try {
        const acct = await ctx.account();
        return ok(fromList(await ctx.client().metadataFields.metadataFieldDefinitionsIndex(acct)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_metadata_field",
    {
      description: "Create an account-level custom metadata field definition.",
      inputSchema: {
        name: z.string().describe("Display name for the field."),
        field_type: z.enum(FIELD_TYPES).describe("The field type."),
        options: z
          .array(z.string())
          .optional()
          .describe("For select/select_multi: the choice display names."),
        field_configuration: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            "Type-specific config. number: {number_format, scale}; date: {display_format, include_time, time_format}; rating: {max_value, style}; user_*: {member_options_type, notify_members}. Merged with `options` for select types.",
          ),
      },
    },
    async ({ name, field_type, options, field_configuration }) => {
      try {
        const acct = await ctx.account();
        const field_configuration_built = buildConfig(field_type, options, field_configuration);
        const data: Record<string, unknown> = { field_type, name };
        if (field_configuration_built) data.field_configuration = field_configuration_built;
        return ok(
          (
            await ctx
              .client()
              .metadataFields.metadataFieldDefinitionsCreate(acct, { data } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_metadata_field",
    {
      description: "Update a custom metadata field definition (name, options, or configuration).",
      inputSchema: {
        field_definition_id: z.string().describe("Field definition id to update."),
        field_type: z.enum(FIELD_TYPES).describe("The field's type (same set as create)."),
        name: z.string().optional().describe("New display name."),
        options: z
          .array(z.string())
          .optional()
          .describe("For select types: replacement choice display names."),
        field_configuration: z
          .record(z.string(), z.any())
          .optional()
          .describe("Type-specific config to update."),
      },
    },
    async ({ field_definition_id, field_type, name, options, field_configuration }) => {
      try {
        const acct = await ctx.account();
        const data: Record<string, unknown> = { field_type };
        if (name !== undefined) data.name = name;
        const cfg =
          options || field_configuration
            ? buildConfig(field_type, options, field_configuration)
            : undefined;
        if (cfg) data.field_configuration = cfg;
        return ok(
          (
            await ctx
              .client()
              .metadataFields.metadataFieldDefinitionsUpdate(acct, field_definition_id, {
                data,
              } as never)
          ).data,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_metadata_field",
    {
      description: "Delete an account-level custom metadata field definition.",
      inputSchema: { field_definition_id: z.string().describe("Field definition id to delete.") },
    },
    async ({ field_definition_id }) => {
      try {
        const acct = await ctx.account();
        await ctx.client().metadataFields.metadataFieldDefinitionsDelete(acct, field_definition_id);
        return ok({ deleted: field_definition_id });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
