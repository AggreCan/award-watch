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
  kind TEXT,                                     -- department | agency | crown | other
  n_tenders INTEGER NOT NULL DEFAULT 0,
  n_awards INTEGER NOT NULL DEFAULT 0,
  n_history INTEGER NOT NULL DEFAULT 0,
  n_contracts INTEGER NOT NULL DEFAULT 0,
  n_grants INTEGER NOT NULL DEFAULT 0,
  total_awards REAL,
  total_contracts REAL,
  total_grants REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS buyer_names (
  raw_name TEXT NOT NULL,
  source TEXT NOT NULL,                          -- canadabuys | ckan | lobbying | seed
  buyer_id TEXT NOT NULL REFERENCES buyers(id),
  PRIMARY KEY (raw_name, source)
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
  provinces TEXT,                                -- JSON list of two-letter codes derived from the delivery regions
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
  PRIMARY KEY (buyer_id, year, source)
);

-- The sync ledger of the hosted search database (search_db.py), when it ships.
CREATE TABLE IF NOT EXISTS search_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  manifest TEXT NOT NULL,
  rows INTEGER NOT NULL,
  full INTEGER NOT NULL
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

-- Organization ids retired by a normalization change (migrate.py), each with
-- the id that took over its records, so a link to an old profile can be sent
-- on. export_static writes it, chains followed to the live id, as
-- aliases/<abc>.json.
CREATE TABLE IF NOT EXISTS organization_aliases (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL,
  normalize_version INTEGER NOT NULL,            -- the normalization in force when old_id was retired
  created_at TEXT NOT NULL
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
  provinces TEXT,                                -- JSON list of delivery provinces
  entered_3m TEXT,                               -- the data date on which the row entered the 3-month window (the feed's
                                                 -- entry date, carried over between rebuilds); NULL outside the window
  computed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expiring_end ON expiring_contracts(end);

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
