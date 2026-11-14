import type { FC } from "hono/jsx";
import { t, type Lang } from "../i18n";
import { EVENT_DAYS } from "./billing";
import { VIEW_DELIVERY_DAYS } from "./saved_views";
import { BUG_REPORT_DAYS } from "./signin";
import { WATCH_DELIVERY_DAYS } from "./watches";

// The privacy page's first section while accounts are open, in place of "No
// Accounts" (pages/docs.tsx). It states what accounts_schema.sql keeps and
// what it never keeps. A saved analytics view is Pro's, so the section says
// what one keeps whenever accounts are open.
// dashboard: Ultra is on sale (pages/docs.tsx), so the section says what a
// dashboard keeps, and what a saved view sent by email keeps beside it.
export const AccountsPrivacy: FC<{ lang: Lang; dashboard?: boolean }> = ({ lang, dashboard }) => (
  <>
    <p>{t(lang, "account.privacy_kept")}</p>
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
    <p>{t(lang, "account.privacy_not_kept")}</p>
    <p>{t(lang, "account.privacy_delete")}</p>
  </>
);

// The privacy page's Payments section while accounts are open, after the
// accounts section. Reversals go with the payment notices after EVENT_DAYS
// (billing.tsx, sweep).
export const PaymentsPrivacy: FC<{ lang: Lang }> = ({ lang }) => (
  <>
    <p>{t(lang, "billing.privacy_processor")}</p>
    <p>{t(lang, "billing.privacy_sent")}</p>
    <p>{t(lang, "billing.privacy_kept", { days: EVENT_DAYS })}</p>
    <p>{t(lang, "billing.privacy_delete")}</p>
  </>
);
