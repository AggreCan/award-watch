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

-- The record tables, the earlier awards on a tender and the per-organization
-- feeds (site/src/records_tables.ts): one row per counted record (its row of
-- records with extra = 0) that has a date and names a buyer or an
-- organization, with what a table of records shows. A table of its own
-- rather than columns of records: the charts keep reading narrow rows, and a
-- new table reaches the live database through the nightly sync's ordinary
-- changes (its rows are all new to the ledger), with no full reload.
CREATE TABLE IF NOT EXISTS rec_details (
  k INTEGER PRIMARY KEY,                         -- the record's own key: records.k of its row with extra = 0
  src INTEGER NOT NULL,                          -- records.src
  day TEXT NOT NULL,                             -- YYYY-MM-DD: the date records.fy is read from
  bid INTEGER,                                   -- records.bid
  oid INTEGER,                                   -- records.oid
  cents INTEGER,                                 -- records.cents
  vnote INTEGER NOT NULL DEFAULT 0,              -- records.vnote
  comp INTEGER,                                  -- records.comp
  meth TEXT,                                     -- records.meth
  ref TEXT NOT NULL,                             -- an award or history reference in its URL form, ":<reference>" when it has no page; "<department>:<reference>" otherwise
  title_en TEXT,                                 -- the title: a published contract's description, a grant's title or program
  title_fr TEXT
);
-- Newest first through either index, so the first page of a table reads its
-- own rows and no more.
CREATE INDEX IF NOT EXISTS rec_details_org ON rec_details (oid, day) WHERE oid IS NOT NULL;
CREATE INDEX IF NOT EXISTS rec_details_buyer ON rec_details (bid, day) WHERE bid IS NOT NULL;

-- One row per UNSPSC class (a code's first six digits, within the 57
-- segments) of an award notice or a contract history record that names a
-- buyer and has a date: what a tender's earlier awards are found by.
CREATE TABLE IF NOT EXISTS rec_classes (
  k INTEGER PRIMARY KEY,
  rk INTEGER NOT NULL,                           -- rec_details.k
  cls INTEGER NOT NULL,                          -- 801016 for the codes 80101600 to 80101699
  bid INTEGER NOT NULL,
  day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rec_classes_class ON rec_classes (cls, bid, day);

-- The radar's 12-month window as the static export writes it
-- (expiring/12m/<n>.json), one row per contract, so its filters, sorts and
-- totals run over the whole window. The columns a statement filters or adds
-- by, then the row itself as JSON for the table and the CSV file. days_left
-- is left out of it (the site counts it from the data date), so a row is
-- sent again only when the contract changes.
CREATE TABLE IF NOT EXISTS rec_expiring (
  k INTEGER PRIMARY KEY,
  endd TEXT NOT NULL,                            -- the end date, YYYY-MM-DD
  oid INTEGER,                                   -- the organization's number; NULL when withheld
  buyer TEXT,                                    -- the row's buyer id
  client TEXT,                                   -- the client department's buyer id (client_buyer_id)
  segs TEXT NOT NULL DEFAULT '',                 -- its segments, each between spaces: ' 43 82 '
  kind INTEGER NOT NULL,                         -- 1 award notice, 2 contract history, 3 published contract (records.src)
  comp INTEGER,                                  -- 1 competitive, 0 non-competitive, NULL not stated
  cad INTEGER,                                   -- its value in cents when in Canadian dollars: the bands and the sort
  cents INTEGER,                                 -- the value the totals add: cad unless the value is flagged
  nv INTEGER NOT NULL DEFAULT 0,                 -- 1 when the source published no value
  so INTEGER NOT NULL DEFAULT 0,                 -- 1 for a standing offer or supply arrangement
  m31 INTEGER NOT NULL DEFAULT 0,                -- 1 when it ends on March 31, a fiscal year end
  j TEXT NOT NULL                                -- the row as the window file holds it, without days_left
);
CREATE INDEX IF NOT EXISTS rec_expiring_end ON rec_expiring (endd);
CREATE INDEX IF NOT EXISTS rec_expiring_buyer ON rec_expiring (buyer, endd) WHERE buyer IS NOT NULL;
CREATE INDEX IF NOT EXISTS rec_expiring_client ON rec_expiring (client, endd) WHERE client IS NOT NULL;

-- The provinces of each row of rec_expiring, one row per row and province or
-- territory: those its source states (derived 0) and those derived from its
-- other fields (derived 1, places.py), read from the row's own JSON, so the
-- radar's province filter seeks a province's rows (rec_expiring_prov_prov)
-- instead of reading every row. A table beside rec_expiring rather than a
-- column of it: rec_expiring keeps its form, and a new table reaches D1
-- through the nightly sync's ordinary changes, with no full reload.
CREATE TABLE IF NOT EXISTS rec_expiring_prov (
  pk INTEGER PRIMARY KEY,                        -- key_of('expiring-prov:<k>:<prov>'), the sync's key; never read by the site
  k INTEGER NOT NULL,                            -- rec_expiring.k of the row
  prov TEXT NOT NULL,                            -- the two-letter code: AB BC MB NB NL NS NT NU ON PE QC SK YT
  derived INTEGER NOT NULL DEFAULT 0             -- 1 when derived from another field, 0 when the source states it
);
CREATE INDEX IF NOT EXISTS rec_expiring_prov_prov ON rec_expiring_prov (prov, k);

-- The holder's record of each row of rec_expiring whose holder is named
-- (pipeline lines.py, records_db.lines_rows; docs/accounts.md "Holder's
-- record"): the holder's contracts of the same kind with the same buyer, each
-- source counted apart, as JSON. k is the row's rec_expiring.k; sk is
-- '<kind>:<reference in lower case>' ('award:cb-188-1434012',
-- 'contract:<department>:<reference>'), what a radar page and a record's page
-- ask by. Read only for a signed-in reader. A table beside rec_expiring rather
-- than a column of it: the nightly schema creates it, its rows are all new to
-- the ledger, and a page reading a database without it shows what it did
-- before.
CREATE TABLE IF NOT EXISTS rec_lines (
  k INTEGER PRIMARY KEY,
  sk TEXT NOT NULL,
  j TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS rec_lines_sk ON rec_lines (sk);

-- The page of each published contract (/contracts/<department>/<reference>,
-- site/src/pages/published.tsx): one row per row of the contracts table,
-- keyed as its row of records is, with every field the page shows. A
-- reference is unique within its department only, so the page finds a row
-- by both (rec_contracts_ref); the rows of one contract (its amendments)
-- share the department and procurement_id (rec_contracts_group). Values in
-- cents as published: the page reads the counted value from records by k.
CREATE TABLE IF NOT EXISTS rec_contracts (
  k INTEGER PRIMARY KEY,                         -- records.k of the same contract
  dept TEXT NOT NULL,                            -- owner_org, the department that published it (dnd-mdn)
  ref TEXT NOT NULL,                             -- reference_number as published
  pid TEXT,                                      -- procurement_id; NULL when blank
  bid INTEGER,                                   -- rec_buyers.bid of the department
  oid INTEGER,                                   -- the organization's number; NULL when withheld or not named
  wh INTEGER NOT NULL DEFAULT 0,                 -- 1 when the vendor reads as a person and is withheld
  cdate TEXT,                                    -- contract_date
  start TEXT,                                    -- contract_period_start
  endd TEXT,                                     -- delivery_date: the end the radar reads
  value INTEGER,                                 -- contract_value in cents: the total including this amendment
  orig INTEGER,                                  -- original_value in cents
  amend INTEGER,                                 -- amendment_value in cents
  proc TEXT,                                     -- solicitation_procedure: OB TC ST TN AC
  comp INTEGER,                                  -- 1 competitive, 0 non-competitive, NULL not stated
  ctype TEXT,                                    -- commodity_type: G goods, S services, C construction
  gsin TEXT,                                     -- commodity_code (rec_gsin.code)
  agr TEXT,                                      -- agreement_type_code as published
  trade TEXT,                                    -- trade_agreement codes, comma-separated
  ltr TEXT,                                      -- limited_tendering_reason codes, comma-separated
  inst TEXT,                                     -- instrument_type: C contract, A amendment, SO, SA
  period TEXT,                                   -- reporting_period (2025-2026-Q2)
  bids INTEGER,                                  -- number_of_bids
  so_no TEXT,                                    -- standing_offer_number
  desc_en TEXT,
  desc_fr TEXT,
  com_en TEXT,                                   -- comments
  com_fr TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS rec_contracts_ref ON rec_contracts (dept, ref);
CREATE INDEX IF NOT EXISTS rec_contracts_group ON rec_contracts (dept, pid, cdate) WHERE pid IS NOT NULL;

-- The names of the GSIN codes the published contracts carry.
CREATE TABLE IF NOT EXISTS rec_gsin (
  k INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  desc_en TEXT,
  desc_fr TEXT
);

-- The two Indigenous business fields of a published contract row
-- (records_db.published_indigenous_rows), keyed as its rec_contracts row, for
-- its page: a row only where indigenous_business names a set-aside under the
-- Procurement Strategy for Indigenous Business or
-- indigenous_business_excluding_psib says yes, and never for a vendor
-- withheld as a person. A table beside rec_contracts rather than columns of
-- it: rec_contracts keeps its form, and a new table reaches D1 through the
-- nightly sync's ordinary changes, with no full reload.
CREATE TABLE IF NOT EXISTS rec_contract_indigenous (
  k INTEGER PRIMARY KEY,                         -- rec_contracts.k of the row
  psib TEXT,                                     -- indigenous_business: MS mandatory or VS voluntary set-aside; NULL otherwise
  ib INTEGER NOT NULL DEFAULT 0                  -- 1 when indigenous_business_excluding_psib is Y
);

-- The events the watches follow (site/src/account/watch_events.ts; the rules
-- in docs/analytics.md, "Events"): one row per thing that happened on a data
-- date of the last 90 days to an organization, a buyer, a published contract
-- or a tender notice. Written by the nightly sync from the pipeline's
-- records_events (records_db.derive_events), through the ledger like every
-- table here; rows older than 90 days are deleted by the same sync. A new
-- table beside the others: the nightly schema creates it and its rows are
-- all new to the ledger, so no full reload is needed.
CREATE TABLE IF NOT EXISTS rec_events (
  k INTEGER PRIMARY KEY,                         -- a hash of what the event is about; never read by the site
  day TEXT NOT NULL,                             -- the data date the change was first seen
  kind TEXT NOT NULL,                            -- award, grant, amended, cancelled, ends_12m, ends_6m, ended, notice,
                                                 -- notice_amended, notice_closed, notice_cancelled, notice_awarded,
                                                 -- instrument_gained, instrument_lost, instrument_expires_6m
  src INTEGER,                                   -- 1 award notice, 2 history, 3 published contract, 4 grant, 5 tender
  oid INTEGER,                                   -- the organization named (records.oid); NULL when withheld or none
  buyer TEXT,                                    -- the buyer id (history: the client department)
  sid INTEGER,                                   -- the lowest UNSPSC segment; NULL for published contracts and grants
  ref TEXT NOT NULL,                             -- what a watch on one record follows: 'award:<reference in URL form>',
                                                 -- 'history:...', 'contract:<department>:<reference>', 'grant:...',
                                                 -- 'tender:<reference>'; 'sosa:<agreement number>' for a standing
                                                 -- offer or supply arrangement; 'count:<kind>:<subject>' for a count row
  cents INTEGER,                                 -- the value now (in cents)
  ocents INTEGER,                                -- the value before (amended, cancelled)
  endd TEXT,                                     -- the end date now
  oendd TEXT,                                    -- the end date before, when it moved
  closing TEXT,                                  -- a notice's closing now
  oclosing TEXT,                                 -- a notice's closing before, when it moved
  namd INTEGER,                                  -- the amendment number of the version that made the event
  title TEXT,                                    -- at most 120 characters, contacts scrubbed
  title_fr TEXT,
  other TEXT,                                    -- the other party (the holder, a notice's winner), or a notice's title before;
                                                 -- an instrument's type and regions ('Supply Arrangement · Alberta')
  other_fr TEXT,
  horizon INTEGER,                               -- ends_12m 365, ends_6m 182
  more INTEGER,                                  -- a count row: how many rows of its kind the subject had past 100 that day
  path TEXT NOT NULL                             -- the page on the site the line links
);
-- A watch reads one subject on named days: the subject first, so a statement
-- seeks each subject and day it names and reads nothing else. The day index
-- serves the console's counts by kind.
CREATE INDEX IF NOT EXISTS rec_events_org ON rec_events (oid, day) WHERE oid IS NOT NULL;
CREATE INDEX IF NOT EXISTS rec_events_buyer ON rec_events (buyer, day) WHERE buyer IS NOT NULL;
CREATE INDEX IF NOT EXISTS rec_events_segment ON rec_events (sid, day) WHERE sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS rec_events_ref ON rec_events (ref, day);
CREATE INDEX IF NOT EXISTS rec_events_day ON rec_events (day, kind);
-- The page of each standing offer or supply arrangement
-- (/instruments/<agreement>, site/src/pages/instruments.tsx), from the
-- pipeline's sosa tables (sosa_export.py): one row per instrument the
-- pipeline keeps (active, or lapsed within 90 days), found by its number
-- (rec_instruments_agr). calls holds the call-ups the published contracts
-- record against it over ten fiscal years, as JSON: [organization number or
-- null for any vendor that is no resolved holder, rows, cents or null, rows
-- with no value].
CREATE TABLE IF NOT EXISTS rec_instruments (
  k INTEGER PRIMARY KEY,                         -- key_of('sosa:<agreement>')
  agr TEXT NOT NULL,                             -- the agreement number as published
  type_en TEXT,
  type_fr TEXT,
  desc_en TEXT,                                  -- the description, one line, at most 120 characters
  desc_fr TEXT,
  gsin TEXT,                                     -- the commodity codes, "; " between them (UNSPSC in the current file, a GSIN before)
  gsin_en TEXT,                                  -- their names as "code - name" pieces, "; " between them
  gsin_fr TEXT,
  user_en TEXT,                                  -- the end user as published
  user_fr TEXT,
  buyer TEXT,                                    -- the end user's buyer id when a source names it so
  start TEXT,
  expiry TEXT,
  segs TEXT NOT NULL DEFAULT '',                 -- inherited UNSPSC segments, each between spaces: ' 43 81 '
  tref TEXT,                                     -- the RFSO or RFSA notice's reference in the site's URL form
  n INTEGER NOT NULL DEFAULT 0,                  -- active holders, persons withheld counted
  nw INTEGER NOT NULL DEFAULT 0,                 -- of them withheld as persons
  seen TEXT,                                     -- the publication date of the first file that held it
  last TEXT,                                     -- the publication date of the last file that held it
  calls TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS rec_instruments_agr ON rec_instruments (agr);
-- The statements that list instruments ending in a window (the briefings'
-- section, the watches' calendar and feed) read only the window's rows
-- through the first, rather than the whole table; a buyer's briefing reads
-- only that buyer's rows in the window through the second (partial: an
-- instrument whose end user names no buyer is never asked for by one).
-- Indexes only, so the nightly's IF NOT EXISTS adds them to a database that
-- has the table, with no reload.
CREATE INDEX IF NOT EXISTS rec_instruments_expiry ON rec_instruments (expiry);
CREATE INDEX IF NOT EXISTS rec_instruments_buyer ON rec_instruments (buyer, expiry) WHERE buyer IS NOT NULL;

-- Its active holders whose names are shown, one row per region; a holder
-- withheld as a person has no row (rec_instruments.nw counts it).
CREATE TABLE IF NOT EXISTS rec_holders (
  k INTEGER PRIMARY KEY,                         -- key_of('sosa:<agreement>:<normalized name>:<region>')
  ik INTEGER NOT NULL,                           -- rec_instruments.k
  oid INTEGER,                                   -- the organization's number; NULL when the name names no profile
  name TEXT NOT NULL,                            -- the legal name as published
  op TEXT,                                       -- the operating name
  region TEXT NOT NULL,                          -- the delivery point code
  region_en TEXT,
  region_fr TEXT,
  seen TEXT NOT NULL                             -- the publication date of the first file that held the row
);
CREATE INDEX IF NOT EXISTS rec_holders_instrument ON rec_holders (ik, name, region);
-- An organization's instruments: the claim page's block and the watches' calendar read holders by oid.
CREATE INDEX IF NOT EXISTS rec_holders_org ON rec_holders (oid) WHERE oid IS NOT NULL;
