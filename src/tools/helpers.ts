import { FrameioClient, FrameioError } from "frameio";
import { z } from "zod";

/** Returns the current grant's Adobe access token (used as the Frame.io bearer). */
export type TokenGetter = () => string;

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Compact JSON text result. */
export function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** Map a thrown error to a user-actionable MCP error result. */
export function fail(error: unknown): ToolResult {
  if (error instanceof FrameioError) {
    const status = error.statusCode;
    let hint = "";
    if (status === 401) hint = " — access token rejected; re-authenticate.";
    else if (status === 403) hint = " — insufficient permissions for this resource.";
    else if (status === 404) hint = " — not found (check the id and the active account).";
    else if (status === 429) hint = " — rate limited; retry after a short delay.";
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Frame.io API error (${status ?? "?"})${hint}\n${JSON.stringify(error.body ?? error.message)}`,
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}

/** Extract the opaque `after` cursor from a paginated response's `links.next` URL. */
export function nextCursor(link: unknown): string | null {
  if (typeof link !== "string" || !link) return null;
  try {
    return new URL(link).searchParams.get("after");
  } catch {
    return null;
  }
}

/** Shared pagination inputs for list tools. */
export const pageInputs = {
  page_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max items per page (1-100, default 20)."),
  after: z.string().optional().describe("Opaque cursor from a previous response's next_cursor."),
};

/** Normalize an SDK `core.Page<T>` into { items, has_more, next_cursor }. */
export function fromPage(page: {
  data?: unknown[];
  response?: { links?: { next?: string } };
  hasNextPage?: () => boolean;
}) {
  return {
    items: page.data ?? [],
    has_more: page.hasNextPage?.() ?? false,
    next_cursor: nextCursor(page.response?.links?.next),
  };
}

/** Normalize an SDK list *response* object (has `.data` + optional `.links.next`). */
export function fromList(res: unknown) {
  const r = (res ?? {}) as { data?: unknown[]; links?: { next?: string } };
  return { items: r.data ?? [], next_cursor: nextCursor(r.links?.next) };
}

/** Drop keys whose value is undefined (for clean update payloads). */
export function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

type AccountSummary = { id: string; display_name?: string };

/**
 * Per-session Frame.io context: builds an authenticated SDK client and resolves
 * the *active account*. The remote server holds one account for the session
 * (in durable agent state) instead of taking account_id on every tool. When the
 * user has a single account it is resolved and persisted automatically; with
 * several, tools error until `set_account` is called.
 */
export class FrameioContext {
  private memo?: string;

  constructor(
    private getToken: TokenGetter,
    /** Read the persisted active account id from agent state (sync). */
    private readActive: () => string | undefined,
    /** Persist the active account id to durable agent state. */
    private writeActive: (id: string) => void | Promise<void>,
  ) {}

  client(): FrameioClient {
    return new FrameioClient({ token: this.getToken() });
  }

  /** All accounts the signed-in user can access. */
  async accounts(): Promise<AccountSummary[]> {
    const page = await this.client().accounts.index({ page_size: 50 } as never);
    return (page.data ?? []) as AccountSummary[];
  }

  private multipleAccountsError(accts: AccountSummary[], lead: string): Error {
    const opts = accts.map((a) => `${a.display_name ?? a.id} (${a.id})`).join(", ");
    return new Error(`${lead} Options: ${opts}`);
  }

  /** Resolve the active account id, auto-selecting a sole account and persisting it. */
  async account(): Promise<string> {
    if (this.memo) return this.memo;
    const stored = this.readActive();
    if (stored) {
      this.memo = stored;
      return stored;
    }
    const accts = await this.accounts();
    if (accts.length === 0) throw new Error("No Frame.io accounts are available for this user.");
    if (accts.length > 1) {
      throw this.multipleAccountsError(
        accts,
        "Multiple Frame.io accounts available — call set_account to choose one.",
      );
    }
    this.memo = accts[0].id;
    await this.writeActive(this.memo);
    return this.memo;
  }

  /** Set the active account for the session (validates membership, persists). */
  async setActive(accountId: string): Promise<AccountSummary> {
    const accts = await this.accounts();
    const match = accts.find((a) => a.id === accountId);
    if (!match) {
      throw this.multipleAccountsError(accts, `Account ${accountId} is not one of your accounts.`);
    }
    this.memo = accountId;
    await this.writeActive(accountId);
    return match;
  }

  /** The currently active account (resolving the sole-account default if unset). */
  async currentAccount(): Promise<AccountSummary> {
    const id = await this.account();
    const accts = await this.accounts();
    return accts.find((a) => a.id === id) ?? { id };
  }
}
