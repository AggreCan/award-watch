-- The hosted search database: D1 `awardwatch-search`, binding SEARCH.
--
-- A database of its own, apart from the forms database (`award-watch`, from
-- schema.sql), so a rebuild here can never touch what readers submitted.
-- Written only by the nightly sync (pipeline/awardwatch_pipeline/search_db.py),
-- which applies this file before every sync: every statement is IF NOT
-- EXISTS, so it changes nothing on a database that has it. A change to a
-- table here reaches an existing database only through a full reload
-- (`search-sync --full`), whose first batch drops the tables and runs this
-- file again.
--
-- Two tables: one row per organization (every one with a profile) and one
-- per buyer with a page (buyers/index.json of the export). Records are not
-- searched. The site reads them with prepared statements only
-- (site/src/search_db.ts).

-- One row per organization. name is the display name; alt every other
-- spelling its records carry (and an alias's name), one per line, most
-- frequent first; bn its business numbers, space separated; folds the
-- display name in lower case without accents or punctuation (search_db.fold,
-- site/src/search_db.ts foldText), which the site compares with the folded
-- query to rank an exact or leading match first. prov is the directory the
-- organization files under: a province or territory code, XX outside
-- Canada, UN with no usable address.
CREATE TABLE IF NOT EXISTS search_orgs (
  rid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,                       -- organizations.id
  name TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  bn TEXT NOT NULL DEFAULT '',
  folds TEXT NOT NULL,
  prov TEXT NOT NULL,
  city TEXT,
  n_awards INTEGER NOT NULL,
  n_history INTEGER NOT NULL,
  n_contracts INTEGER NOT NULL,
  n_grants INTEGER NOT NULL,
  n_lobbying INTEGER NOT NULL,
  n_records INTEGER NOT NULL,                    -- the five counts together, as the directory shows them
  total_awards REAL,                             -- each source on its own, as the profile shows them
  total_history REAL,
  total_contracts REAL,
  total_grants REAL,
  hash TEXT NOT NULL                             -- search_db.row_hash over every column above but rid
);

-- One row per buyer with a page. name is the English name and name_fr the
-- French; alt the acronyms and every other spelling the sources use, one per
-- line; folds the two names and the acronyms folded, one per line.
CREATE TABLE IF NOT EXISTS search_buyers (
  rid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,                       -- buyers.id
  name TEXT NOT NULL,
  name_fr TEXT,
  acronym_en TEXT,
  acronym_fr TEXT,
  alt TEXT NOT NULL DEFAULT '',
  folds TEXT NOT NULL,
  kind TEXT,
  n_tenders INTEGER NOT NULL,
  n_open_tenders INTEGER NOT NULL,
  n_awards INTEGER NOT NULL,
  n_history INTEGER NOT NULL,
  n_contracts INTEGER NOT NULL,
  n_grants INTEGER NOT NULL,
  n_records INTEGER NOT NULL,
  total_awards REAL,
  total_history REAL,
  total_contracts REAL,
  total_grants REAL,
  hash TEXT NOT NULL
);

-- Full-text indexes over the names. External content: the text lives once,
-- in the tables above, and the triggers below keep each index in step, so
-- the sync writes the tables only. remove_diacritics 2 lets "Quebec" find
-- "Québec".
CREATE VIRTUAL TABLE IF NOT EXISTS search_orgs_fts USING fts5(
  name, alt, bn,
  content = 'search_orgs', content_rowid = 'rid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_buyers_fts USING fts5(
  name, name_fr, alt,
  content = 'search_buyers', content_rowid = 'rid',
  tokenize = 'unicode61 remove_diacritics 2'
);

-- An external-content index must be told the old text to remove it, so each
-- trigger passes the row's values as they were. The sync writes rows with
-- INSERT ... ON CONFLICT DO UPDATE, never INSERT OR REPLACE: the rows REPLACE
-- deletes fire no delete trigger unless recursive triggers are on, which
-- would leave the old text indexed. The update trigger runs only when an
-- indexed column changed, so a row whose counts changed costs no index
-- writes. BEGIN and END stay on lines of their own (the site's test setup
-- splits this file on them).
CREATE TRIGGER IF NOT EXISTS search_orgs_ai AFTER INSERT ON search_orgs BEGIN
  INSERT INTO search_orgs_fts (rowid, name, alt, bn) VALUES (new.rid, new.name, new.alt, new.bn);
END;

CREATE TRIGGER IF NOT EXISTS search_orgs_ad AFTER DELETE ON search_orgs BEGIN
  INSERT INTO search_orgs_fts (search_orgs_fts, rowid, name, alt, bn) VALUES ('delete', old.rid, old.name, old.alt, old.bn);
END;

CREATE TRIGGER IF NOT EXISTS search_orgs_au AFTER UPDATE ON search_orgs
WHEN old.rid IS NOT new.rid OR old.name IS NOT new.name OR old.alt IS NOT new.alt OR old.bn IS NOT new.bn
BEGIN
  INSERT INTO search_orgs_fts (search_orgs_fts, rowid, name, alt, bn) VALUES ('delete', old.rid, old.name, old.alt, old.bn);
  INSERT INTO search_orgs_fts (rowid, name, alt, bn) VALUES (new.rid, new.name, new.alt, new.bn);
END;

CREATE TRIGGER IF NOT EXISTS search_buyers_ai AFTER INSERT ON search_buyers BEGIN
  INSERT INTO search_buyers_fts (rowid, name, name_fr, alt) VALUES (new.rid, new.name, new.name_fr, new.alt);
END;

CREATE TRIGGER IF NOT EXISTS search_buyers_ad AFTER DELETE ON search_buyers BEGIN
  INSERT INTO search_buyers_fts (search_buyers_fts, rowid, name, name_fr, alt) VALUES ('delete', old.rid, old.name, old.name_fr, old.alt);
END;

CREATE TRIGGER IF NOT EXISTS search_buyers_au AFTER UPDATE ON search_buyers
WHEN old.rid IS NOT new.rid OR old.name IS NOT new.name OR old.name_fr IS NOT new.name_fr OR old.alt IS NOT new.alt
BEGIN
  INSERT INTO search_buyers_fts (search_buyers_fts, rowid, name, name_fr, alt) VALUES ('delete', old.rid, old.name, old.name_fr, old.alt);
  INSERT INTO search_buyers_fts (rowid, name, name_fr, alt) VALUES (new.rid, new.name, new.name_fr, new.alt);
END;
