/**
 * Shared types for the Frame.io MCP server.
 */

/** Minimal identity captured from Frame.io at auth time, for display/labels. */
export interface FrameioUser {
  id: string;
  name?: string;
  email?: string;
}

/**
 * Auth context, encrypted by workers-oauth-provider and surfaced as `this.props`
 * inside the McpAgent. Adobe tokens NEVER reach the MCP client — they live here,
 * stored encrypted in the grant.
 */
export interface Props {
  /** Adobe IMS access token, used as the Frame.io bearer. */
  accessToken: string;
  /** Adobe IMS refresh token. IMS rotates this on every refresh — must be persisted. */
  refreshToken: string;
  /** Lifetime of the access token in seconds, as reported by IMS `expires_in`. */
  expiresIn: number;
  /** Frame.io identity, for the grant label and the get_me tool. */
  user: FrameioUser;
  [key: string]: unknown;
}

/**
 * Secrets and request-scoped bindings not derivable from wrangler.jsonc.
 * Bindings (OAUTH_KV, MCP_OBJECT) come from the wrangler-generated Env in
 * worker-configuration.d.ts; we merge the rest in below so a single `Env`
 * type covers both.
 */
interface SecretsAndInjected {
  /** Adobe Developer Console OAuth Web App credential. */
  ADOBE_CLIENT_ID: string;
  ADOBE_CLIENT_SECRET: string;
  /** Random 32-byte hex used to HMAC-sign the approved-clients cookie. */
  COOKIE_ENCRYPTION_KEY: string;
  /**
   * Portal lockdown allowlist (comma-separated redirect_uris). Only authorize flows
   * whose redirect_uri is on this list may initiate Adobe OAuth, so the public
   * workers.dev URL can't be used to bypass the MCP portal. See the gate
   * in adobe-handler.ts. Fail-closed: if unset, every /authorize is rejected.
   */
  PORTAL_REDIRECT_URI: string;
  /**
   * Portal lockdown PREFIX allowlist (comma-separated). An authorize flow also passes the
   * gate if its redirect_uri begins with one of these prefixes. Used for the dashboard
   * "Sync capabilities" / authenticate callback, which is per-server
   * (https://dash.cloudflare.com/<account>/one/access-controls/ai-controls/mcp-server/oauth-callback/<server-id>)
   * — one account-pinned prefix covers every frameio server's sync without a
   * redeploy per server. Safe because the code is delivered to Cloudflare's dashboard
   * backend for that account (admin-session bound), not to the caller. Optional/fail-closed.
   */
  PORTAL_REDIRECT_URI_PREFIXES?: string;
  /** Injected by OAuthProvider for the default handler. */
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}

declare global {
  interface Env extends SecretsAndInjected {}
  namespace Cloudflare {
    interface Env extends SecretsAndInjected {}
  }
}

/** Worker environment: wrangler bindings + secrets + injected helpers. */
export type Env = Cloudflare.Env;
