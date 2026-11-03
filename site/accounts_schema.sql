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

-- A signed-in browser. The cookie aw_session holds "<id>.<secret>"; the row
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
