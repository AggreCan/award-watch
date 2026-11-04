-- Accounts: the tables of the awardwatch-accounts database (binding ACCOUNTS
-- in wrangler.jsonc), kept apart from the forms database (DB) on purpose:
-- this one holds the only records that tie an address to a person's use of
-- the site, and nothing else reads it. The code is site/src/account/; the
-- design and the operator's steps are docs/accounts.md.
--
-- Applied locally by `npm run db:local`, and by hand on the account:
--   npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
-- Every statement is idempotent, so a second run changes nothing.
--
-- Datetimes are ISO in UTC with a trailing Z. Ids are 32 random hex
-- characters (crypto.getRandomValues) unless a column says otherwise. No
-- table holds a name, a postal address, a user agent or an IP address; no
-- token, code or key is stored, only its SHA-256 hash, apart from the stop
-- secret of delivery_tokens (below), which every message must carry.

-- One row per address that has signed in. The plan columns are a cache of
-- the last plan computed from entitlements (src/account/entitlements.ts):
-- the entitlements rows decide, and the cache answers only while they
-- cannot be read. Deletion keeps the row with its email replaced by
-- "deleted:" and a hash under a random salt that is thrown away, so the row
-- proves nothing about which address it was and the address can sign up
-- again as a new account.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,                    -- trimmed and lower-cased, at most 254 characters
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'fr')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  plan_until TEXT,                               -- the end of the entitlement behind plan; NULL for none or no end
  deleted_at TEXT
);
-- The operator console's accounts table (/admin/accounts) opens newest
-- sign-up first, by created_at and then id; this index reads its first page
-- in that order without sorting every account.
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at, id);

-- A sign-in request: a 6-digit code and a link token, sent together, either
-- one good once, for 15 minutes. code_hash is SHA-256 of the row id and the
-- code (the id salts it); link_hash is SHA-256 of the link's secret. Five
-- wrong codes lock the row. user_id stays NULL until the first sign-in
-- creates the user. ip_hash is a daily-salted hash made the way views.ts
-- makes its visitor code (NULL without VIEWS_SALT_KEY), never an address.
-- Rows go after a day.
CREATE TABLE IF NOT EXISTS magic_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  link_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,           -- wrong codes tried against this row
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_magic_codes_email ON magic_codes(email, created_at);

-- A wrong code or link tried for an address: at most five in an hour per
-- address, across all its sign-in requests (src/account/signin.ts). A row is
-- written before the try is compared, in one statement with the hour's
-- count, and removed when the try matches or finds nothing to compare, so
-- tries sent at the same moment cannot pass the cap. A new sign-in request
-- does not clear them. Rows go after a day, and with the account.
CREATE TABLE IF NOT EXISTS code_misses (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_code_misses_email ON code_misses(email, at);

-- A signed-in browser. The cookie __Host-aw_session holds "<id>.<secret>"; the row
-- holds the id and SHA-256 of the secret, never the secret. 30 days,
-- extended on use. ua_class is the device class views.ts reads from the user
-- agent, never the user agent itself. Rows go 90 days after they end.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ua_class TEXT CHECK (ua_class IN ('desktop', 'mobile', 'tablet'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- A saved search: the same kinds, filter keys and server-built labels as the
-- alerts form (site/src/pages/interest.tsx, the interest table of the forms
-- database). At most 25 per user; the plan sets the cap at or below that.
CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('tenders', 'expiring', 'organization', 'buyer', 'segment')),
  params TEXT NOT NULL,                          -- the page's path and query as interestFilter rebuilds it
  label TEXT NOT NULL,                           -- written by the site, never typed by the user
  lang TEXT NOT NULL CHECK (lang IN ('en', 'fr')),
  created_at TEXT NOT NULL,
  last_delivered_at TEXT,
  deliver TEXT NOT NULL DEFAULT 'off' CHECK (deliver IN ('daily', 'weekly', 'off')),
  UNIQUE (user_id, kind, params)
);

-- An API key: "aw_<prefix>_<secret>". prefix is 8 hex characters, shown on
-- the keys page to tell keys apart; key_hash is SHA-256 of the whole key,
-- which is shown once and never stored.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,                            -- the user's own label, at most 60 characters
  key_hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

-- The keyed API's count (src/account/api_usage.ts, src/api_keyed.ts): one
-- row per API key per UTC day it was used, holding how many requests the
-- day's quota counted for it (a refused request is not counted). The keys
-- page shows today's count and the last 30 days'. Rows go after 60 days
-- (signin.ts, sweep) and with their key (the cascade, when deletion removes
-- the account's keys). A count alone: no path, parameter, address or time
-- of day. Until this table exists on the database every request is let
-- through uncounted and the keys page says the counts cannot be read.
CREATE TABLE IF NOT EXISTS api_usage (
  key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  day TEXT NOT NULL,                             -- the UTC date, YYYY-MM-DD
  n INTEGER NOT NULL,                            -- requests counted that day, at most the daily quota
  PRIMARY KEY (key_id, day)
);
-- The sweep's range (day < 60 days ago); a count reads and writes through the primary key.
CREATE INDEX IF NOT EXISTS idx_api_usage_day ON api_usage(day);

-- The record a plan is computed from: the latest row (by created_at) whose
-- window holds the moment wins, and none means free. The operator grants by
-- inserting a row with source 'manual' (docs/accounts.md); 'stripe' is kept
-- for the payments source of phase 3. Revoking sets revoked_at, which stops
-- the row at once. reference is the operator's note or the payment
-- reference, never an address.
CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL CHECK (plan IN ('free', 'pro')),
  source TEXT NOT NULL CHECK (source IN ('manual', 'stripe')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,                                  -- NULL for no end
  reference TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id);

-- One row per delivery run of a saved search (src/account/deliveries.ts):
-- sent (the message left), failed (the mail service refused it) or empty
-- (nothing new, no message). sent_at is the run's time; items is how many
-- records matched, past the 50 a message lists.
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY,
  saved_search_id TEXT NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  sent_at TEXT NOT NULL,
  items INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL                           -- sent | failed | empty
);

-- The secret behind a delivery's stop link (/account/stop?s=<search id>&t=
-- <secret>, and the List-Unsubscribe header), made from 16 random bytes the
-- first time the search is delivered. Kept in clear, unlike every other
-- secret here, because each message carries it; it can do one thing, turn
-- that search's delivery off. Goes with the search (the cascade, and the
-- delete paths in routes.tsx and searches.ts).
CREATE TABLE IF NOT EXISTS delivery_tokens (
  search_id TEXT PRIMARY KEY REFERENCES saved_searches(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Where the records counts of an organization, buyer or segment search stood
-- at its last delivery (src/account/records_deliveries.ts): the records
-- database names no day a record was first seen, so a delivery compares the
-- counts by source and fiscal year with these and reports the ones that
-- rose. as_of is the records database's data date when they were read;
-- counts is the JSON records_deliveries.ts writes (the counting rules'
-- version, the fiscal years read, and the count and counted cents of each
-- source and year): public figures, nothing about the reader. Written with
-- each delivery that is sent or finds nothing new; goes with the search
-- (the cascade, and the delete paths in routes.tsx and searches.ts).
CREATE TABLE IF NOT EXISTS delivery_marks (
  search_id TEXT PRIMARY KEY REFERENCES saved_searches(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,
  counts TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- What happened to an account, for the operator: an event name and a short
-- detail that never holds an address, a code, a token or a key. Rows go
-- after 90 days.
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  user_id TEXT,
  event TEXT NOT NULL,
  at TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);

-- Payments (src/account/billing.tsx, stripe.ts; docs/accounts.md, Payments):
-- the Stripe customer and subscription behind an account, one row per user,
-- written only by the webhook. status is Stripe's subscription status as
-- last reported (active, past_due, canceled and so on); current_period_end
-- is the end of the period paid for. The plan is still decided by the
-- entitlements rows; this row tells the billing page what to offer and the
-- webhook which user a notice is about. No card, no address, no amount.
CREATE TABLE IF NOT EXISTS payment_customers (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  customer_id TEXT NOT NULL,                     -- Stripe's cus_ id
  subscription_id TEXT,                          -- Stripe's sub_ id, the latest one bound
  status TEXT,
  current_period_end TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_customers_subscription ON payment_customers(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payment_customers_customer ON payment_customers(customer_id);

-- Every Stripe notice the webhook has taken, by Stripe's event id, so a
-- notice sent twice (Stripe retries until it gets a 2xx) changes nothing the
-- second time. Unknown types are recorded too. Rows go after 90 days.
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,                           -- Stripe's evt_ id
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_events_received ON payment_events(received_at);

-- A charge refunded in full or disputed (charge.refunded, charge.dispute.created;
-- billing.tsx): Stripe's charge id, its customer, why, and when the notice was
-- taken. A paid invoice for the same charge, or one paid before the reversal
-- was taken (a notice delayed past its refund), grants nothing; so does a
-- checkout made before it. Rows go after 90 days.
CREATE TABLE IF NOT EXISTS payment_reversals (
  charge_id TEXT PRIMARY KEY,                    -- Stripe's ch_ id
  customer_id TEXT NOT NULL,                     -- Stripe's cus_ id
  why TEXT NOT NULL CHECK (why IN ('refunded', 'disputed')),
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_reversals_customer ON payment_reversals(customer_id, at);

-- A bug report from a Pro account (src/account/bugs.tsx): the page it names,
-- a path on the site, or NULL when none was given; what happened; what was
-- expected, or NULL. Kept as typed (control characters dropped) and sent to
-- the operator's inbox with the plan and the user id, never the address. At
-- most five per user in any 24 hours, counted inside the insert. Rows go
-- after 180 days (signin.ts, sweep), and with the account.
CREATE TABLE IF NOT EXISTS bug_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  page TEXT,                                     -- at most 300 characters
  text TEXT NOT NULL,                            -- at most 2,000 characters
  expected TEXT,                                 -- at most 1,000 characters
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_user ON bug_reports(user_id, created_at);
-- The operator console (src/account/admin.tsx, admin_ops.ts; docs/accounts.md,
-- Operator console): an account the operator has blocked, one row while the
-- block stands, deleted when it is lifted or the account is deleted (from the
-- console, the only deletion a blocked account can reach). While it stands
-- the account's sessions are revoked, its codes and links answer as stale
-- ones do, its API keys answer 401, and the email delivery of its saved
-- searches is off.
-- paused lists the searches the block turned off ("<search id>:<daily|weekly>",
-- comma-separated), turned back on when the block is lifted. reason is the
-- operator's note, never an address; by_user_id is the operator's own user id.
CREATE TABLE IF NOT EXISTS account_blocks (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  reason TEXT,
  created_at TEXT NOT NULL,
  by_user_id TEXT NOT NULL REFERENCES users(id),
  paused TEXT
);
