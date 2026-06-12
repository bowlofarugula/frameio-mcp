# Security

## Reporting a vulnerability

Please report security issues **privately** rather than opening a public issue:

- Use GitHub's [private vulnerability reporting](https://github.com/bowlofarugula/frameio-mcp/security/advisories/new), or
- Email the maintainer (see the commit history / GitHub profile).

Please include reproduction steps and the affected version/commit. You'll get an
acknowledgement as soon as practical, and I'll make a best effort to address valid
reports promptly.

## How secrets and tokens are handled

- **Adobe tokens never reach the MCP client.** The Adobe IMS access/refresh tokens are
  stored encrypted in the OAuth grant by
  [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
  and are surfaced to the Worker only as `this.props`. They are never logged or returned
  in tool output.
- **Server secrets are not in the repo.** `ADOBE_CLIENT_ID`, `ADOBE_CLIENT_SECRET`, and
  `COOKIE_ENCRYPTION_KEY` are set as Cloudflare Worker secrets (`wrangler secret put`).
  `.dev.vars` (local secrets) is git-ignored; only `.dev.vars.example` is tracked.
- **The Adobe credential is a confidential OAuth Web App.** The client secret lives only
  in Worker secrets; `COOKIE_ENCRYPTION_KEY` (a random 32-byte hex) signs the
  approved-clients cookie.

## OAuth flow protections

- **Portal lockdown:** `/authorize` enforces a `PORTAL_REDIRECT_URI` allowlist — only
  requests whose `redirect_uri` is on the list may start the Adobe flow (others get `403`,
  fail-closed if unset). This prevents the public `*.workers.dev` URL from being used to
  bypass an upstream gateway, and holds even with open Dynamic Client Registration: the
  authorization code is delivered to the allow-listed redirect (the gateway's callback), so
  a client that merely *claims* it never receives the code. See **Access control** in the
  [README](README.md#access-control-portal-lockdown).
- **CSRF:** the approval form carries a one-time `__Host-CSRF_TOKEN` cookie (RFC 9700).
- **State binding:** the OAuth `state` is stored one-time in KV and bound to the browser
  session via a hashed `__Host-CONSENTED_STATE` cookie, so a leaked `state` can't be
  replayed from another session.
- **Cookies** use the `__Host-` prefix with `Secure`, `HttpOnly`, `SameSite=Lax`.
- **Output is escaped:** all client-supplied values rendered in the approval dialog are
  HTML-escaped, and redirect/URI values are scheme-validated (http/https only).
- **Token rotation:** Adobe rotates the refresh token on every refresh; the new one is
  persisted in lock-step, and a failed upstream refresh surfaces as `invalid_grant` to
  force re-authentication.

## Scope

This project is a deployable Cloudflare Worker, not a published library. Running it means
operating your own Adobe credential and Cloudflare account; you are responsible for the
secrets you configure and the access your Adobe credential grants.
