import type { Env } from "../env";

// The audit trail of the accounts database: what happened, to which user id,
// when. detail is a short fixed word or count chosen by the code; never an
// address, a code, a token, a key or anything a visitor typed. A failure to
// write it is logged without detail and never fails the request.
export type AuditEvent =
  | "code_requested" | "code_limited" | "code_wrong" | "code_locked" | "signed_in" | "user_created"
  | "signed_out" | "signed_out_everywhere" | "mail_not_sent" | "mail_failed"
  | "search_added" | "search_changed" | "search_deleted" | "searches_imported"
  | "key_created" | "key_revoked" | "key_refused" | "plan_changed" | "deleted";

export const AUDIT_DAYS = 90;

export async function audit(env: Env, userId: string | null, event: AuditEvent, detail: string | null = null, now = new Date()): Promise<void> {
  if (!env.ACCOUNTS) return;
  try {
    await env.ACCOUNTS.prepare("INSERT INTO audit (user_id, event, at, detail) VALUES (?, ?, ?, ?)")
      .bind(userId, event, now.toISOString(), detail === null ? null : detail.slice(0, 120)).run();
  } catch {
    console.error(`account audit: ${event} not recorded`);
  }
}
