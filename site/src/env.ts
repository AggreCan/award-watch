import type { Lang } from "./i18n";

export interface Env {
  // The forms database: organization responses, corrections and interest in
  // email alerts only.
  DB: D1Database;
  // The hosted search database (src/search_db.ts), filled by the nightly
  // sync. Absent or empty, /search explains and links the directory.
  SEARCH?: D1Database;
  // The records database (src/records_db.ts, docs/analytics.md), filled by the
  // nightly sync and read by the analytics views only. Absent, empty or
  // loading, a view says it is not available.
  RECORDS?: D1Database;
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
  // The sender's postal mailing address, on one line, which every weekly
  // email prints in its footer as Canada's anti-spam law asks of a
  // commercial message (src/account/weekly.ts; docs/accounts.md, Weekly
  // email). Set with `wrangler secret put MAIL_ADDRESS`, never written into
  // the repository or a workflow's log. Unset, no weekly email is sent and
  // the delivery run's line says so.
  MAIL_ADDRESS?: string;
  // Sign-in and code posts per address (wrangler.jsonc "ratelimits").
  AUTH_LIMIT?: RateLimit;
  // A delivery's stop link, both methods, per address (wrangler.jsonc "ratelimits").
  STOP_LIMIT?: RateLimit;
  // The payment service's webhook posts per address (wrangler.jsonc "ratelimits").
  WEBHOOK_LIMIT?: RateLimit;
  // A calendar feed's reads per address (wrangler.jsonc "ratelimits", src/account/feeds.ts).
  CALENDAR_LIMIT?: RateLimit;
  // The keyed API's requests per API key (wrangler.jsonc "ratelimits",
  // src/api_keyed.ts), on top of API_LIMIT's per-address cap.
  KEY_LIMIT?: RateLimit;
  // The operator console (src/account/admin.tsx; docs/accounts.md, Operator
  // console). All three are secrets set with `wrangler secret put`, never
  // variables: the repository is public. OPERATOR_EMAILS holds the
  // comma-separated addresses whose sessions may open /admin; unset, /admin
  // is the site's 404 for everyone. ACCESS_AUD is the Cloudflare Access
  // application's AUD tag and ACCESS_TEAM_DOMAIN its team
  // ("<team>.cloudflareaccess.com"); once ACCESS_AUD is set, a request must
  // also carry an Access token for the same address.
  OPERATOR_EMAILS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;

  // -- payments (src/account/stripe.ts and billing.tsx; docs/accounts.md) -----
  // Stripe's secret API key and the webhook endpoint's signing secret, set
  // with `wrangler secret put`. Both set: payments go through Stripe. Either
  // missing: the stub source, and the billing page says Pro is not available
  // yet.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // The two Stripe price ids for Pro (variables in wrangler.jsonc).
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
  // The figures the billing page shows beside them, in Canadian dollars, as
  // text (digits, cents optional); the code holds no price. A checkout is offered
  // only while both price ids and both figures are set.
  PRICE_MONTHLY_CAD?: string;
  PRICE_YEARLY_CAD?: string;
  // Ultra, the plan above Pro (docs/accounts.md, Ultra): its Stripe product
  // id (prod_...), its two price ids and the two figures shown beside them,
  // variables in wrangler.jsonc like Pro's. Nothing offers Ultra unless all
  // five are set and in form, the payment source offers Pro, and the
  // entitlement_tiers table is on the accounts database (payments.ts
  // ultraOnSale). The product id also maps a subscription to Ultra in the
  // webhook (stripe.ts planOfSubscription).
  STRIPE_PRODUCT_ULTRA?: string;
  STRIPE_PRICE_ULTRA_MONTHLY?: string;
  STRIPE_PRICE_ULTRA_YEARLY?: string;
  PRICE_ULTRA_MONTHLY_CAD?: string;
  PRICE_ULTRA_YEARLY_CAD?: string;

  // -- the landing page (src/pages/landing.tsx, docs/landing.md) ---------------
  // Brandfetch's Logo API client id, for the logos in the landing page's
  // scrolling band. Public by design (it sits in each <img> address), but
  // never written into the repository: the deploy passes it from the
  // repository variable of the same name (`wrangler deploy --var`). Unset,
  // the band shows the names alone.
  BRANDFETCH_CLIENT_ID?: string;

  // -- the live mail check (src/account/mail_check.ts, docs/mail.md) ----------
  // The operator's test inbox: the one address POST /admin/mail-check sends
  // to, one message of each template. Both deploys pass it to the Worker from
  // the repository secret of the same name (`wrangler deploy --var`), a secret
  // rather than a variable so the address never shows in the public run logs;
  // never written into the repository. Unset, the route answers 400 and sends
  // nothing.
  MAIL_TEST_TO?: string;
  // The bearer token the mail-check workflow sends to that route, its only
  // use: set with `wrangler secret put`, the same value as the repository
  // secret of the same name. Unset or shorter than MAIL_CHECK_TOKEN_MIN, the
  // route takes no token and answers only an operator's session.
  MAIL_CHECK_TOKEN?: string;
}

export type AppEnv = {
  Bindings: Env;
  // sameDayAt: the last same-day cut's time, set by the band (pages/intraday.tsx
  // sameDayView) when a page shows the same-day notices; page() hands it to
  // the top bar's sub-daily timer (src/refresh.tsx).
  Variables: { lang: Lang; sameDayAt?: string };
};
