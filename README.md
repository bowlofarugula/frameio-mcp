# frameio-mcp

A remote [Model Context Protocol](https://modelcontextprotocol.io) server running on
Cloudflare Workers that exposes the **Adobe Frame.io V4 API** as MCP tools, using
Frame.io's official TypeScript SDK.

Authentication is delegated to **Adobe IMS** (Identity Management System). The Worker
acts as an OAuth server to MCP clients (via
[`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider))
and as an OAuth client to Adobe IMS upstream. **Adobe tokens never reach the MCP
client** — they are stored encrypted in the grant and surfaced to the server as
`this.props`.

## Tools

Hierarchy: **account → workspace → project → folder → files** (and version stacks).
~70 tools covering most of the V4 SDK surface, by area:

| Area | Tools |
| --- | --- |
| Identity / account | `whoami`, `list_accounts`, `get_account`, `set_account` |
| Workspaces | `list_workspaces`, `show_workspace`, `create_workspace`, `update_workspace`, `delete_workspace` |
| Projects | `list_projects`, `show_project`, `create_project`, `update_project`, `delete_project` |
| Folders | `list_folder`, `list_project_contents`, `show_folder`, `create_folder`, `rename_folder`, `move_folder`, `copy_folder`, `delete_folder` |
| Files | `list_files`, `show_file`, `get_file_status`, `rename_file`, `move_file`, `copy_file`, `delete_file` |
| Transfer | `remote_upload` (from URL), `import_file` (BYOS by key) |
| Version stacks | `list_version_stacks`, `show_version_stack`, `list_versions`, `create_version_stack`, `move_version_stack`, `copy_version_stack` |
| Comments | `list_comments`, `show_comment`, `create_comment` (timecode/frame), `update_comment` (edit/resolve), `delete_comment`, `delete_comment_attachment` |
| Shares | `list_shares`, `show_share`, `create_share`, `update_share`, `delete_share`, `add_share_asset`, `remove_share_asset`, `list_share_reviewers`, `add_share_reviewers`, `remove_share_reviewers` |
| Metadata | `list_metadata_fields`, `create_metadata_field`, `update_metadata_field`, `delete_metadata_field`, `get_file_metadata`, `set_file_metadata` |
| Discovery | `search` (lexical or nlp) |
| Webhooks | `list_webhooks`, `show_webhook`, `create_webhook`, `update_webhook`, `delete_webhook` |
| Permissions | `list_account_users`, `list_workspace_users`, `set_workspace_user_role`, `remove_workspace_user`, `list_project_users`, `set_project_user_role`, `remove_project_user` |
| Audit | `list_audit_logs` |

### Account context

Tools operate on a single **active account** held in durable session state, so they
**don't** take an `account_id` argument. When you have one account it is resolved and
remembered automatically; with several, tools error until you call **`set_account`**
(`list_accounts` to discover, `get_account` to see the current one).

### Pagination

List tools accept `page_size` (1–100) and `after` (opaque cursor); responses are
`{ items, next_cursor }` (some also `has_more`). Pass `next_cursor` as the next `after`.

> This server mirrors the local stdio server at
> [`bowlofarugula/frameio-plugins`](https://github.com/bowlofarugula/frameio-plugins),
> minus tools that require a local filesystem (`upload_file`, `download_file`,
> `add_comment_attachment` — all read/write a local path). Use `remote_upload` to ingest
> from a URL, and `show_file` with `include=media_links.original` to get a download URL.

## Architecture

```
MCP client ──/authorize──▶ Worker (redirect_uri allowlist → approval dialog, CSRF + state→KV)
           ──302──▶ Adobe IMS /ims/authorize/v2 (user signs in with Adobe ID, consents)
IMS ──/callback──▶ Worker (validates state) ──POST /ims/token/v3──▶ access + refresh tokens
Worker ──completeAuthorization({ props })──▶ 302 back to MCP client with an MCP auth code
MCP client ──/token──▶ Worker (workers-oauth-provider) ──▶ MCP bearer token
MCP client ──/mcp (bearer)──▶ McpAgent: props decrypted into this.props, Frame.io SDK calls
```

- **Token TTL** tracks Adobe's `expires_in`.
- **On MCP refresh**, the Worker refreshes against IMS in lock-step. IMS **rotates the
  refresh token on every refresh**, and the new one is persisted via `newProps`. An IMS
  refresh failure throws `invalid_grant`, forcing the client to re-authenticate.

### Access control (portal lockdown)

`/authorize` is gated by **`PORTAL_REDIRECT_URI`** — a comma-separated allowlist of redirect
URIs. Only an authorize request whose `redirect_uri` is on the list may start the Adobe
sign-in flow; everything else is refused with `403`. This stops the public
`*.workers.dev` URL from being used to bypass an upstream gateway — e.g. a Cloudflare
[MCP server portal](https://developers.cloudflare.com/cloudflare-one/) that front-ends the
Worker and authenticates users before forwarding requests.

- It holds even though Dynamic Client Registration is open: an attacker can *claim* an
  allow-listed redirect, but the OAuth code is delivered **to that redirect** — the
  gateway's callback — so they never receive it.
- **Fail-closed:** if `PORTAL_REDIRECT_URI` is unset/empty, every `/authorize` is refused.
- It's a non-secret value, so it ships as a `vars` entry in `wrangler.jsonc`. The default is
  Cloudflare Access's portal callback
  (`https://oauth-callbacks.cloudflareaccess.com/cdn-cgi/access/outbound-oauth-callback`).
- Per-user Adobe OAuth is unaffected — each user still signs into their own Adobe identity
  through the gateway.

To allow a **direct** client (the MCP Inspector, `scripts/e2e.py`, or a deployment with no
portal), add that client's redirect to the list: for local `wrangler dev`, override it in
`.dev.vars` (e.g. `PORTAL_REDIRECT_URI=http://localhost:6274/oauth/callback`); for a
deployment, edit the `vars` entry in `wrangler.jsonc`.

## Adobe Developer Console setup

1. Create a project at <https://developer.adobe.com/console> and add the **Frame.io API**.
2. Add an **OAuth Web App** credential (this is the only user-auth credential type that is
   a confidential client *and* issues refresh tokens via `offline_access`).
3. Set the **Redirect URI** to your deployed callback (HTTPS, must match exactly):
   ```
   https://frameio-mcp.<your-subdomain>.workers.dev/callback
   ```
4. Scopes: `openid, email, profile, offline_access, additional_info.roles`. If IMS returns
   `invalid_scope`, copy the scope string verbatim from the credential's **Scopes** tab.
5. While the project is **In Development**, only allow-listed beta-user emails can sign in —
   add the testers under the project's user access settings.

> Gotcha: a mismatched redirect URI does **not** error — IMS silently redirects to the
> credential's *Default Redirect URI*. Make sure the callback above is registered.

## Deploy

```bash
npm install
cp .env.example .env            # your local, non-secret config (git-ignored)

# 1. KV namespace — create one and put its id in .env as OAUTH_KV_ID
#    (the committed wrangler.jsonc keeps a <your-kv-namespace-id> placeholder;
#     `npm run dev`/`deploy` inject your id into a generated config):
npx wrangler kv namespace create OAUTH_KV

# 2. Secrets (stored as Worker secrets, never in the repo):
npx wrangler secret put ADOBE_CLIENT_ID
npx wrangler secret put ADOBE_CLIENT_SECRET
openssl rand -hex 32 | npx wrangler secret put COOKIE_ENCRYPTION_KEY

# 3. Deploy:
npm run deploy
```

The deployed URL is `https://frameio-mcp.<your-subdomain>.workers.dev`. Confirm it matches
the Adobe credential's redirect URI (`…/callback`); if not, update the credential (editable
while In Development).

> Before exposing the deployment, review **`PORTAL_REDIRECT_URI`** in `wrangler.jsonc` — it
> allow-lists which `redirect_uri`s may sign in (see
> [Access control](#access-control-portal-lockdown)). The default locks the Worker to a
> Cloudflare MCP portal; set it to your client's redirect to connect directly.

> First-time accounts: if `wrangler deploy` reports "You need a workers.dev subdomain",
> open the Cloudflare dashboard → **Workers & Pages** once to create the subdomain, then
> redeploy.

## Local development

```bash
cp .env.example .env             # OAUTH_KV_ID + FRAMEIO_MCP_BASE (git-ignored)
cp .dev.vars.example .dev.vars   # the three secret values (git-ignored)
npm run dev
```

## Connecting a client

- **MCP endpoint:** `https://frameio-mcp.<your-subdomain>.workers.dev/mcp` (Streamable HTTP;
  a legacy SSE endpoint is at `/sse`).
- The server supports **Dynamic Client Registration** (`/register`), so clients like the
  MCP Inspector and Claude can register automatically.
- **Sign-in is gated** by `PORTAL_REDIRECT_URI` (see
  [Access control](#access-control-portal-lockdown)): a client can only complete the Adobe
  flow if its `redirect_uri` is allow-listed. As shipped that's the MCP portal's callback —
  so connect **through the portal**, or allow-list your client's redirect to connect
  directly. The two flows below are direct, so they need their redirect on the list.

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
```

Connect to the `/mcp` URL. You'll be taken through registration → the approval dialog →
Adobe sign-in, then returned with a token. Try `whoami`, then `list_accounts` →
`set_account` → `list_workspaces` → `list_projects`.

### Headless verification

`scripts/e2e.py` drives the whole flow without an MCP client: it DCR-registers, prints
an authorize URL to open + sign in, captures the redirect on a local listener, exchanges
the code for an MCP token, then runs the MCP handshake and calls the read tools against
live data. It caches the token at `/tmp/mcp_token.json` so you can re-run individual tools
without signing in again. It reads `FRAMEIO_MCP_BASE` from `.env` (or the environment):

```bash
python3 scripts/e2e.py                        # full flow (opens a URL to sign in)
python3 scripts/e2e.py call                   # re-run the read suite with the cached token
python3 scripts/e2e.py call whoami '{}'       # call one tool with JSON args
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Local Worker (`wrangler dev`). |
| `npm run deploy` | Deploy to Cloudflare. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` / `lint:fix` | oxlint. |
| `npm run format` / `format:check` | oxfmt. |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing wrangler.jsonc. |

## Notes

- The `frameio` package's ESM entry has an unresolved re-export; `wrangler.jsonc` aliases
  `frameio` to its CJS build so esbuild can bundle it.
- V4 has no "default account" concept (`whoami` carries no `account_id`, and every API
  path is account-scoped), so the active account is a convenience layer this server adds:
  it's resolved from `list_accounts` and held in the McpAgent's durable state by
  `set_account`. See **Account context** above.

## Security

Adobe tokens are never returned to MCP clients — they live encrypted in the OAuth grant
and surface to the Worker only as `this.props`. Secrets (`ADOBE_CLIENT_SECRET`,
`COOKIE_ENCRYPTION_KEY`) are Cloudflare Worker secrets, never committed. See
[`SECURITY.md`](SECURITY.md) for the threat model and how to report a vulnerability.

## Support & contributing

Best-effort maintenance — I'll do my best to fix bugs and security issues, and contributions
are very welcome. Open an issue or a pull request; help with docs, tests, or features is
encouraged. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

This is an **unofficial, community-built** integration. It is not affiliated with,
endorsed by, or supported by Adobe or Frame.io. "Frame.io" and "Adobe" are trademarks of
their respective owners and are used here only to describe what this tool connects to. Use
it in accordance with Frame.io's API terms.

## License

[Apache-2.0](LICENSE) © 2026 Ian McDonald
