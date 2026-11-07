-- The same-day tender notices (docs/intraday.md), in the hosted search
-- database: D1 `awardwatch-search`, binding SEARCH.
--
-- Written by the intraday workflow (.github/workflows/intraday.yml, through
-- pipeline/awardwatch_pipeline/intraday.py) after each cut of CanadaBuys' new
-- notices file, pruned by the nightly, read by the site's paid view
-- (site/src/intraday.ts) with one prepared statement. The search sync never
-- names these tables: its full reload drops its own two tables and their
-- indexes only (search_db.TABLES), so a reload leaves the day's notices.
--
-- Applied by the operator, once, before the first scheduled run (every
-- statement is IF NOT EXISTS, so applying it again changes nothing):
--   cd site && npx wrangler d1 execute awardwatch-search --remote --file ../pipeline/intraday_schema.sql
-- A change to a table here is applied the same way, by hand; the tables hold
-- two days of rows, so dropping and recreating them costs only those days.
--
-- provinces_derived came after the table: on a database made before it, add
-- it once (docs/intraday.md, "The tables, and applying the schema"; the
-- statement is not idempotent, and a second run only answers "duplicate
-- column name"):
--   cd site && npx wrangler d1 execute awardwatch-search --remote --command "ALTER TABLE intraday_tenders ADD COLUMN provinces_derived TEXT NOT NULL DEFAULT '[]'"
-- Until then the job reads the table's columns before each refresh
-- (intraday.COLUMNS_SQL) and leaves the column out of its upserts.

-- One row per version of a notice the new notices file listed, keyed by
-- reference and amendment like the nightly's tenders table. The fields are
-- the open list's (TenderRow in site/src/data.ts): reference is the URL form
-- of the published reference (export_static.url_reference) and
-- reference_published the reference as published when the two differ; the
-- titles and excerpts went through the export's contact scrub; the list
-- columns hold JSON text, "[]" when empty. buyer_id is a buyer the export
-- lists, or NULL when the spelling resolved to none (buyer_name and
-- buyer_name_fr then hold the spellings as published, or NULL for one that
-- names or locates a person); with a buyer_id they hold its names. seen_at
-- is when the intraday job first read the version (UTC, ISO 8601 with a Z)
-- and never changes after: the file is cumulative over the day, and each
-- later read refreshes every other field.
CREATE TABLE IF NOT EXISTS intraday_tenders (
  reference TEXT NOT NULL,
  reference_published TEXT,
  amendment INTEGER NOT NULL,
  seen_at TEXT NOT NULL,
  published TEXT,                                -- YYYY-MM-DD
  closing TEXT,                                  -- as published, local to the buyer, no zone
  title_en TEXT,
  title_fr TEXT,
  buyer_id TEXT,
  buyer_name TEXT,
  buyer_name_fr TEXT,
  category TEXT NOT NULL DEFAULT '[]',           -- ["SRV"], ["GD"], ["CNST"]
  notice_type_en TEXT,
  notice_type_fr TEXT,
  method_en TEXT,
  method_fr TEXT,
  segments TEXT NOT NULL DEFAULT '[]',           -- two-digit UNSPSC segments
  provinces TEXT NOT NULL DEFAULT '[]',          -- two-letter codes from the regions of delivery
  codes TEXT NOT NULL DEFAULT '[]',              -- the UNSPSC codes, trimmed to their significant digits
  excerpt_en TEXT,
  excerpt_fr TEXT,
  -- The provinces derived from the notice's other fields as the nightly
  -- derives them (places.py: a city of delivery, the regions of opportunity,
  -- a Defence Construction Canada regional office), never one of provinces.
  -- Last, where ALTER TABLE puts it on a table made before it.
  provinces_derived TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (reference, amendment)
);
-- The site reads the rows first read since the nightly's data date; the nightly prunes by the same column.
CREATE INDEX IF NOT EXISTS intraday_tenders_seen ON intraday_tenders (seen_at);

-- One row per run of the intraday workflow: id is the GitHub run id and
-- attempt, at when the run ended (UTC), the file's Last-Modified and ETag as
-- the host sent them (on a 304, the ones the request carried), the versions
-- read, written for the first time and read again, ok 1 when the run went
-- through (the file had not changed, or it was parsed and applied), and a
-- line saying what happened or which step failed. The next run sends the
-- validators of the newest ok row, so a failed run's file is fetched again.
CREATE TABLE IF NOT EXISTS intraday_runs (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  file_last_modified TEXT,
  file_etag TEXT,
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_new INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS intraday_runs_at ON intraday_runs (at);
