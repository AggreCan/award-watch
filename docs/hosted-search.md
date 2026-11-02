# Hosted search

The search field in the top bar of every page, and the page it submits to,
`/search?q=`, find an organization or a federal buyer by name. They read a
D1 database of their own, `awardwatch-search` (binding `SEARCH` in
`site/wrangler.jsonc`), which the nightly workflow keeps current. The code
is `pipeline/awardwatch_pipeline/search_db.py` (the rows and the sync),
`pipeline/search_schema.sql` (the schema), the step "Sync the search
database" in `.github/workflows/nightly.yml`, and on the site
`site/src/search_db.ts` (the queries) and `site/src/pages/search.tsx` (the
page).

## What is indexed

Two tables, one row each per:

- **organization** (`search_orgs`): every row of `organizations`, which is
  every organization with a profile. The row holds the display name; every
  other spelling its records carry (`organization_names`, most frequent
  first, at most 40 spellings and 4,000 characters, a spelling that differs
  from another only in case, accents or punctuation kept once); its business
  numbers (every valid nine-digit number on its grant rows, the number on
  its `organizations` row, and the federal corporations extract's number
  through an exact registry match only); the directory it files under (a
  province or territory, `XX` outside Canada, `UN` with no usable address)
  and its city; the record count per source and their sum (the directory's
  record count); and the per-source totals as the profile shows them.
- **buyer** (`search_buyers`): every buyer in the export's
  `buyers/index.json`, which is every buyer with a page. The row holds the
  English and French names, both acronyms, every spelling the sources use
  (`buyer_names`), the buyer ids retired into it (`buyers/aliases.json`),
  the open notices, the record counts and the totals as `/buyers` shows
  them.

Aliases. An organization merged into another (`merges.py`) or retired by a
normalization change (`migrate.py`) is a row of `organization_aliases`. Its
records move to the live organization, so its spellings are among the live
one's `organization_names` and find it. A name column on the alias table, if
one is ever added, is indexed beside them. A retired buyer id is indexed as a
spelling of the buyer it leads to. A query that is exactly an organization id
(`org-` and ten hex digits) goes straight to `/organizations/<id>`, which
sends a retired id on to the live profile.

Records themselves (titles, descriptions, references) are not searched.

A full-text index on each table (FTS5, external content, the tokenizer
`unicode61 remove_diacritics 2`, so "quebec" finds "Québec") covers the
names: for organizations the display name, the other spellings and the
business numbers; for buyers the English name, the French name, and the
acronyms with the other spellings. Triggers keep each index in step with its
table, so the sync writes only the tables. The column `folds` holds the
display name (for a buyer, both names and both acronyms, one per line) in
lower case without accents or punctuation, which the ranking compares with
the query folded the same way (`search_db.fold` in the pipeline,
`foldText` on the site).

The database is apart from `award-watch`, which holds what readers submit,
so a full reload here can never touch a response or a correction. It needs
no backup: a full reload rebuilds it from the pipeline database.

## The nightly sync

The step runs after "Check the database and the export", when both checks
passed, and before the bundle, the deploy and the database save.

1. `search-sync` builds tonight's rows (organizations from the database,
   buyers from the export just written), hashes each (a 64-bit BLAKE2b over
   its values) and compares it with the ledger, `search_ledger` in the
   pipeline database, which holds the key (`o:<id>` or `b:<id>`) and hash of
   every row as last confirmed in D1. A new key or a changed hash is an
   upsert; a key the ledger holds that tonight lacks is a delete. It writes
   them to `data/out/search/` as `batch-0001.sql` and on, at most 5 MB or
   5,000 statements a file, up to 100 rows in one upsert and 500 ids in one
   delete, no statement above 64 KiB (D1 refuses 100 KB); `batches.txt`
   lists the files in order, and `manifest.json` (written last) holds the
   counts, the rows each table must hold afterwards and the ledger entries
   to record. It writes `failed` to `data/out/search/last_outcome.txt`
   before it starts.
2. Wrangler applies `search_schema.sql` (every statement `IF NOT EXISTS`, so
   it changes nothing on a database that has it), then each batch in order.
   D1 runs each file as one transaction, so the step stops at the first
   failed batch with every earlier one applied in full.
3. Wrangler reads `SELECT (SELECT COUNT(*) FROM search_orgs) AS orgs,
   (SELECT COUNT(*) FROM search_buyers) AS buyers` back, and `search-check`
   compares both counts with the manifest.
4. Only then does `search-synced` record the manifest's entries in the
   ledger, log the sync in `search_sync` (the manifest's summary, the rows
   the ledger holds, whether it was a full reload) and write `synced`, or
   `nothing to send` when there was no batch.

Every statement gives the same result applied twice: rows are written with
`INSERT ... ON CONFLICT (id) DO UPDATE ... WHERE hash IS NOT excluded.hash`
(never `INSERT OR REPLACE`, whose implicit delete fires no trigger and would
leave old names in the full-text index), deletes name ids. Nothing but
`search-synced` writes the ledger, so a night that stops anywhere leaves it
as it was and the next night sends the same changes again. The ledger
travels to R2 with the database, which is why the step runs before the save.

A full reload drops both tables (which drops their triggers and indexes at no
per-row cost), applies the schema again and sends every row. The sync makes
one by itself when the ledger is empty (the first load, or a database
restored without its ledger) and when a count read back disagreed on an
earlier night, but never twice within seven days, so a fault that keeps a
count wrong cannot reload every night. A row applied on a night whose later
batch failed, then gone from the data before the retry, is in D1 without
ever being in the ledger; the count catches it and the reload removes it.

## Limits and what it costs

Measured on the sample run (the 2026-10-31 sample files: 6,928
organizations and 87 buyers), a full reload is 1.28 MB of SQL in two
batches (the reset and one of rows), 72 statements, 179 bytes of SQL per
organization. Loaded, each organization holds about three rows (its table
row, its entry in the `id` index, its full-text document row) plus a share
of the full-text segments.

Scaled to the 373,261 organizations of the first full nightly run:

| | Estimate |
|---|---|
| SQL for a first load or full reload | about 67 MB, 14 batches of 5 MB, 3,733 upsert statements |
| Rows held, and so rows written by the load | about 1.1 million, plus the full-text segment merges (low millions at most) |
| Database size | about 80 MB |
| A night | the organizations whose figures or spellings changed: thousands of rows, one batch |
| The count check | one read of each table, about 373,000 rows read a night |

The sample's organizations carry few other spellings (4% have one); the full
data carries more, which adds bytes but no rows. The caps bound the worst
case at about 4.3 KB of SQL per organization. The Workers Paid plan includes
50 million rows written and 25 billion rows read a month, and the automatic
reloads come at most weekly.

What a search reads: the full-text index lists every match once per
statement (the count, the page and the name tier), so a word in many names
reads tens of thousands of index rows, and a one-letter last word is matched
whole rather than as a prefix (a one-letter prefix would list every word
with that letter).

## The page

`/search` is a page like any other for the per-address limit
(`site/src/limits.ts`) and the views (route `/search`; the query is never
stored). It is `noindex`, and `robots.txt` keeps crawlers off it.

- The query: at most 200 characters, folded, at most 8 words of letters and
  digits. Each word becomes a quoted FTS5 phrase and the last one a prefix
  (`"tim" "horton"*`).
- Ranking: a match on the name itself (an exact display name, for a buyer
  either name or an acronym; a name that starts with the query; a name
  holding every word) first, then a match through another spelling or a
  business number; within each, more records first, then by name. Every word
  matches as a prefix in each kind of name match, so they rank alike: "IBM
  Canada Ltd." with 4,172 records comes before "IBM" with 22. A match through another spelling shows "Also recorded as"
  and the spelling; a match through a business number shows the number.
- Two panels on the column system: the matching buyers (the 50 closest, on
  the first page) and the organizations, 50 to a page (`?page=`, at most 200
  pages; a page past the last shows the last).
- No query: what the search covers and links to the directory and the buyers
  list. Nothing matches: the same links. No database, a failed query, or a
  database with no row yet (the first night, or a full reload under way):
  "Search Is Unavailable" with the same links, status 503 and
  `Cache-Control: no-store`, so nothing keeps it. A night whose sync failed
  still deploys, and the page answers from what D1 already holds.

There is no `/api/search`: the page is rendered on the server and needs no
API, and no public API is open.

## No SQL injection

- Every statement is a constant in `site/src/search_db.ts`, prepared with `?`
  placeholders. The visitor's text reaches D1 only as bound values, after the
  fold.
- Text never reaches `MATCH` as typed: the fold keeps letters and digits
  only, so quotes, parentheses, colons (column filters), `*`, `^`, `-` and
  `NEAR(` cannot survive, and `AND`, `OR`, `NOT` and `NEAR` become quoted
  words. The two column filters (`name` and `{name name_fr}`) are written in
  the code.
- A failure is logged as a SQLite or D1 code and a fixed phrase, never the
  message, which for FTS5 quotes the expression built from the query.
- The tests (`site/test/search.test.ts`) build every statement from
  injection payloads (quotes, parentheses, `NEAR`, column filters, stars,
  NUL, zero-width and full-width characters, other scripts, 5,000
  characters, 40 words) and check each is quoted words or nothing, that the
  SQL is one of the constants, and that each request answers 200 with the
  tables unchanged. The batch files the pipeline writes quote every text
  value with single quotes doubled and refuse a NUL
  (`pipeline/tests/test_search_db.py`).

## Forcing a full reload

Usually there is no need: a count that disagrees schedules one by itself. To
force one, from the project account's own machine, with
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set, on a copy of the
newest backup unpacked to `data/awardwatch.sqlite` and its static export in
`data/out/static`:

```
cd pipeline
python -m awardwatch_pipeline search-sync --full --db ../data/awardwatch.sqlite
cd ../site
npx wrangler d1 execute awardwatch-search --remote --yes --file ../pipeline/search_schema.sql
npx wrangler d1 execute awardwatch-search --remote --yes --file ../data/out/search/batch-0001.sql
...                                  (every file in batches.txt, in order, stopping at a failure)
npx wrangler d1 execute awardwatch-search --remote --json --command "SELECT (SELECT COUNT(*) FROM search_orgs) AS orgs, (SELECT COUNT(*) FROM search_buyers) AS buyers" > ../data/out/search/count.json
cd ../pipeline
python -m awardwatch_pipeline search-check --manifest ../data/out/search/manifest.json --counts ../data/out/search/count.json
```

The first batch drops and recreates the tables, so search answers
"unavailable" until the last batch is applied. A changed column or tokenizer
in `search_schema.sql` reaches D1 only this way. Skip `search-synced`: the
ledger that counts is the one in R2's database, and the next night compares
with it. Avoid the nightly window (12:30 UTC to about 13:30 UTC).

## Local development

```
cd site
npm run data:local      # the export into public/data
npm run db:local        # the forms database and the search schema, both local
cd ../pipeline && python -m awardwatch_pipeline search-sync --full --db ../data/awardwatch.sqlite
cd ../site && npm run search:local   # applies the batches to the local awardwatch-search
npx wrangler dev
```

Every command there carries `--local`; none reaches the account.

## When the run status says "failed"

`search_sync: failed` in `status.json` is an item needing attention: the
workflow's last step lists it ("Search database sync: failed (sent again
next run)"), and the Worker's daily check emails it. The rest of the run
carries on, deploy and save included. It means one of: `search-sync` could
not read the database or the export, or could not write a value (the log
names the row and column); Wrangler could not apply the schema or a batch
(D1 rolled that batch back); a count read back disagreed (nothing recorded,
a full reload scheduled); or the step reached its 60-minute limit. In every
case the ledger is unchanged and the next night sends the same changes
again. `not run` means the checks before it failed.
