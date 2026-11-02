import type { Lang } from "./i18n";

export interface Env {
  // The forms database: organization responses and corrections only.
  DB: D1Database;
  // The hosted search database (src/search_db.ts), filled by the nightly
  // sync. Absent or empty, /search explains and links the directory.
  SEARCH?: D1Database;
  DATA?: R2Bucket;
  ASSETS?: Fetcher;
  SCHEMA_SQL?: string;
  SEED_SQL?: string;
  // Support page: the payment page address and the button text in English
  // and French. Empty or unset DONATE_URL keeps donations closed (no button).
  DONATE_URL?: string;
  DONATE_LABEL?: string;
  DONATE_LABEL_FR?: string;
  // The donation page's webhook token (a Worker secret). Unset keeps the
  // webhook route closed; a notice is stored only when its token matches.
  KOFI_VERIFICATION_TOKEN?: string;
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
}

export type AppEnv = {
  Bindings: Env;
  Variables: { lang: Lang };
};
