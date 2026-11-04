-- The records database: D1 `awardwatch-records`, binding RECORDS (docs/analytics.md).
--
-- A database of its own, so a full reload here can touch neither what readers
-- submitted, nor the search database, nor the accounts. Written only by the
-- nightly sync (pipeline/awardwatch_pipeline/records_db.py), which applies
-- this file before every sync: every statement is IF NOT EXISTS, so it
-- changes nothing on a database that has it. A change to a table here
-- reaches an existing database only through a full reload, whose first batch
-- drops the tables and runs this file again; records_db.LAYOUT names the
-- tables' current form, and a sync whose last full load wrote another one
-- reloads in full by itself. The site reads it with the prepared statements
-- of site/src/records_db.ts only.

-- One row per counted record of the four money sources (CLAUDE.md "Counting
-- money"): an award notice or a PSPC history contract by its reference, a
-- published contract row, a grant or contribution agreement by department and
-- reference; plus one row (extra = 1) for each further UNSPSC segment a
-- notice's codes reach, so a segment's figures count the notice in each of
-- its segments while every other figure reads extra = 0 and counts it once.
-- Integers throughout, so a row and its index entries stay near 100 bytes.
CREATE TABLE IF NOT EXISTS records (
  k INTEGER PRIMARY KEY,                         -- records_db.key_of(the record's key); never read by the site
  src INTEGER NOT NULL,                          -- 1 award notice, 2 PSPC contract history, 3 published contract, 4 grant
  fy INTEGER,                                    -- federal fiscal year by the calendar year it starts in (2025 = 2025-26)
  fq INTEGER,                                    -- its quarter: 1 April to June ... 4 January to March
  bid INTEGER,                                   -- rec_buyers.bid (history: the client department)
  oid INTEGER,                                   -- the organization id's ten hex digits as a number; NULL when withheld
  sid INTEGER,                                   -- UNSPSC segment as a number; award notices and history only
  extra INTEGER NOT NULL DEFAULT 0,              -- 1 on a notice's row for a further segment
  cents INTEGER,                                 -- the counted value in Canadian cents; NULL when not counted (vnote)
  vnote INTEGER NOT NULL DEFAULT 0,              -- 0 counted, 1 no value published, 2 another currency, 3 flagged
  comp INTEGER,                                  -- 1 competitive, 0 non-competitive, NULL not stated
  meth TEXT,                                     -- OB TC ST TN AC (the TBS codes); NULL not stated
  -- Award notices and history only: the first version's value by the same
  -- rule, in cents, beside cents for the amendment growth; NULL when cents is
  -- NULL or the contract is cancelled (its zero is a status, not an amount).
  ocents INTEGER,
  namd INTEGER,                                  -- versions after the first; NULL for published contracts and grants
  -- What the largest-records tables link and show. Award notices and history:
  -- the reference in the site's URL form; published contracts and grants:
  -- '<department>:<reference>'. title: the English title or description
  -- (French when there is none), contacts scrubbed, at most 120 characters.
  ref TEXT,
  title TEXT
);
-- Partial: published contracts and grants carry no segment, and a record
-- without a buyer or an organization cannot be asked for by either.
CREATE INDEX IF NOT EXISTS records_buyer ON records (bid, src, fy) WHERE bid IS NOT NULL;
CREATE INDEX IF NOT EXISTS records_org ON records (oid, src, fy) WHERE oid IS NOT NULL;
CREATE INDEX IF NOT EXISTS records_segment ON records (sid, src, fy) WHERE sid IS NOT NULL;

-- The organizations a record names, for the names in the top lists.
CREATE TABLE IF NOT EXISTS rec_orgs (
  oid INTEGER PRIMARY KEY,
  name TEXT NOT NULL                             -- organizations.display_name
);

-- The buyers a record names. bid is a 40-bit number from the id
-- (records_db.buyer_number), so it reads back exactly as a JavaScript number.
CREATE TABLE IF NOT EXISTS rec_buyers (
  bid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,                       -- buyers.id, the page's address
  name_en TEXT NOT NULL,
  name_fr TEXT
);

-- Each buyer's figures by source, fiscal year and quarter (records with
-- extra = 0): what the buyer view's first chart and its free view read.
CREATE TABLE IF NOT EXISTS rec_buyer_quarters (
  k INTEGER PRIMARY KEY,
  bid INTEGER NOT NULL,
  src INTEGER NOT NULL,
  fy INTEGER NOT NULL,
  fq INTEGER NOT NULL,
  n INTEGER NOT NULL,
  cents INTEGER,                                 -- NULL when no record in it was counted
  n_no_value INTEGER NOT NULL                    -- records whose source published no value
);
CREATE INDEX IF NOT EXISTS rec_buyer_quarters_buyer ON rec_buyer_quarters (bid, src, fy);

-- Each segment's figures by source and fiscal year (every row, extra or not):
-- what the segment view's first chart and its free view read. The distinct
-- counts cannot be added across years, so they are kept per year.
CREATE TABLE IF NOT EXISTS rec_segment_years (
  k INTEGER PRIMARY KEY,
  sid INTEGER NOT NULL,
  src INTEGER NOT NULL,
  fy INTEGER NOT NULL,
  n INTEGER NOT NULL,
  cents INTEGER,
  n_no_value INTEGER NOT NULL,
  n_buyers INTEGER NOT NULL,                     -- distinct buyers with a record
  n_orgs INTEGER NOT NULL,                       -- distinct organizations with a record
  n_pos INTEGER NOT NULL,                        -- records with a counted value above zero, which the next two read
  pos INTEGER,                                   -- their sum in cents (the average is pos / n_pos)
  med INTEGER                                    -- their median in cents (the lower cent of a half)
);
CREATE INDEX IF NOT EXISTS rec_segment_years_segment ON rec_segment_years (sid, src, fy);

-- Each buyer's average and median value by source and fiscal year (records
-- with extra = 0 and a counted value above zero), so the median is read, not
-- computed at request time. A row only where n_pos is above zero.
CREATE TABLE IF NOT EXISTS rec_buyer_years (
  k INTEGER PRIMARY KEY,
  bid INTEGER NOT NULL,
  src INTEGER NOT NULL,
  fy INTEGER NOT NULL,
  n_pos INTEGER NOT NULL,
  pos INTEGER NOT NULL,
  med INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rec_buyer_years_buyer ON rec_buyer_years (bid, src, fy);

-- The contracts ending in each of the eight fiscal quarters from the data
-- date's, by the radar's rules (expiring.py: the newest version's end date,
-- not cancelled, each contract once across the three contract sources),
-- per buyer (bid, the radar row's buyer) and per segment (sid, each of the
-- row's segments). A row is one or the other. Rebuilt every night from the
-- data date, so quarters behind it drop out.
CREATE TABLE IF NOT EXISTS rec_due (
  k INTEGER PRIMARY KEY,
  bid INTEGER,
  sid INTEGER,
  fy INTEGER NOT NULL,                           -- the fiscal year and quarter the end date falls in
  fq INTEGER NOT NULL,
  n INTEGER NOT NULL,
  cents INTEGER,                                 -- the counted values (Canadian dollars, not flagged); NULL for none
  n_no_value INTEGER NOT NULL                    -- contracts whose source published no value
);
CREATE INDEX IF NOT EXISTS rec_due_buyer ON rec_due (bid, fy, fq) WHERE bid IS NOT NULL;
CREATE INDEX IF NOT EXISTS rec_due_segment ON rec_due (sid, fy, fq) WHERE sid IS NOT NULL;

-- state: 'loading' from the first batch of a full reload until the night's
-- finish.sql, then 'ready'; as_of: the data date the rows describe; rules: the
-- counting rules' version (indicators.RULES_VERSION). The pages read all
-- three in the same batch as their charts.
CREATE TABLE IF NOT EXISTS rec_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
