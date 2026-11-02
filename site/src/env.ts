import type { Lang } from "./i18n";

export interface Env {
  // The forms database: organization responses, corrections and interest in
  // email alerts only.
  DB: D1Database;
  // The hosted search database (src/search_db.ts), filled by the nightly
  // sync. Absent or empty, /search explains and links the directory.
  SEARCH?: D1Database;
  DATA?: R2Bucket;
  ASSETS?: Fetcher;
  SCHEMA_SQL?: string;
  SEED_SQL?: string;
  // Daily check: the email binding, the sender on the zone, and the operator's
  // address (a secret, never in the repository).
  ALERTS?: SendEmail;
  ALERT_FROM?: string;
  ALERT_EMAIL?: string;
  // The two addresses the daily check's email links to: the workflow's run
  // log and the site's data page. Variables rather than code, so the
  // repository names neither until the operator sets them.
  RUN_LOG_URL?: string;
  SITE_URL?: string;
  // Rate limiters (wrangler.jsonc "ratelimits"). Absent in a bare test
  // environment, in which case nothing is limited.
  PAGE_LIMIT?: RateLimit;
  API_LIMIT?: RateLimit;
  DOWNLOAD_LIMIT?: RateLimit;
  FORM_LIMIT?: RateLimit;
  FEED_LIMIT?: RateLimit;
  // Aggregate response counts (src/views.ts). Absent in tests and local
  // development, in which case nothing is counted.
  VIEWS?: AnalyticsEngineDataset;
  // The secret behind the daily visitor code (src/views.ts): the day's salt
  // is HMAC-SHA-256 of the UTC date under it. Unset: no code is written and
  // the roll-up counts no unique visitors. Set with `wrangler secret put`.
  VIEWS_SALT_KEY?: string;
  // A fixed instant ("2026-10-31T16:00:00Z") for the pages' clock, which
  // otherwise reads the time of the request (src/closing.ts). The tests set
  // it so the fixtures' closing states hold; never set in production.
  NOW?: string;

  // -- accounts (src/account/, docs/accounts.md) -----------------------------
  // The accounts database, apart from the forms database on purpose.
  ACCOUNTS?: D1Database;
  // The switch: "true" opens /account. Anything else keeps every account
  // route a 404 and every public page exactly as it was.
  ACCOUNTS_ENABLED?: string;
  // "log" writes sign-in messages to the local outbox, and only on a local
  // host. Unset (production), they go out through the MAIL binding, or to
  // the stub sender when the binding or MAIL_FROM is missing.
  MAIL_SENDER?: string;
  // Cloudflare Email Sending, the accounts module's own binding (ALERTS stays
  // the daily check's). No key: the binding is the credential.
  MAIL?: SendEmail;
  // The sign-in messages' sender, an address on the domain onboarded for
  // Email Sending (a variable in wrangler.jsonc).
  MAIL_FROM?: string;
  // Sign-in and code posts per address (wrangler.jsonc "ratelimits").
  AUTH_LIMIT?: RateLimit;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { lang: Lang };
};
