import type { FC } from "hono/jsx";
import { t, type Lang } from "../i18n";
import { EVENT_DAYS } from "./billing";
import { BUG_REPORT_DAYS } from "./signin";

// The privacy page's first section while accounts are open, in place of "No
// Accounts" (pages/docs.tsx). It states what accounts_schema.sql keeps and
// what it never keeps.
export const AccountsPrivacy: FC<{ lang: Lang }> = ({ lang }) => (
  <>
    <p>{t(lang, "account.privacy_kept")}</p>
    <p>{t(lang, "account.privacy_mail")}</p>
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
