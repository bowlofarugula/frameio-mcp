import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Env, FrameioUser } from "./types";
import {
  addApprovedClient,
  bindStateToSession,
  createOAuthState,
  generateCSRFProtection,
  isClientApproved,
  OAuthError,
  renderApprovalDialog,
  validateCSRFToken,
  validateOAuthState,
} from "./workers-oauth-utils";

// --- Adobe IMS (Identity Management System) constants ---------------------

/** North-America IMS region. Frame.io accounts live here. */
export const IMS_BASE = "https://ims-na1.adobelogin.com";
export const IMS_AUTHORIZE_URL = `${IMS_BASE}/ims/authorize/v2`;
export const IMS_TOKEN_URL = `${IMS_BASE}/ims/token/v3`;

/**
 * Scopes for an OAuth Web App credential.
 * `offline_access` is what yields a refresh_token — its absence fails *silently*
 * (the token response simply lacks refresh_token). Adobe samples use comma-delimited
 * scopes; space-delimited also works. If IMS returns `invalid_scope`, copy the
 * scope string verbatim from the credential's Scopes tab in the Developer Console.
 */
export const IMS_SCOPES = "openid,email,profile,offline_access,additional_info.roles";

/** Frame.io V4 identity endpoint, used to label the grant. */
const FRAMEIO_ME_URL = "https://api.frame.io/v4/me";

/** Shape of a successful IMS token response. */
export interface ImsTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  sub?: string;
  id_token?: string;
}

/** Basic auth header for IMS confidential-client calls: base64(clientId:clientSecret). */
export function imsBasicAuth(e: Pick<Env, "ADOBE_CLIENT_ID" | "ADOBE_CLIENT_SECRET">): string {
  return `Basic ${btoa(`${e.ADOBE_CLIENT_ID}:${e.ADOBE_CLIENT_SECRET}`)}`;
}

/** Exchange an authorization code for IMS tokens (Web App confidential client). */
export async function exchangeImsCode(
  e: Pick<Env, "ADOBE_CLIENT_ID" | "ADOBE_CLIENT_SECRET">,
  code: string,
): Promise<ImsTokenResponse> {
  const resp = await fetch(IMS_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: imsBasicAuth(e),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new OAuthError(
      "invalid_grant",
      `Adobe IMS token exchange failed (${resp.status}): ${detail.slice(0, 300)}`,
      502,
    );
  }
  return (await resp.json()) as ImsTokenResponse;
}

/** Fetch Frame.io identity for labeling the grant. Best-effort: never blocks auth. */
async function fetchFrameioUser(accessToken: string): Promise<FrameioUser> {
  try {
    const resp = await fetch(FRAMEIO_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!resp.ok) return { id: "unknown" };
    const body = (await resp.json()) as { data?: { id?: string; name?: string; email?: string } };
    const d = body.data ?? {};
    return { id: d.id ?? "unknown", name: d.name, email: d.email };
  } catch {
    return { id: "unknown" };
  }
}

// --- Hono app: /authorize (GET + POST), /callback -------------------------

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

const SERVER_INFO = {
  name: "Frame.io",
  description:
    "Access Adobe Frame.io (V4) — projects, folders, files, comments, and shares — via the Model Context Protocol.",
};

/**
 * Portal lockdown. This Worker's public /authorize endpoint is reachable by anyone
 * (DCR is open so the portal can re-register itself), but only the MCP
 * portal may actually initiate an Adobe OAuth flow. The portal is identified by its
 * registered redirect_uri — Cloudflare Access's fixed outbound-oauth-callback,
 * configured in PORTAL_REDIRECT_URI (comma-separated allowlist).
 *
 * This holds even though an attacker can register a client claiming the portal's
 * redirect: OAuth delivers the authorization code to that redirect — Cloudflare's
 * callback — so an impostor passes this check yet never receives the code. Fail-closed:
 * an unset/empty allowlist rejects everything.
 */
function isPortalRedirect(
  redirectUri: string | undefined,
  allowlist: string | undefined,
  prefixAllowlist?: string | undefined,
): boolean {
  if (!redirectUri) return false;
  const split = (s: string | undefined) =>
    (s ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  // Exact match: the per-user runtime outbound-oauth-callback.
  if (split(allowlist).includes(redirectUri)) return true;
  // Prefix match: the dashboard per-server sync/authenticate callback (account-pinned).
  return split(prefixAllowlist).some((p) => redirectUri.startsWith(p));
}

const PORTAL_ONLY_MESSAGE =
  "This Frame.io MCP server is only reachable through the MCP portal. Direct connection is not permitted.";

function buildImsRedirect(
  request: Request,
  stateToken: string,
  headers: Record<string, string> = {},
): Response {
  const authorizeUrl = new URL(IMS_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", env.ADOBE_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", new URL("/callback", request.url).href);
  authorizeUrl.searchParams.set("scope", IMS_SCOPES);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", stateToken);
  return new Response(null, {
    status: 302,
    headers: { ...headers, location: authorizeUrl.href },
  });
}

app.get("/authorize", async (c) => {
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (error: any) {
    // parseAuthRequest rejects client errors — unknown client, a redirect_uri not
    // registered to the client, a disallowed PKCE method. Those are 400s, not 500s.
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return c.text(`Invalid authorization request: ${error?.message ?? "unknown"}`, 400);
  }

  const { clientId } = oauthReqInfo;
  if (!clientId) {
    return c.text("Invalid request", 400);
  }

  // Portal lockdown: refuse any flow not bound for the portal's redirect_uri.
  if (
    !isPortalRedirect(
      oauthReqInfo.redirectUri,
      c.env.PORTAL_REDIRECT_URI,
      c.env.PORTAL_REDIRECT_URI_PREFIXES,
    )
  ) {
    return c.text(PORTAL_ONLY_MESSAGE, 403);
  }

  // Returning client that already consented — skip the dialog, still bind state to session.
  if (await isClientApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie } = await bindStateToSession(stateToken);
    return buildImsRedirect(c.req.raw, stateToken, { "Set-Cookie": setCookie });
  }

  const { token: csrfToken, setCookie } = generateCSRFProtection();
  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    csrfToken,
    server: SERVER_INFO,
    setCookie,
    state: { oauthReqInfo },
  });
});

app.post("/authorize", async (c) => {
  try {
    const formData = await c.req.raw.formData();
    validateCSRFToken(formData, c.req.raw);

    const encodedState = formData.get("state");
    if (!encodedState || typeof encodedState !== "string") {
      return c.text("Missing state in form data", 400);
    }

    let state: { oauthReqInfo?: AuthRequest };
    try {
      state = JSON.parse(atob(encodedState));
    } catch {
      return c.text("Invalid state data", 400);
    }
    if (!state.oauthReqInfo?.clientId) {
      return c.text("Invalid request", 400);
    }

    // Portal lockdown (defense in depth — the GET path already gated this).
    if (
      !isPortalRedirect(
        state.oauthReqInfo.redirectUri,
        c.env.PORTAL_REDIRECT_URI,
        c.env.PORTAL_REDIRECT_URI_PREFIXES,
      )
    ) {
      return c.text(PORTAL_ONLY_MESSAGE, 403);
    }

    const approvedClientCookie = await addApprovedClient(
      c.req.raw,
      state.oauthReqInfo.clientId,
      c.env.COOKIE_ENCRYPTION_KEY,
    );
    const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    const headers = new Headers();
    headers.append("Set-Cookie", approvedClientCookie);
    headers.append("Set-Cookie", sessionBindingCookie);

    return buildImsRedirect(c.req.raw, stateToken, Object.fromEntries(headers));
  } catch (error: any) {
    console.error("POST /authorize error:", error);
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return c.text(`Internal server error: ${error?.message ?? "unknown"}`, 500);
  }
});

app.get("/callback", async (c) => {
  // Validate state (KV one-time token + session-binding cookie) before trusting `code`.
  let oauthReqInfo: AuthRequest;
  let clearSessionCookie: string;
  try {
    const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
    oauthReqInfo = result.oauthReqInfo;
    clearSessionCookie = result.clearCookie;
  } catch (error: any) {
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return c.text("Internal server error", 500);
  }

  if (!oauthReqInfo.clientId) {
    return c.text("Invalid OAuth request data", 400);
  }

  const code = c.req.query("code");
  if (!code) {
    return c.text("Missing authorization code", 400);
  }

  let tokens: ImsTokenResponse;
  try {
    tokens = await exchangeImsCode(c.env, code);
  } catch (error: any) {
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return c.text("Token exchange failed", 502);
  }

  if (!tokens.refresh_token) {
    // offline_access not granted — refresh would be impossible. Fail loudly rather
    // than issue a grant that breaks on first refresh.
    return c.text(
      "Adobe IMS did not return a refresh token. Ensure the 'offline_access' scope is enabled on the credential.",
      400,
    );
  }

  const user = await fetchFrameioUser(tokens.access_token);

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    metadata: { label: user.name ?? user.email ?? user.id },
    props: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      user,
    },
    request: oauthReqInfo,
    scope: oauthReqInfo.scope,
    userId: user.id,
  });

  const headers = new Headers({ Location: redirectTo });
  if (clearSessionCookie) {
    headers.set("Set-Cookie", clearSessionCookie);
  }
  return new Response(null, { status: 302, headers });
});

export { app as AdobeHandler };
