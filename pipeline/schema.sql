-- Award Watch: the one schema both halves use.
-- The pipeline owns data/awardwatch.sqlite and applies this file on every connect
-- (db.apply_schema adds columns an older database lacks). The site's own D1
-- database holds only the tables under "Visitor submissions", applied there
-- by hand at setup. Change this file in the same commit as the code on both
-- sides.
--
-- Money is CAD unless a currency column says otherwise. Dates are ISO
-- (YYYY-MM-DD); datetimes are ISO in UTC with a trailing Z. Lists that a
-- source writes as "*a\n*b" are stored as JSON arrays of strings.

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Pipeline run log, one row per stage per run.
CREATE TABLE IF NOT EXISTS sources_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  source TEXT NOT NULL,                          -- tenders | awards | history | contracts | grants | lobbying | buyers |
                                                 -- registry | organizations | indicators | export
  detail TEXT,
  rows_in INTEGER,
  rows_new INTEGER,
  excluded INTEGER,                              -- rows naming a private individual, withheld or dropped (count only, never names)
  ok INTEGER NOT NULL,
  notice TEXT                                    -- an item needing attention that is not a failure
);

-- ---------------------------------------------------------------------------
-- Organizations: every supplier, recipient and lobbying client, merged on the
-- normalized legal name (normalize.norm_name; the id is normalize.org_id).
-- Province is not part of the identity: a national firm appears with many
-- addresses, and the places seen are kept beside it. Private individuals are
-- never stored (matching.is_person_name drops them at load).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,                    -- the spelling seen most often
  norm_name TEXT NOT NULL,
  country TEXT,                                  -- ISO 3166-1 alpha-2, the one seen most often
  province TEXT,                                 -- two-letter code, the one seen most often (Canadian addresses only)
  city TEXT,
  postal_code TEXT,
  business_number TEXT,                          -- nine digits, when every grant row that carries one agrees
  first_seen TEXT,                               -- earliest record date across sources
  last_seen TEXT,                                -- latest record date across sources
  n_awards INTEGER NOT NULL DEFAULT 0,
  n_history INTEGER NOT NULL DEFAULT 0,
  n_contracts INTEGER NOT NULL DEFAULT 0,
  n_grants INTEGER NOT NULL DEFAULT 0,
  n_lobbying INTEGER NOT NULL DEFAULT 0,
  total_awards REAL,                             -- sums by the rules in CLAUDE.md "Counting money"
  total_history REAL,
  total_contracts REAL,
  total_grants REAL,
  n_awards_no_value INTEGER NOT NULL DEFAULT 0,  -- contracts or agreements counted in n_* whose source published no
  n_history_no_value INTEGER NOT NULL DEFAULT 0, -- value (NULL, never 0): left out of the total beside it
  n_contracts_no_value INTEGER NOT NULL DEFAULT 0,
  n_grants_no_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_norm ON organizations(norm_name);
CREATE INDEX IF NOT EXISTS idx_org_prov ON organizations(province);
CREATE INDEX IF NOT EXISTS idx_org_last_seen ON organizations(last_seen);

-- Every raw spelling seen for an organization and where it came from, plus
-- the operating name split off a spelling ("X Ltd. o/a Y" adds "Y").
CREATE TABLE IF NOT EXISTS organization_names (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  raw_name TEXT NOT NULL,
  source TEXT NOT NULL,                          -- awards | history | contracts | grants | grants:operating (a grant's
                                                 -- operating name) | lobbying | registry
  n INTEGER NOT NULL DEFAULT 1,                  -- rows carrying this spelling
  PRIMARY KEY (organization_id, raw_name, source)
);

-- The addresses seen on the records of an organization.
CREATE TABLE IF NOT EXISTS organization_places (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  country TEXT NOT NULL DEFAULT '',
  province TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, country, province, city, postal_code)
);

-- Corporate registry lookups (sources/registry_federal.py; BC OrgBook and the
-- Quebec register may follow).
CREATE TABLE IF NOT EXISTS registry_matches (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  registry TEXT NOT NULL,                        -- corporations_canada | bc_orgbook | quebec_req
  registry_id TEXT NOT NULL,
  legal_name TEXT,
  entity_type TEXT,
  status TEXT,
  registered_on TEXT,
  grade TEXT NOT NULL,                           -- exact | probable | possible
  checked_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, registry, registry_id)
);

CREATE TABLE IF NOT EXISTS registry_checks (
  organization_id TEXT NOT NULL,
  registry TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, registry)
);

-- Corporations Canada open-data extract (business corporations under the
-- Canada Business Corporations Act), matched to organizations by normalized name.
CREATE TABLE IF NOT EXISTS federal_corporations (
  number TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  norm_name TEXT NOT NULL,
  status TEXT,                                   -- Active | Inactive | Dissolved
  registered_on TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  source_url TEXT NOT NULL,
  business_number TEXT
);
CREATE INDEX IF NOT EXISTS idx_federal_norm ON federal_corporations(norm_name);

-- ---------------------------------------------------------------------------
-- Buyers: federal departments, agencies and Crown corporations. One row per
-- institution; the id is the open.canada.ca organization name (dnd-mdn) when
-- the institution has one, else a slug of its English name. Every raw
-- spelling a source uses maps to one buyer through buyer_names
-- (sources/buyers.py; the curated seed is awardwatch_pipeline/data/buyers.csv).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buyers (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_fr TEXT,
  acronym_en TEXT,
  acronym_fr TEXT,
  ckan_org TEXT,                                 -- open.canada.ca organization name, when known
  department_number TEXT,
  kind TEXT,                                     -- institution: no CKAN organization, and only the lobbying registry
                                                 -- names it (sources/buyers.refresh_kinds); NULL otherwise
  n_tenders INTEGER NOT NULL DEFAULT 0,
  n_awards INTEGER NOT NULL DEFAULT 0,
  n_history INTEGER NOT NULL DEFAULT 0,
  n_contracts INTEGER NOT NULL DEFAULT 0,
  n_grants INTEGER NOT NULL DEFAULT 0,
  total_awards REAL,
  total_contracts REAL,
  total_grants REAL,
  n_awards_no_value INTEGER NOT NULL DEFAULT 0,  -- records counted in n_* whose source published no value
  n_contracts_no_value INTEGER NOT NULL DEFAULT 0,
  n_grants_no_value INTEGER NOT NULL DEFAULT 0,
  n_lobbying INTEGER NOT NULL DEFAULT 0,         -- lobbying communication reports naming it (indicators.py)
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS buyer_names (
  raw_name TEXT NOT NULL,
  source TEXT NOT NULL,                          -- canadabuys | lobbying (spellings records carry) | ckan | seed |
                                                 -- alias (titles: buyers.TITLE_SOURCES; alias is buyer_aliases.csv)
  buyer_id TEXT NOT NULL REFERENCES buyers(id),
  PRIMARY KEY (raw_name, source)
);

-- Buyer ids retired by the buyers stage, each with the live buyer that took
-- its records, so a link to an old buyer page can be sent on
-- (sources/buyers.merge and refresh_aliases). Kept from night to night: each
-- night adds its merges and the seed's re-pointed ids, follows chains to the
-- live id and drops an alias that leads nowhere or whose old id is a buyer
-- again. export_static writes it as buyers/aliases.json, and the names of the
-- retired buyer on the live buyer's page ("Also appears as").
CREATE TABLE IF NOT EXISTS buyer_aliases (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL,
  reason TEXT,                                   -- buyers.MERGE_REASONS: alias | ckan_twin | name | spellings |
                                                 -- seed (an id buyers.csv used to give); merged on databases from
                                                 -- before 2026-11-06 (its spellings resolved to new_id)
  updated_at TEXT,
  name_en TEXT,                                  -- the retired buyer's names when it was merged
  name_fr TEXT
);

-- ---------------------------------------------------------------------------
-- CanadaBuys tender notices (sources/canadabuys.py). One row per notice
-- version: the reference number and its amendment number. The newest
-- amendment is the notice as it stands; earlier ones are its history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenders (
  reference TEXT NOT NULL,                       -- cb-418-22395949, or a legacy PW- number
  amendment INTEGER NOT NULL,
  solicitation TEXT,
  title_en TEXT,
  title_fr TEXT,
  published TEXT,                                -- date
  closing TEXT,                                  -- datetime as published (local to the buyer; no zone given)
  amended TEXT,                                  -- date
  start_expected TEXT,
  end_expected TEXT,
  status TEXT,                                   -- open | expired | cancelled | awarded | unknown (normalize.tender_status)
  gsin TEXT,
  gsin_desc_en TEXT,
  gsin_desc_fr TEXT,
  category TEXT,                                 -- JSON list: SRV | GD | CNST ...
  notice_type_en TEXT,
  notice_type_fr TEXT,
  method_en TEXT,
  method_fr TEXT,
  selection_en TEXT,
  selection_fr TEXT,
  limited_reason_en TEXT,
  limited_reason_fr TEXT,
  trade_agreements_en TEXT,                      -- JSON list
  trade_agreements_fr TEXT,
  regions_opportunity_en TEXT,                   -- JSON list
  regions_opportunity_fr TEXT,
  regions_delivery_en TEXT,                      -- JSON list
  regions_delivery_fr TEXT,
  provinces TEXT,                                -- JSON list of two-letter codes the delivery regions name (stated)
  provinces_derived TEXT,                        -- JSON list of codes derived from another field, never a stated one
                                                 -- (places.py); NULL when none
  provinces_from TEXT,                           -- the field they come from: delivery (a city it names) | opportunity
                                                 -- | dcc_office (a Defence Construction Canada regional office)
  buyer_id TEXT REFERENCES buyers(id),
  buyer_raw_en TEXT,
  buyer_raw_fr TEXT,
  end_users_en TEXT,                             -- JSON list
  end_users_fr TEXT,
  contact_name TEXT,                             -- kept for the operator; never exported (the notice page carries it)
  contact_email TEXT,
  contact_phone TEXT,
  description_en TEXT,
  description_fr TEXT,
  attachments TEXT,                              -- JSON list of the notice's document URLs (attachment-piecesJointes,
                                                 -- the English column then the French, each URL once in file order,
                                                 -- 50 at most); only https links to canada.ca, *.canada.ca or *.gc.ca
                                                 -- are kept, the rest counted in the run log; NULL when none
  source_file TEXT NOT NULL,                     -- the file the row was last read from
  first_seen TEXT NOT NULL,                      -- run date the version first appeared
  last_seen TEXT NOT NULL,                       -- run date the version was last present in a file
  PRIMARY KEY (reference, amendment)
);
CREATE INDEX IF NOT EXISTS idx_tenders_published ON tenders(published);
CREATE INDEX IF NOT EXISTS idx_tenders_closing ON tenders(closing);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status, closing);
CREATE INDEX IF NOT EXISTS idx_tenders_buyer ON tenders(buyer_id, published);
CREATE INDEX IF NOT EXISTS idx_tenders_first_seen ON tenders(first_seen);

-- The UNSPSC codes on a notice version (a notice may carry several).
CREATE TABLE IF NOT EXISTS tender_codes (
  reference TEXT NOT NULL,
  amendment INTEGER NOT NULL,
  unspsc TEXT NOT NULL,                          -- up to eight digits; the segment is the first two
  PRIMARY KEY (reference, amendment, unspsc)
);
CREATE INDEX IF NOT EXISTS idx_tender_codes_code ON tender_codes(unspsc);

-- ---------------------------------------------------------------------------
-- CanadaBuys award notices: one row per notice version. The supplier is
-- joined to organizations at load (organization_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awards (
  reference TEXT NOT NULL,
  amendment INTEGER NOT NULL,
  solicitation TEXT,
  contract_number TEXT,
  title_en TEXT,
  title_fr TEXT,
  published TEXT,
  awarded TEXT,                                  -- contract award date
  amended TEXT,
  start TEXT,
  end TEXT,
  amount REAL,                                   -- contractAmount: the amount on this version
  total_value REAL,                              -- totalContractValue, when the source gives it
  currency TEXT,
  status TEXT,                                   -- active | expired | cancelled | unknown
  instrument_type_en TEXT,
  instrument_type_fr TEXT,
  amendment_type_en TEXT,
  amendment_type_fr TEXT,
  gsin TEXT,
  gsin_desc_en TEXT,
  gsin_desc_fr TEXT,
  category TEXT,                                 -- JSON list
  notice_type_en TEXT,
  notice_type_fr TEXT,
  method_en TEXT,
  method_fr TEXT,
  competitive INTEGER,                           -- 1 competitive, 0 non-competitive, NULL unstated (normalize.competitive)
  selection_en TEXT,
  selection_fr TEXT,
  limited_reason_en TEXT,
  limited_reason_fr TEXT,
  trade_agreements_en TEXT,
  trade_agreements_fr TEXT,
  regions_delivery_en TEXT,
  regions_delivery_fr TEXT,
  provinces TEXT,
  provinces_derived TEXT,                        -- as on tenders: the codes a city in the delivery regions gives
  provinces_from TEXT,                           -- delivery, or NULL
  supplier_raw TEXT,                             -- supplierLegalName as published
  supplier_street TEXT,
  supplier_city TEXT,
  supplier_province TEXT,                        -- two-letter code when Canadian
  supplier_postal TEXT,
  supplier_country TEXT,                         -- ISO alpha-2
  organization_id TEXT REFERENCES organizations(id),
  supplier_withheld INTEGER NOT NULL DEFAULT 0,  -- 1: the supplier reads as a private individual; its name, street,
                                                 -- city, postal code and organization are withheld (NULL) and only
                                                 -- the count is logged; the record itself is kept
  buyer_id TEXT REFERENCES buyers(id),
  buyer_raw_en TEXT,
  buyer_raw_fr TEXT,
  end_users_en TEXT,
  end_users_fr TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  description_en TEXT,
  description_fr TEXT,
  source_file TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (reference, amendment)
);
CREATE INDEX IF NOT EXISTS idx_awards_org ON awards(organization_id, awarded);
CREATE INDEX IF NOT EXISTS idx_awards_buyer ON awards(buyer_id, awarded);
CREATE INDEX IF NOT EXISTS idx_awards_awarded ON awards(awarded);
CREATE INDEX IF NOT EXISTS idx_awards_published ON awards(published);
CREATE INDEX IF NOT EXISTS idx_awards_solicitation ON awards(solicitation);
CREATE INDEX IF NOT EXISTS idx_awards_first_seen ON awards(first_seen);

CREATE TABLE IF NOT EXISTS award_codes (
  reference TEXT NOT NULL,
  amendment INTEGER NOT NULL,
  unspsc TEXT NOT NULL,
  PRIMARY KEY (reference, amendment, unspsc)
);
CREATE INDEX IF NOT EXISTS idx_award_codes_code ON award_codes(unspsc);

-- ---------------------------------------------------------------------------
-- CanadaBuys contract history: contracts awarded by Public Services and
-- Procurement Canada on behalf of client departments, 2009 onwards. One row
-- per contract version. The contracting entity is PSPC; the client is the
-- end-user department (client_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_history (
  reference TEXT NOT NULL,
  amendment INTEGER NOT NULL,
  procurement_number TEXT,
  solicitation TEXT,
  contract_number TEXT,
  title_en TEXT,
  title_fr TEXT,
  n_records INTEGER,
  published TEXT,
  awarded TEXT,
  amended TEXT,
  start TEXT,
  end TEXT,
  amount REAL,
  total_value REAL,
  currency TEXT,
  status TEXT,                                   -- active | expired | cancelled | unknown
  instrument_type_en TEXT,
  instrument_type_fr TEXT,
  amendment_type_en TEXT,                        -- Original | Amendment ...
  amendment_type_fr TEXT,
  gsin TEXT,
  gsin_desc_en TEXT,
  gsin_desc_fr TEXT,
  category TEXT,
  notice_type_en TEXT,
  notice_type_fr TEXT,
  method_en TEXT,
  method_fr TEXT,
  competitive INTEGER,
  selection_en TEXT,
  selection_fr TEXT,
  limited_reason_en TEXT,
  limited_reason_fr TEXT,
  trade_agreements_en TEXT,
  trade_agreements_fr TEXT,
  regions_delivery_en TEXT,
  regions_delivery_fr TEXT,
  provinces TEXT,
  provinces_derived TEXT,                        -- as on tenders: the codes a city in the delivery regions gives
  provinces_from TEXT,                           -- delivery, or NULL
  supplier_raw TEXT,                             -- supplierLegalName
  supplier_standardized TEXT,                    -- supplierStandardizedName, blank on most rows
  supplier_operating TEXT,
  supplier_employee_count TEXT,
  supplier_street TEXT,
  supplier_city TEXT,
  supplier_province TEXT,
  supplier_postal TEXT,
  supplier_country TEXT,
  organization_id TEXT REFERENCES organizations(id),
  supplier_withheld INTEGER NOT NULL DEFAULT 0,  -- 1: the supplier reads as a private individual; its name, street,
                                                 -- city, postal code and organization are withheld (NULL) and only
                                                 -- the count is logged; the record itself is kept
  buyer_id TEXT REFERENCES buyers(id),           -- the contracting entity (PSPC)
  buyer_raw_en TEXT,                             -- its spelling as published
  buyer_raw_fr TEXT,
  client_id TEXT REFERENCES buyers(id),          -- the end-user department
  client_raw_en TEXT,
  client_raw_fr TEXT,
  description_en TEXT,
  description_fr TEXT,
  source_file TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (reference, amendment)
);
CREATE INDEX IF NOT EXISTS idx_history_org ON contract_history(organization_id, awarded);
CREATE INDEX IF NOT EXISTS idx_history_client ON contract_history(client_id, awarded);
CREATE INDEX IF NOT EXISTS idx_history_awarded ON contract_history(awarded);
CREATE INDEX IF NOT EXISTS idx_history_contract ON contract_history(contract_number);

CREATE TABLE IF NOT EXISTS history_codes (
  reference TEXT NOT NULL,
  amendment INTEGER NOT NULL,
  unspsc TEXT NOT NULL,
  PRIMARY KEY (reference, amendment, unspsc)
);
CREATE INDEX IF NOT EXISTS idx_history_codes_code ON history_codes(unspsc);

-- ---------------------------------------------------------------------------
-- Proactive publication of contracts over $10,000 (every federal reporting
-- entity, consolidated by TBS). A reference number is unique within one
-- department only; the key is the department and the number. A row is an
-- original contract or an amendment (amendment_value set); procurement_id
-- groups the rows of one contract when the department fills it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contracts (
  owner_org TEXT NOT NULL,                       -- open.canada.ca organization name (dnd-mdn)
  reference TEXT NOT NULL,
  procurement_id TEXT,
  vendor_raw TEXT,
  vendor_postal TEXT,
  vendor_country TEXT,
  vendor_withheld INTEGER NOT NULL DEFAULT 0,    -- 1: the vendor reads as a private individual; its name, postal
                                                 -- code and organization are withheld (NULL) and only the count
                                                 -- is logged; the record itself is kept
  buyer_id TEXT REFERENCES buyers(id),           -- the reporting department (owner_org)
  buyer_name_raw TEXT,                           -- always NULL: the buyer_name column names a public servant (a contact)
  contracting_entity TEXT,                       -- code: PSPC when contracted on the department's behalf
  contract_date TEXT,
  period_start TEXT,
  delivery_date TEXT,
  value REAL,                                    -- contract_value: the total value including this amendment
  original_value REAL,
  amendment_value REAL,
  economic_object TEXT,
  description_en TEXT,
  description_fr TEXT,
  comments_en TEXT,
  comments_fr TEXT,
  commodity_type TEXT,                           -- G | S | C
  commodity_code TEXT,                           -- GSIN
  agreement_type TEXT,
  trade_agreement TEXT,                          -- JSON list of codes
  land_claims TEXT,
  solicitation_procedure TEXT,                   -- AC | OB | TC | TN | ST (TBS guide)
  competitive INTEGER,                           -- from solicitation_procedure (normalize.competitive_code)
  limited_tendering_reason TEXT,                 -- JSON list of codes
  trade_agreement_exceptions TEXT,
  indigenous_business TEXT,
  indigenous_business_excluding_psib TEXT,
  intellectual_property TEXT,
  potential_commercial_exploitation TEXT,
  former_public_servant TEXT,
  standing_offer_number TEXT,
  instrument_type TEXT,                          -- C contract | A amendment | SO | SA (TBS guide)
  ministers_office TEXT,
  number_of_bids INTEGER,
  article_6_exceptions TEXT,
  award_criteria TEXT,
  socioeconomic_indicator TEXT,
  reporting_period TEXT,                         -- 2025-2026-Q2
  organization_id TEXT REFERENCES organizations(id),
  loaded_at TEXT NOT NULL,
  PRIMARY KEY (owner_org, reference)
);
CREATE INDEX IF NOT EXISTS idx_contracts_org ON contracts(organization_id, contract_date);
CREATE INDEX IF NOT EXISTS idx_contracts_buyer ON contracts(buyer_id, contract_date);
CREATE INDEX IF NOT EXISTS idx_contracts_date ON contracts(contract_date);
CREATE INDEX IF NOT EXISTS idx_contracts_period ON contracts(reporting_period);

-- ---------------------------------------------------------------------------
-- Proactive publication of grants and contributions. One row per agreement
-- version (department, reference number, amendment number); the highest
-- amendment carries the amended value. Recipient type P (individuals) is
-- dropped at load; any other recipient that reads as a person keeps the
-- row with the recipient withheld (recipient_withheld).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grants (
  owner_org TEXT NOT NULL,
  reference TEXT NOT NULL,
  amendment INTEGER NOT NULL,
  amendment_date TEXT,
  agreement_type TEXT,                           -- G grant | C contribution | O other
  recipient_type TEXT,                           -- A aboriginal recipients | F for-profit | G government | I international |
                                                 -- N not-for-profit | O other | S academia (TBS guide)
  business_number TEXT,
  legal_name TEXT,
  operating_name TEXT,
  research_organization TEXT,
  country TEXT,
  province TEXT,
  city TEXT,
  postal_code TEXT,
  recipient_withheld INTEGER NOT NULL DEFAULT 0, -- 1: the recipient reads as a private individual; its legal and
                                                 -- operating names, business number, city, postal code and
                                                 -- organization are withheld (NULL) and only the count is logged;
                                                 -- the record itself is kept
  riding_en TEXT,
  riding_fr TEXT,
  riding_number TEXT,
  program_en TEXT,
  program_fr TEXT,
  title_en TEXT,
  title_fr TEXT,
  agreement_number TEXT,
  value REAL,                                    -- agreement_value in CAD
  fx_type TEXT,
  fx_value REAL,
  start TEXT,
  end TEXT,
  naics TEXT,
  description_en TEXT,
  description_fr TEXT,
  buyer_id TEXT REFERENCES buyers(id),
  organization_id TEXT REFERENCES organizations(id),
  loaded_at TEXT NOT NULL,
  PRIMARY KEY (owner_org, reference, amendment)
);
CREATE INDEX IF NOT EXISTS idx_grants_org ON grants(organization_id, start);
CREATE INDEX IF NOT EXISTS idx_grants_buyer ON grants(buyer_id, start);
CREATE INDEX IF NOT EXISTS idx_grants_start ON grants(start);
CREATE INDEX IF NOT EXISTS idx_grants_bn ON grants(business_number);

-- ---------------------------------------------------------------------------
-- Registry of Lobbyists, monthly communication reports. One row per
-- communication; the client (the organization on whose behalf the lobbying
-- was done) is joined to organizations. Designated public office holders are
-- named in their public role and kept as the registry publishes them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lobbying_communications (
  comm_number TEXT PRIMARY KEY,
  registration_number TEXT,
  registrant_number TEXT,                        -- the registry's number for the registrant, when the export gives it
  comm_date TEXT,
  registrant_raw TEXT,                           -- the registrant (a consultant lobbyist or the in-house officer)
  client_raw TEXT,                               -- the client organization as filed
  client_withheld INTEGER NOT NULL DEFAULT 0,    -- 1: the client reads as a private individual; its name and
                                                 -- organization are withheld (NULL) and only the count is logged;
                                                 -- the record itself is kept
  organization_id TEXT REFERENCES organizations(id),
  subject_matters TEXT,                          -- JSON list
  institutions TEXT,                             -- JSON list of institution names as filed
  buyer_ids TEXT,                                -- JSON list of matched buyer ids
  dpoh TEXT,                                     -- JSON list of {name, title, institution}
  loaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lobbying_org ON lobbying_communications(organization_id, comm_date);
CREATE INDEX IF NOT EXISTS idx_lobbying_date ON lobbying_communications(comm_date);

-- ---------------------------------------------------------------------------
-- Code lists, built from the files themselves (every description the source
-- gives for a code) with a committed seed for the UNSPSC segment titles.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unspsc_codes (
  code TEXT PRIMARY KEY,                         -- 2, 4, 6 or 8 digits
  level INTEGER NOT NULL,                        -- 1 segment | 2 family | 3 class | 4 commodity
  desc_en TEXT,
  desc_fr TEXT,
  n INTEGER NOT NULL DEFAULT 0                   -- notice versions carrying it or a code under it
);

CREATE TABLE IF NOT EXISTS gsin_codes (
  code TEXT PRIMARY KEY,
  desc_en TEXT,
  desc_fr TEXT,
  n INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Derived figures the site shows (indicators.py). Rebuilt whole each run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_years (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  year INTEGER NOT NULL,                         -- calendar year of the award, contract or agreement start
  source TEXT NOT NULL,                          -- awards | history | contracts | grants
  n INTEGER NOT NULL,
  total REAL,
  n_non_competitive INTEGER,
  total_non_competitive REAL,
  n_no_value INTEGER,                            -- records counted in n whose source published no value
  -- The non-competitive share by value is taken over positive values only: a
  -- published contract's amendment can lower a value (a negative row), and a
  -- share of a net total can run below zero or past 100 percent.
  total_positive REAL,                           -- the records' positive values, added
  total_non_competitive_positive REAL,           -- the same, over the non-competitive records
  n_negative INTEGER,                            -- records whose value is below zero
  PRIMARY KEY (organization_id, year, source)
);

CREATE TABLE IF NOT EXISTS buyer_years (
  buyer_id TEXT NOT NULL REFERENCES buyers(id),
  year INTEGER NOT NULL,
  source TEXT NOT NULL,
  n INTEGER NOT NULL,
  total REAL,
  n_non_competitive INTEGER,
  total_non_competitive REAL,
  n_organizations INTEGER,
  n_no_value INTEGER,                            -- records counted in n whose source published no value
  PRIMARY KEY (buyer_id, year, source)
);

-- The hosted search database (D1 awardwatch-search, pipeline/search_schema.sql,
-- search_db.py, docs/hosted-search.md). search_sync logs each sync recorded
-- after D1 confirmed it: the manifest's summary (JSON, without its ledger
-- entries), the rows the ledger then holds, and whether it was a full reload.
CREATE TABLE IF NOT EXISTS search_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  manifest TEXT NOT NULL,
  rows INTEGER NOT NULL,
  full INTEGER NOT NULL
);

-- The ledger: the key and content hash of every row as last confirmed in
-- D1. The nightly sync compares tonight's rows with it and sends only what
-- changed; nothing but search-synced writes it.
CREATE TABLE IF NOT EXISTS search_ledger (
  key TEXT PRIMARY KEY,                          -- 'o:<organization id>' or 'b:<buyer id>'
  hash TEXT NOT NULL                             -- search_db.row_hash
);

-- The records database (D1 awardwatch-records, pipeline/records_schema.sql,
-- records_db.py, docs/analytics.md). The ledger holds the table, key and
-- hash of every row as last confirmed in D1, integers only, since it holds
-- about three million rows; nothing but records-synced writes it.
-- records_staged holds tonight's differences between records-sync and
-- records-synced (h NULL: a delete), which would make the manifest a hundred
-- megabytes on a first load; records-synced empties it. records_sync logs
-- each sync recorded, as search_sync does.
CREATE TABLE IF NOT EXISTS records_ledger (
  t INTEGER NOT NULL,                            -- records_db.Table.code
  k INTEGER NOT NULL,                            -- the row's key in that table
  h INTEGER NOT NULL,                            -- records_db.row_hash
  PRIMARY KEY (t, k)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS records_staged (
  t INTEGER NOT NULL,
  k INTEGER NOT NULL,
  h INTEGER,
  PRIMARY KEY (t, k)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS records_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  manifest TEXT NOT NULL,
  rows INTEGER NOT NULL,
  full INTEGER NOT NULL
);

-- The events the watch mail reads (records_db.derive_events, docs/analytics.md
-- "Events"): what happened to an organization, a buyer, a published contract
-- or a tender notice on each data date of the last 90 days. The sync sends
-- these rows to D1's rec_events as it sends every records table (through the
-- ledger), and drops the rows older than 90 days here, so D1 loses them on
-- the same night. k is a hash of what the event is about, so finding it again
-- (a night run twice, a night whose apply failed) writes nothing new.
CREATE TABLE IF NOT EXISTS records_events (
  k INTEGER PRIMARY KEY,
  day TEXT NOT NULL,                             -- the data date it was first seen on
  kind TEXT NOT NULL,                            -- records_db.EVENT_KINDS
  src INTEGER,                                   -- 1 award notice, 2 history, 3 published contract, 4 grant, 5 tender
  oid INTEGER,                                   -- the organization's number
  buyer TEXT,                                    -- the buyer id
  sid INTEGER,                                   -- the lowest UNSPSC segment
  ref TEXT NOT NULL,                             -- what a watch on one record follows: award:, history:, contract:, grant:, tender:;
                                                 -- sosa:<agreement number> for an instrument's events
  cents INTEGER,
  ocents INTEGER,                                -- the value before (amended, cancelled)
  endd TEXT,
  oendd TEXT,                                    -- the end date before, when it moved
  closing TEXT,
  oclosing TEXT,                                 -- a notice's closing before, when it moved
  namd INTEGER,                                  -- the amendment number of the version that made the event
  title TEXT,
  title_fr TEXT,
  other TEXT,                                    -- the other party (the holder, the winner), or a notice's title before
  other_fr TEXT,
  horizon INTEGER,                               -- ends_12m 365, ends_6m 182
  more INTEGER,                                  -- a count row: the rows past the per-day cap
  path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_events_day ON records_events(day);

-- What the events step compares tonight with (the previous night's state, no
-- more): each award notice and PSPC history record (src 1, 2) with its
-- versions after the first, its counted value and its end date, each
-- published contract row (src 3) with its value and end date
-- as published, and each tender notice open on the data date (src 0, n 1).
-- Replaced whole by each night's events step.
CREATE TABLE IF NOT EXISTS records_event_state (
  k INTEGER PRIMARY KEY,
  src INTEGER NOT NULL,
  n INTEGER,
  cents INTEGER,
  endd TEXT                                      -- the end date, to see it move
);

-- The organization directory's pages (directory.py) as last exported, by
-- path, each with a hash of its rows and the data date on which that hash last
-- changed. The sitemap gives that date as the page's lastmod, so a page whose
-- rows stayed the same keeps its date; a page no longer written is deleted.
CREATE TABLE IF NOT EXISTS directory_pages (
  path TEXT PRIMARY KEY,                         -- '/organizations/directory/bc' (page 1), '/organizations/directory/bc/2'
  code TEXT NOT NULL,                            -- the directory: 'ab', ..., 'yt', 'xx' (outside Canada) or 'un' (unknown)
  page INTEGER NOT NULL,                         -- from 1
  hash TEXT NOT NULL,                            -- directory.page_hash of the page's rows
  changed_on TEXT NOT NULL                       -- ISO date: the data date of the export that first wrote this hash
);

-- Organization ids retired by a normalization change (migrate.py) or merged
-- into another organization (merges.py), each with the id that took over its
-- records, so a link to an old profile can be sent on. export_static writes
-- it, chains followed to the live id, as aliases/<abc>.json.
CREATE TABLE IF NOT EXISTS organization_aliases (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL,
  normalize_version INTEGER NOT NULL,            -- the normalization in force when old_id was retired
  created_at TEXT NOT NULL,
  reason TEXT                                    -- NULL: a normalization change; business_number | truncation | seed:
                                                 -- a merge, rebuilt every night by merges.py
);

-- Values to check (value_checks.py), rebuilt whole every night: a record
-- whose value another record contradicts. The value stays on the record and
-- is exported with value_flag "check"; no total adds it.
CREATE TABLE IF NOT EXISTS value_flags (
  kind TEXT NOT NULL,                            -- award | history | contract
  key TEXT NOT NULL,                             -- the reference; '<owner_org>:<procurement_id>' for a published contract
  rule TEXT NOT NULL,                            -- other_source | total_vs_amount | currency_abroad (comma-joined)
  detail TEXT,                                   -- what the rule compared, for the review list
  computed_at TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);

-- The expiring-contracts radar (expiring.py, CLAUDE.md "Expiring-contracts
-- radar"): every award notice, PSPC history contract and published contract
-- whose newest version ends within 365 days of the data date and is not
-- cancelled, listed once across the three sources (the duplicate rule keeps
-- the award notice, then the history record, then the published contract).
-- Rebuilt whole after the indicators stage; the export reads it.
CREATE TABLE IF NOT EXISTS expiring_contracts (
  source_key TEXT PRIMARY KEY,                   -- 'award:<reference>', 'history:<reference>', 'contract:<owner_org>:<reference>'
  kind TEXT NOT NULL,                            -- award | history | contract
  reference TEXT NOT NULL,                       -- as published; '<owner_org>:<reference>' for a published contract
  title_en TEXT,
  title_fr TEXT,
  organization_id TEXT,                          -- NULL when withheld (supplier_withheld = 1) or not named
  organization TEXT,                             -- its display name when the radar was built
  supplier_withheld INTEGER NOT NULL DEFAULT 0,
  buyer_id TEXT,                                 -- history: the client department, else PSPC
  buyer_en TEXT,
  buyer_fr TEXT,
  start TEXT,
  end TEXT NOT NULL,                             -- the newest version's end date
  days_left INTEGER NOT NULL,                    -- end minus the data date
  value REAL,                                    -- the counted value by the row's own source's rules, in its currency
  currency TEXT,
  competitive INTEGER,
  method_en TEXT,
  method_fr TEXT,
  instrument_en TEXT,
  instrument_fr TEXT,
  n_amendments INTEGER NOT NULL DEFAULT 0,       -- versions beyond the original
  value_growth REAL,                             -- the counted value over the original amount, minus 1; NULL when either is unknown
  contract_number TEXT,                          -- what the duplicate rule compares (normalized), when the source gives one
  tender_reference TEXT,                         -- the matched tender notice's reference (through tenders.solicitation), as published
  segments TEXT,                                 -- JSON list of two-digit UNSPSC segments
  provinces TEXT,                                -- JSON list of delivery provinces (stated)
  provinces_derived TEXT,                        -- JSON list of derived codes (places.py), NULL when none
  provinces_from TEXT,                           -- delivery | opportunity | land_claims (a published contract's), or NULL
  entered_3m TEXT,                               -- the data date on which the row entered the 3-month window (the feed's
                                                 -- entry date, carried over between rebuilds); NULL outside the window
  client_buyer_id TEXT,                          -- the client department: from a published contract or history record
                                                 -- the duplicate rule dropped against this row, else the row's own
                                                 -- (history: its client; contract: its department; award: its end user)
  client_buyer_name TEXT,                        -- the client's English name (the end user as published when unmatched)
  client_buyer_name_fr TEXT,
  value_flag TEXT,                               -- 'check' when value_flags lists the contract (value_checks.py)
  computed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expiring_end ON expiring_contracts(end);

-- Nightly link sampling (link_sample.py, docs/link-sampling.md): one row per
-- government link checked, from the sample drawn each night. Rows older than
-- link_sample.RETENTION_DAYS (60) are deleted by the night that writes the
-- next ones. Never exported.
CREATE TABLE IF NOT EXISTS link_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at TEXT NOT NULL,                      -- ISO datetime UTC, one value for a night's rows
  data_date TEXT NOT NULL,                       -- the data date that seeded the draw
  kind TEXT NOT NULL,                            -- tender | award | contract | grant | lobbying | portal
  record_ref TEXT NOT NULL,                      -- the record the link belongs to: a notice's reference,
                                                 -- '<owner_org>:<reference>', a communication number,
                                                 -- 'dataset:<source>' or 'buyer:<buyer id>'
  url TEXT NOT NULL,
  method TEXT NOT NULL,                          -- HEAD, or GET when HEAD answered 405 or 501
  status INTEGER,                                -- the final answer after redirects; NULL when none came
  error TEXT,                                    -- why no answer came (the exception's name)
  elapsed_ms INTEGER NOT NULL,                   -- the last attempt's time on the wire
  attempts INTEGER NOT NULL                      -- 1, or 2 after a retry
);

-- ---------------------------------------------------------------------------
-- Visitor submissions: the only tables the D1 database of the site holds.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL,
  text TEXT NOT NULL,
  contact TEXT,                                  -- optional, never shown
  submitted_at TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_responses_org ON organization_responses(organization_id, published);

CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT,
  page TEXT,
  text TEXT NOT NULL,
  contact TEXT,
  submitted_at TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_corrections_org ON corrections(organization_id, published);

-- Interest in email alerts, from the "Get alerts by email" form
-- (site/src/pages/interest.tsx) and the Email lists page, which saves one row
-- per list ticked (site/src/pages/alerts.tsx): one row per address and saved
-- filter. No
-- alert is sent from here. One message says accounts are open (the
-- operator's job in site/src/account/announce.tsx), with an unsubscribe link
-- built from the token of the address's first row; notice_at marks the
-- address's rows when it went, so the job sends it once. The link takes the
-- address off: every row of it is marked unsubscribed and its email replaced
-- by "removed:" and a hash under a random salt that is thrown away. No IP
-- address, user agent or visitor code is kept, and the address is never
-- shown. The nightly run reads the two counts only (rows, and rows not
-- unsubscribed).
--
-- notice_at came after the table: on a database made before it, add it once
-- (docs/accounts.md, The accounts-open message):
--   ALTER TABLE interest ADD COLUMN notice_at TEXT
CREATE TABLE IF NOT EXISTS interest (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,                           -- trimmed and lower-cased, at most 254 characters
  kind TEXT NOT NULL,                            -- tenders | expiring | organization | buyer | segment
  params TEXT NOT NULL,                          -- the saved filter: the page's path and query, rebuilt by the site from
                                                 -- the filter keys it allows for the kind, keys sorted, no lang; on
                                                 -- /tenders category, segment and province may repeat (any one of
                                                 -- the values matches), each key's values in a fixed order
  label TEXT NOT NULL,                           -- what the filter means, in the visitor's language, written by the site
                                                 -- from the filter's codes and the names the data holds; words typed
                                                 -- into a title search stay in params and are never in the label
  lang TEXT NOT NULL,                            -- en | fr: the language of the form, and of the messages
  created_at TEXT NOT NULL,
  token TEXT NOT NULL,                           -- 32 random hex characters, for the confirmation and unsubscribe links
  confirmed_at TEXT,                             -- when the address confirmed (the confirmation ships with the alerts)
  unsubscribed_at TEXT,
  notice_at TEXT,                                -- when the accounts-open message went to the address, on the rows it had then
  UNIQUE (email, kind, params)
);

-- ---------------------------------------------------------------------------
-- Standing offers and supply arrangements (sources/sosa.py, docs/sosa.md).
-- PSPC's weekly file lists the instruments active on its publication date,
-- one row per supplier, instrument and delivery point; the history is what
-- these tables keep of each week's file.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sosa_instruments (
  agreement_number TEXT PRIMARY KEY,             -- as published
  type_en TEXT,
  type_fr TEXT,
  description_en TEXT,
  description_fr TEXT,
  commodity TEXT,                                -- the GSIN
  commodity_en TEXT,
  commodity_fr TEXT,
  end_user_en TEXT,
  end_user_fr TEXT,
  end_user_buyer_id TEXT,                        -- the buyer a source has named with the end user's spelling, else NULL
  start TEXT,                                    -- award-date
  expiry TEXT,                                   -- expiry-date
  solicitation TEXT,                             -- the agreement number's stem (sosa.stem), for the join to the notices
  segments TEXT,                                 -- JSON list of two-digit UNSPSC segments, from the notices the stem matches
  tender_reference TEXT,                         -- the newest tender notice the stem matches, its reference as published
  n_holders INTEGER NOT NULL DEFAULT 0,          -- active holders (suppliers), persons withheld counted
  n_holders_withheld INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL,                      -- the publication date of the first file that held it
  last_seen TEXT NOT NULL,                       -- the publication date of the last file that held it
  expiry_changes INTEGER NOT NULL DEFAULT 0      -- how many file publications moved the expiry (the calendar SEQUENCE)
);
CREATE INDEX IF NOT EXISTS idx_sosa_instruments_expiry ON sosa_instruments(expiry);

-- One supplier on one instrument in one delivery region. A name that reads as
-- a person is never stored: supplier_raw, the operating and standardized
-- names are NULL and supplier_norm is a hash of the normalized name, which
-- keeps the row's key from week to week without keeping the name. The
-- organization is resolved, never created: a holder links to a profile only
-- when its name already names one (sosa.resolve), and loses the link when the
-- organizations stage removes that profile (ON DELETE SET NULL); the sosa
-- stage, which runs after it, links it again the same night after a merge.
CREATE TABLE IF NOT EXISTS sosa_holders (
  agreement_number TEXT NOT NULL,
  supplier_norm TEXT NOT NULL,                   -- normalize.norm_name of the legal name; 'person:<hash>' when withheld
  delivery_point_code TEXT NOT NULL,             -- BC, ON ... (ISO 3166-2 without the CA- prefix), FD, NA, NC
  supplier_raw TEXT,                             -- the legal name as published; NULL when withheld
  operating_name TEXT,                           -- only beside a legal name that is shown
  standardized_name TEXT,
  delivery_point_en TEXT,
  delivery_point_fr TEXT,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  supplier_withheld INTEGER NOT NULL DEFAULT 0,  -- 1: the name reads as a person (matching.is_person_name)
  first_seen TEXT NOT NULL,                      -- the publication date of the file the row first appeared in
  last_seen TEXT NOT NULL,                       -- the publication date of the last file that held it
  missing_files INTEGER NOT NULL DEFAULT 0,      -- files in a row that lacked it; 2 means lost
  lost_on TEXT,                                  -- the date it was marked lost (two files without it, or the expiry
                                                 -- passed); NULL while held. Deleted sosa.LOST_KEEP_DAYS later.
  lost_why TEXT,                                 -- absent | expired
  PRIMARY KEY (agreement_number, supplier_norm, delivery_point_code)
);
CREATE INDEX IF NOT EXISTS idx_sosa_holders_org ON sosa_holders(organization_id);

-- The call-ups the published contracts record against an instrument
-- (contracts.standing_offer_number equal to the agreement number, spaces and
-- case folded) over ten fiscal years, per holder organization; '' gathers the
-- rows whose vendor is no resolved holder (another firm, a person withheld,
-- a name with no profile). Rebuilt whole every night.
CREATE TABLE IF NOT EXISTS sosa_callups (
  agreement_number TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL,                            -- published contract rows
  value REAL,                                    -- their counted values (organizations.CONTRACT_CHECKED); NULL for none
  n_no_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agreement_number, organization_id)
);

-- The gains and losses of holders resolved to an organization, for the watch
-- events: the records sync carries each row once into rec_events
-- (records_db.derive_events: instrument_gained, instrument_lost). kind 12: the
-- organization gained the instrument in a region; 13: it no longer holds it
-- there. Rows older than sosa.EVENT_KEEP_DAYS are deleted.
CREATE TABLE IF NOT EXISTS sosa_events (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,                             -- the file's publication date (gained, lost by absence) or the run's (expired)
  kind INTEGER NOT NULL,                         -- 12 gained | 13 no longer held
  ref TEXT NOT NULL,                             -- 'sosa:<agreement number>'
  oid TEXT NOT NULL,                             -- the holder's organization
  region TEXT NOT NULL,                          -- the delivery point code
  endd TEXT,                                     -- the instrument's expiry
  why TEXT,                                      -- 13 only: absent | expired
  UNIQUE (kind, ref, oid, region, day)
);
CREATE INDEX IF NOT EXISTS idx_sosa_events_day ON sosa_events(day);
