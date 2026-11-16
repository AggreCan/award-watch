import type { FC } from "hono/jsx";
import { fmtInt, t, type Lang } from "../i18n";
import { AUDIT_DAYS } from "./audit";
import { EVENT_DAYS } from "./billing";
import { VIEW_DELIVERY_DAYS } from "./saved_views";
import { DELIVERY_ROW_DAYS } from "./searches";
import { SESSIONS_MAX } from "./session";
import { BUG_REPORT_DAYS } from "./signin";
import { WATCH_DELIVERY_DAYS } from "./watches";

// The accounts database's copies, for the sentence after the deletion one.
// BACKUP_WEEKS: the nightly exports the database each Sunday into one of
// eight slots, each replacing the one from eight weeks before (nightly.yml,
// the "% 8" of its two weekly steps, held equal by
// test/accounts-switch.test.ts). HISTORY_DAYS: D1 Time Travel keeps 30 days
// of the database's history on the paid plan (Cloudflare's D1 documentation).
export const BACKUP_WEEKS = 8;
export const HISTORY_DAYS = 30;

// The privacy page's first section while accounts are open, in place of "No
// Accounts" (pages/docs.tsx). It states what accounts_schema.sql keeps and
// what it never keeps. A saved analytics view is Pro's, so the section says
// what one keeps whenever accounts are open.
// dashboard: Ultra is on sale (pages/docs.tsx), so the section says what a
// dashboard keeps, and what a saved view sent by email keeps beside it. The
// signed-in browsers' sentence follows the session's own, its figures read
// from session.ts and audit.ts (the sweep's AUDIT_DAYS).
export const AccountsPrivacy: FC<{ lang: Lang; dashboard?: boolean }> = ({ lang, dashboard }) => (
  <>
    <p>{t(lang, "account.privacy_kept", { days: DELIVERY_ROW_DAYS })}</p>
    <p>{t(lang, "account.privacy_mail")}</p>
    <p>{t(lang, "watches.privacy", { days: WATCH_DELIVERY_DAYS })}</p>
    <p>{t(lang, "calfeed.privacy_page")}</p>
    <p>{t(lang, "orgclaim.privacy")}</p>
    <p>{t(lang, "briefing.privacy")}</p>
    {dashboard ? <p>{t(lang, "dash.privacy")}</p> : null}
    <p>{t(lang, "views.privacy")}</p>
    {dashboard ? <p>{t(lang, "views.privacy_mail", { days: VIEW_DELIVERY_DAYS })}</p> : null}
    <p>{t(lang, "weekly.privacy")}</p>
    <p>{t(lang, "bugs.privacy", { days: BUG_REPORT_DAYS })}</p>
    <p>{t(lang, "account.privacy_secrets")}</p>
    <p>{t(lang, "account.privacy_sessions", { cap: fmtInt(SESSIONS_MAX, lang), days: fmtInt(AUDIT_DAYS, lang) })}</p>
    <p>{t(lang, "account.privacy_not_kept")}</p>
    <p>{t(lang, "account.privacy_delete")}</p>
    <p>{t(lang, "account.privacy_backup", { weeks: fmtInt(BACKUP_WEEKS, lang), days: fmtInt(HISTORY_DAYS, lang) })}</p>
  </>
);

// The privacy page's Payments section while accounts are open, after the
// accounts section. Reversals go with the payment notices after EVENT_DAYS
// (billing.tsx, sweep). ultra: Ultra is on sale (pages/docs.tsx), so the
// first paragraph names both paid plans, as the Terms do from that day.
export const PaymentsPrivacy: FC<{ lang: Lang; ultra?: boolean }> = ({ lang, ultra }) => (
  <>
    <p>{t(lang, ultra ? "billing.privacy_processor_ultra" : "billing.privacy_processor")}</p>
    <p>{t(lang, "billing.privacy_sent")}</p>
    <p>{t(lang, "billing.privacy_kept", { days: EVENT_DAYS })}</p>
    <p>{t(lang, "billing.privacy_delete")}</p>
  </>
);
