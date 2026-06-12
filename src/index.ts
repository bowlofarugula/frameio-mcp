import { env } from "cloudflare:workers";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import type {
  TokenExchangeCallbackOptions,
  TokenExchangeCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { AdobeHandler, IMS_TOKEN_URL, imsBasicAuth, type ImsTokenResponse } from "./adobe-handler";
import { FrameioContext, registerFrameioTools } from "./tools";
import type { Env, Props } from "./types";
import { OAuthError } from "./workers-oauth-utils";

/** Durable per-session state: which Frame.io account tools operate on. */
interface State {
  activeAccountId?: string;
}

/**
 * The Frame.io MCP server. One Durable Object instance per authenticated grant;
 * the decrypted auth context (Adobe tokens + identity) is available as `this.props`.
 * The chosen account is held in durable agent state (`set_account`) so tools need
 * not take an account_id — see FrameioContext.
 */
export class FrameioMCP extends McpAgent<Env, State, Props> {
  server = new McpServer(
    { name: "Frame.io", version: "2.0.0" },
    {
      instructions:
        "Adobe Frame.io (V4) — video/media review and collaboration. Use these tools whenever the " +
        "user mentions Frame.io, video/footage review, assets/media, review links, or frame-accurate " +
        "comments. Capabilities: browse the account → workspace → project → folder → file hierarchy; " +
        "create/manage projects, folders, and files; upload media from a URL (remote_upload) or by " +
        "storage key (import_file); version stacks; post, edit, and resolve comments (timecode/frame " +
        "accurate); create and manage shares and reviewers (review links); custom metadata fields; " +
        "asset search; webhooks; and account/workspace/project membership. Tools act on one active " +
        "account held in session — call set_account to switch (list_accounts to discover). List tools " +
        "paginate via page_size + after, returning { items, next_cursor }.",
    },
  );
  initialState: State = {};

  async init(): Promise<void> {
    const ctx = new FrameioContext(
      () => this.props!.accessToken,
      () => this.state.activeAccountId,
      (activeAccountId) => this.setState({ ...this.state, activeAccountId }),
    );
    registerFrameioTools(this.server, ctx);
  }
}

/**
 * Keeps the MCP access-token lifecycle in lock-step with Adobe IMS.
 *
 * - On the initial code exchange, cap the MCP access token's TTL to the IMS
 *   `expires_in` so we never hand out an MCP token that outlives the upstream one.
 * - On MCP refresh, refresh against IMS too. IMS ROTATES the refresh token on every
 *   refresh — the new one must be persisted via `newProps` or the chain breaks on the
 *   following refresh. A failed IMS refresh throws `invalid_grant`, forcing the client
 *   to re-authenticate.
 */
async function tokenExchangeCallback(
  options: TokenExchangeCallbackOptions,
): Promise<TokenExchangeCallbackResult | void> {
  const props = options.props as Props;

  if (options.grantType === "authorization_code") {
    return { accessTokenTTL: props.expiresIn, newProps: { ...props } };
  }

  if (options.grantType === "refresh_token") {
    const resp = await fetch(IMS_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: imsBasicAuth(env),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: props.refreshToken,
      }),
    });

    if (!resp.ok) {
      // Terminal: surface as invalid_grant so the client re-runs the full auth flow.
      throw new OAuthError("invalid_grant", "Adobe IMS refresh failed; re-authenticate", 400);
    }

    const tokens = (await resp.json()) as ImsTokenResponse;
    const updated: Props = {
      ...props,
      accessToken: tokens.access_token,
      // IMS rotates the refresh token; fall back to the prior one only if absent.
      refreshToken: tokens.refresh_token ?? props.refreshToken,
      expiresIn: tokens.expires_in,
    };

    return {
      accessTokenProps: updated,
      newProps: updated,
      accessTokenTTL: tokens.expires_in,
    };
  }
}

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": FrameioMCP.serve("/mcp"),
    "/sse": FrameioMCP.serveSSE("/sse"),
  },
  defaultHandler: AdobeHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  tokenExchangeCallback,
});
