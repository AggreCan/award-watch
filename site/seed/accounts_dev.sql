-- DEVELOPMENT ONLY: the outbox of the log sender (src/account/sender.ts) in
-- the local accounts database. `npm run db:local` applies it after
-- ../accounts_schema.sql. It is never applied on the account, so the
-- deployed database has no table a code could be written to.
CREATE TABLE IF NOT EXISTS sent_mail (
  id INTEGER PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  html TEXT NOT NULL,
  lang TEXT NOT NULL,
  created_at TEXT NOT NULL
);
