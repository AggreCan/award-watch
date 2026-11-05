# Analytics

The analytics views chart one buyer, one organization or one UNSPSC segment
over federal fiscal years, from a D1 database of the records themselves. They
are part of Pro (feature `analytics`). A free reader sees the first chart of
each view for the latest three fiscal years and a short note naming what the
rest of the view holds. Phase 1 built the three views, their tables and a CSV
file of each table. Phase 2 added periods chosen by their first and last
fiscal year, the average and median value by fiscal year, the ten largest
records with their references and titles, the change in value through
amendments, the contracts ending in each of the next eight fiscal quarters,
and a line in the daily check's email for a failed sync. The same database
serves a page per published contract, the record tables, the radar over its
whole window, the earlier awards on a tender, the incumbents and the
organization feeds (sections below). What is left is listed under *Phase 3*
at the end.

The code is `pipeline/awardwatch_pipeline/records_db.py` (the rows and the
sync), `pipeline/records_schema.sql` (the schema), the step "Sync the records
database" in `.github/workflows/nightly.yml`, and on the site
`site/src/records_db.ts` (the queries), `site/src/pages/analytics.tsx` (the
pages and the CSV files) and `site/src/watchdog.ts` (the daily check's line);
for the record pages, `site/src/records_tables.ts` (their statements) and
`site/src/pages/published.tsx`, `records.tsx`, `backbone.tsx` and
`expiring.tsx`.

## The database

D1 `awardwatch-records`, binding `RECORDS` in `site/wrangler.jsonc`. It is a
database of its own: a full reload here touches neither the forms, the search
database nor the accounts. Written only by the nightly sync; the site only
reads it, with prepared statements.

| Table | One row per | Rows (estimate) |
|---|---|---|
| `records` | counted record of the four money sources, plus one row for each further segment a notice's codes reach | about 2.8 million |
| `rec_orgs` | organization named on a record: its number and display name | about 350,000 |
| `rec_buyers` | buyer named on a record or on a contract ending: its number, id and names | about 1,000 |
| `rec_buyer_quarters` | buyer, source, fiscal year and quarter: count, value, count without a value | about 50,000 at most |
| `rec_segment_years` | segment, source and fiscal year: count, value, buyers, organizations, and the count, sum and median of the values above zero | about 2,000 |
| `rec_buyer_years` | buyer, source and fiscal year with a value above zero: the count, sum and median of those values | about 15,000 at most |
| `rec_due` | buyer or segment, and fiscal quarter (the eight from the data date's): the contracts ending, their value, the count without a value | a few thousand |
| `rec_details` | counted record with a date that names a buyer or an organization: its date, reference and title beside its figures (the record tables, the feeds) | about 2.4 million |
| `rec_classes` | UNSPSC class of an award notice or history record that names a buyer (the earlier awards on a tender) | about 1.5 million |
| `rec_expiring` | row of the radar's 12-month window, as the static export writes it | about 20,000 |
| `rec_contracts` | published contract row: every field its page shows (`/contracts/<department>/<reference>`) | about 1.34 million |
| `rec_gsin` | GSIN code a published contract carries: its names | about 10,000 at most |
| `rec_meta` | key: `state` (`loading` or `ready`), `as_of` (the data date the rows describe), `rules` | 3 |

A row of `records` is one record as the profiles count it (*Counting money*
on the Methodology page): an award notice or a PSPC history contract by its
reference (the newest amendment), a published contract row, a grant or
contribution agreement by department and reference (the highest amendment).
Its columns are small integers or short codes, apart from the reference and
title phase 2 added: about 100 bytes a row with its indexes before them,
about 180 with them (an estimate made before the first reload; that reload's
manifest gives the bytes sent):

- `k`: the row's key, a 64-bit hash of the record's own key
  (`award:<reference>`, `contract:<department>:<reference>` and so on). The
  site never reads it.
- `src`: 1 award notice, 2 PSPC contract history, 3 published contract,
  4 grant or contribution.
- `fy`, `fq`: the federal fiscal year (April to March, named by the calendar
  year it starts in: 2025 is 2025-26) and its quarter (1 is April to June),
  from the award date (notices and history), the contract date (published
  contracts) or the agreement start (grants). Null without a date.
- `bid`: the buyer, a 40-bit number from the buyer id (`rec_buyers` maps it
  back). For PSPC contract history the buyer is the client department, as on
  the buyer pages.
- `oid`: the organization, the ten hex digits of its id read as a number
  (`org-00000000ff` is 255). Null when the supplier is withheld or names no
  organization.
- `sid`: the UNSPSC segment as a number (43 for segment 43); award notices
  and PSPC history only, the sources that carry UNSPSC codes. A notice whose
  codes reach several segments has its own row under the lowest one and a
  row with `extra = 1` under each other, so a segment view counts it in each
  segment as the segment pages do, while every other figure reads the rows
  with `extra = 0` and counts it once.
- `cents`: the counted value in Canadian cents; null when the value is in
  another currency, was not published, or is flagged for checking.
  `vnote` says which (0 counted, 1 not published, 2 another currency,
  3 flagged).
- `comp`: 1 competitive, 0 non-competitive, null not stated (grants: null).
- `meth`: the method as the TBS two-letter code (OB, TC, ST, TN, AC),
  read from the CanadaBuys procurement method or the published contract's
  solicitation procedure; null when not stated or when CanadaBuys names
  another competitive method.
- `namd`, `ocents`: award notices and PSPC history only, the sources that
  number their versions. `namd` counts the versions after the first (0 for a
  contract never amended). `ocents` is the first version's value by the
  rule `cents` follows for the newest (the total value when positive, else
  the amount), in cents; null when `cents` is null or the contract is
  cancelled, because a cancelled contract's zero is a status and would read
  as a fall in value. Both are null for published contracts and grants.
- `ref`: what the largest-records table links. Award notices and history:
  the reference in the URL form its page has (`export_static.RefMap`); null
  when the site serves no page for it or it is longer than 120 characters.
  Published contracts and grants: `<department>:<reference>`.
- `title`: the English title (a published contract's description), else the
  French, with email addresses and telephone numbers scrubbed first
  (`export.scrub`, before the cut so it never splits one), whitespace folded,
  cut at a word within 120 characters with an ellipsis; null when neither
  language has one. A notice's extra rows carry the reference and title too,
  so a segment's largest records can show them.

Grants whose recipient reads as a person (`recipient_withheld`) are not in the
database at all. A contract whose supplier reads as a person is in it with no
organization, the way the export keeps it, and counts in its buyer's figures.

Indexes: `records (bid, src, fy)`, `records (oid, src, fy)` and
`records (sid, src, fy)`, each partial (`WHERE ... IS NOT NULL`), so the
published contracts and grants, which carry no segment, cost no segment
index entry; `rec_buyers (id)`; `rec_buyer_quarters (bid, src, fy)`;
`rec_segment_years (sid, src, fy)`; `rec_buyer_years (bid, src, fy)`;
`rec_due (bid, fy, fq)` and `rec_due (sid, fy, fq)`, each partial. No index
holds `ref` or `title`: a statement reads them only for the ten rows it
keeps. The record tables' indexes are named in their sections below. Every
statement the site sends names one of the indexes (`site/test/analytics.test.ts`
and `site/test/records-tables.test.ts` read each query plan, and
`site/test/accounts-records-deliveries.test.ts` those of the deliveries).

### The summary rows of phase 2

The average and median value are computed by the sync, not at request time,
so no statement sorts a year's values for a reader. For each buyer, source
and fiscal year (rows with `extra = 0`) and each segment, source and fiscal
year (every row, extra or not, as the segment's other figures count), the
records with a counted value above zero give their count (`n_pos`), sum
(`pos`) and median (`med`); the average shown is `pos / n_pos`. The median
of an even count is the mean of the two middle values, its half cent
dropped. `records_db.value_figures` reads them in one ordered pass.

`rec_due` is built by `records_db.due_rows` from the radar's own candidates
and duplicate rule (`expiring.notice_candidates`, `contract_candidates` and
`dedupe`: the newest version's end date, no cancelled contract, each
contract once across award notices, history and published contracts), from
the data date to the last day of the eighth fiscal quarter, which runs past
the radar's twelve months. Each contract counts under the radar row's buyer
(the one the radar's `?buyer=` filter reads) and under each of its segments;
a row is one or the other. The value added is the radar's, in Canadian
dollars and not flagged; `n_no_value` counts the contracts whose source
published none. The table is rebuilt from the data date every night, so a
quarter behind it drops out.

## The nightly sync

Modelled on the search sync (`docs/hosted-search.md`), with three changes for
a table a hundred times larger.

1. `records-sync` builds tonight's rows into temporary tables of the
   pipeline database, hashes each row, and compares the hashes with the
   ledger (`records_ledger` in `schema.sql`: table, key and hash of every row
   D1 holds). The differences go to `records_staged`, not to the manifest,
   since a first load would make a manifest of a hundred megabytes. It writes
   the batches (at most 5 MB or 5,000 statements a file, 500 rows an upsert
   or fewer when its titles are long, 500 keys a delete, no statement above
   64 KiB), `batches.txt`, `finish.sql`
   and `manifest.json` under `data/out/records/`, and `failed` to
   `last_outcome.txt` before it starts.
2. Wrangler applies `records_schema.sql` (every statement `IF NOT EXISTS`)
   and each batch in order, then reads each table's row count back;
   `records-check` compares them with the manifest.
3. Only then does Wrangler apply `finish.sql`, which sets `state` to `ready`
   and `as_of` to tonight's data date, and `records-synced` moves the staged
   entries into the ledger, logs the sync in `records_sync` and writes
   `synced` or `nothing to send`.

Every statement gives the same result applied twice (upserts by key, deletes
by key). Nothing but `records-synced` writes the ledger, so a night that
stops anywhere leaves it as it was and the next night sends the same changes
again; the manifest carries a plan number that `records-synced` holds against
the staged rows, so an old manifest records nothing. A night that stops
leaves its staged rows in the pipeline database (and so in that night's
backup) until the next `records-sync` empties the table; after a failed first
load that is about 3 million small rows, and about 5.3 million after a failed
first night of the record tables.

A full reload drops the tables, applies the schema, sets `state` to
`loading`, and sends every row. The pages answer "being loaded" until
`finish.sql` sets it back, so no reader sees half a load. The sync makes one
by itself on an empty ledger and after a count read back disagreed, but not
within 28 days of the last one (a full load of the twelve tables writes
about 25 million rows, half of the plan's monthly allowance).

It also makes one, whatever the days, when the tables changed form. D1
creates a table only when it is missing, so a new column reaches a database
that has the table only through the drop. `records_db.LAYOUT` names the form
`records_schema.sql` creates (1 for phase 1, 2 since phase 2 added its
columns and tables; the record tables, new tables beside them, left it at
2); `records-synced` records it in the pipeline
database's meta (`records_layout`) after a full load, and a sync that finds
another value, or none (a database last loaded by phase 1), reloads in full.
A reload that stops records nothing, so the next night reloads again. A
change to a table in `records_schema.sql` raises `LAYOUT` in the same change.

When `site/wrangler.jsonc` still holds the placeholder database id, the step
sends nothing and writes `no database`, a notice in the run status rather
than an item needing attention. `failed` is an item needing attention
("Records database sync: failed (sent again next run)"); the run goes on and
the views answer from what D1 holds. The run status carries the outcome as
`records_sync`, and the Worker's daily check (`site/src/watchdog.ts`) emails
a line for `failed`; `no database` reaches that email only among the
nightly's notices, and the other outcomes not at all.

What it costs, estimated from the sources' sizes on 2026-11-01 (1.34 million
published contracts, 1.07 million grant rows, the CanadaBuys notices and
history). The reference and title of phase 2 are estimated at about 80
bytes a row; the first layout 2 reload's manifest (`bytes`, `batches`) gives
the measured figures.

| | Estimate |
|---|---|
| A first load or full reload | about 500 MB of SQL in about 100 batches for the analytics tables (phase 1: 290 MB in about 60); about 3.2 million rows and 9 million index entries written. The record tables and the published contracts' pages add about 1.1 GB in about 230 batches and 5.3 million rows, sent as ordinary changes on their first night; a full reload after that sends both, about 1.6 GB in about 330 batches. Counted as D1 bills it, a full reload of all twelve tables is about 25 million row writes, half of the 50 million a month the paid plan includes, which is why a LAYOUT change waits for room in the month |
| A night | the records whose figures, organization, buyer, flag, reference or title changed, the `rec_due` rows that moved, and the record-table, radar-window and published-contract rows that changed: thousands to tens of thousands of rows, one or two batches |
| The count check | one count of each table: about 3.2 million rows read a night for the analytics tables, about 8.5 million with the rest |
| Database size | about 600 MB for the analytics tables (phase 1: about 400 MB); about 2 GB with the record tables and the published contracts' pages |
| The ledger in the pipeline database | about 3.2 million rows, about 70 MB, for the analytics tables (a row's hash covers phase 2's new columns, so they did not grow it); the record tables and the published contracts' pages add about 5.3 million rows |

## The views

| View | Address | Charts, each with its table |
|---|---|---|
| Buyer | `/buyers/<id>/analytics` | value by fiscal quarter; the average and median value by fiscal year; the ten largest records; value by segment (notices and history); the non-competitive share by fiscal year, by count and by value; the ten organizations with the largest values and the share the largest one, five and ten hold; the change in value through amendments (notices and history); the contracts ending in each of the next eight fiscal quarters |
| Organization | `/organizations/<id>/analytics` | value by fiscal year; the ten largest records; the ten buyers with the largest values; the ten segments with the largest values (notices and history); its share of one segment's value by fiscal year beside up to five other organizations chosen from that segment's 25 largest; the change in value through amendments (notices and history) |
| Segment | `/segments/<nn>/analytics` | buyers and organizations with a record, by fiscal year; the average and median value by fiscal year; the ten largest records; the ten buyers and the ten organizations with the largest values; the organizations new to the segment in the latest fiscal year; the contracts ending in each of the next eight fiscal quarters |

Each view reads one source at a time (`?source=awards`, `history`,
`contracts` or `grants`; a segment view `awards` or `history`), because no
figure ever adds two sources. The default is the source with the most
records on the entity's own page (award notices on a tie, and on a segment
view). `?years=3`, `5` or `10` sets the period:
that many fiscal years ending with the one the data date falls in, which is
partial and marked so. `?from=` and `?to=` set it by its first and last
fiscal year instead, and win over `?years=` when either is present
(`records_db.choosePeriod`): the last is a year from 2000 (`EARLIEST_FY`) to
the data date's, anything else reading as the data date's; the first is a
year from 2000 up to the last, anything else reading as the ten years ending
with the last; a span longer than ten keeps its latest ten and says so in
the view's head. The form beside the period tabs writes the two fields, and
every link and form on the view carries the period as it was chosen, so a
period is an address that can be linked.

The organization view takes `?segment=<nn>` and up to five `?vs=org-...`
for its share chart; without a segment it uses the organization's largest,
and without a choice it compares the segment's five largest others. Only
organizations among the segment's 25 largest in the period are shown beside
it. Anything else in the address is ignored, never an error: a value outside
these lists reads as the default. Ids are checked as the entity pages check
them, and an entity with no page is the site's 404.

The ten largest records are ranked by counted value in the period and
source, ties by reference. Each row shows the title and links an award
notice or history record to its page here, a published contract to the
government's contracts search and a grant to its record in the grants
search, with the other party: the organization on a buyer view, the buyer on
an organization view, both on a segment view.

The change in value through amendments reads award notices and history by
the fiscal year of the award: the records, the share amended, and for the
amended records with a first value above zero and a counted newest value
(the "compared" column), the sum of the first values beside the sum of the
newest and the change between them. The other sources answer with a line
saying the panel needs one of these two.

The contracts ending follow neither the source nor the period: they are the
radar's, counted from the records' data date, and the panel says so. Each
quarter's row links the radar's narrowest window (`/expiring/3m`, `6m` or
`12m`) that holds the whole quarter, counted from the radar's own data date,
with the radar's own filter (`?buyer=<id>` or `?segment=<nn>`), so the
window lists that quarter's contracts and the ones before them; a quarter
that ends past the twelve months links nothing.

The CSV of a table is `<view address>/<table>.csv` with the same query
(`quarters`, `values`, `records`, `segments`, `competition`, `suppliers`,
`growth`, `due`; `years`, `records`, `buyers`, `segments`, `share`,
`growth`; `years`, `values`, `records`, `buyers`, `winners`, `entrants`,
`due`). The file's name gives the source and fiscal years, or for `due` the
fiscal year it counts from (`pwgsc-tpsgc-due-from-2026.csv`). The growth
file adds how many of the compared records grew. Pro only: any other request
gets the site's 404. The files are downloads for the per-address limit (ten
a minute) and are sent `private, no-store`.

## Bounds

- At most ten fiscal years in any statement, at most 40 quarter rows, top
  lists of 10, the competitor list of 25, the share chart 6 organizations.
  Every statement is a constant in `site/src/records_db.ts` with `?`
  placeholders; nothing typed reaches SQL (there is no free-text parameter).
- A full view runs one D1 batch: the state row and its charts' statements
  (the organization view a second batch when the address names no segment,
  to chart the largest one it has just read). A CSV file runs its table's
  statement alone beside the state row.
- The new entrants of a fiscal year are the organizations with a record in
  the segment and source that year and none in the nine fiscal years before
  it, so the statement reads ten fiscal years whatever the period shown.
- The contracts ending read `rec_due` for the data date's fiscal year and
  the two after it (`DUE_YEARS`), at most 12 quarter rows, of which the page
  shows eight.
- A chosen period never starts before 2000 nor ends after the data date's
  fiscal year, and never spans more than ten, so the `fy BETWEEN ?3 AND ?4`
  of every statement but the contracts ending keeps its bound.

## Free readers and the switch

While `ACCOUNTS_ENABLED` is not `"true"`, every analytics address is the
site's 404 and no page links to one: there is no Pro to show.

With the switch on, nothing is hidden. The buyer, organization and segment
pages link their view with the word Pro marked (`pro-tag`). A request whose
plan lacks `analytics` gets the view's head, its source tabs, the period tabs
and the period form (the longer periods and the form's button marked Pro),
the first chart for the latest three fiscal years with no table, and for
every other chart its title and one line of what it shows, marked Pro
(`pro-note`), with a link to `/account/billing` (signed out:
`/account/sign-in`). A free request that names a period, a segment or
organizations to compare gets the same page with a line saying the choice is
part of Pro. That page reads D1 once: one batch of the state row and the
first chart's statement, which reads a summary table (buyers, segments: at
most 12 rows) or the organization's own records of three fiscal years
through its index. The look of the Pro mark is
the two classes in `public/styles.css`, in both colour modes.

The pages are `noindex` and `robots.txt` keeps crawlers off them, so a crawl
of the profiles never turns into D1 reads.

## When the database is missing

No `RECORDS` binding, a database without the tables, `state` other than
`ready`, or a failed statement: the view answers "Analytics are not available
right now" with status 503, `Cache-Control: no-store` and a link back to the
entity page; a CSV answers the same status. A failure is logged as a D1 code
and a fixed phrase. The other readers answer the same states their own way:
the email delivery of organization, buyer and segment saved searches
(`docs/accounts.md`, *What each kind delivers*; statements in
`site/src/account/records_deliveries.ts`), which reads the counts by source
and fiscal year of one entity a search, and waits, sending nothing for those
kinds, while the database is missing, loading, failing or not at the data
date; and the pages and panels below.

A Worker newer than the database's tables (deployed before the night that
reloads them for a new `LAYOUT`) sends statements naming columns and tables
the database lacks: D1 refuses the batch and the full views answer the same
503 until the reload finishes. The free views read only phase 1's tables and
keep working. The nightly syncs the records before it deploys, so a change
left to the nightly never shows this.

The record tables (`rec_details` to `rec_gsin`) arrive as ordinary changes,
not through a reload, so `state` stays `ready` through the night that first
sends them. A Worker deployed before that night answers their pages and
panels as for a missing database until the tables exist, then reads them
while they fill; left to the nightly, the Worker reading them goes live only
after the sync, unless that sync stops short.

## A page per published contract

`/contracts/<department>/<reference>` (`site/src/pages/published.tsx`): one
row of the proactive disclosure of contracts over $10,000. The department is
the dataset's `owner_org` (`dnd-mdn`), since a reference number is unique
within one department only; the reference is as published, escaped as one
path segment (`W8486-123456%2F001%2FZM`), at most 200 characters. A
department in capitals is sent to its lower-case address. The radar's rows,
the profiles' published contracts and the record tables link their titles
here; the government's contracts search, which often lists nothing yet for
a new quarter, stays linked as the source.

The page is one D1 batch of two statements: the state row and
`PUBLISHED_CONTRACT_SQL` (`site/src/records_tables.ts`), which reads the row
through `rec_contracts_ref (dept, ref)` and up to 51 other rows of the same
contract (the rows sharing the department and `procurement_id`, as the radar
groups them) through `rec_contracts_group (dept, pid, cdate)`, with the
names, the counted value (`records` by the same key) and the GSIN names
joined by key. It shows the department, the organization (or that the
supplier is a person, withheld), the description, the contract, original and
amendment values, the value counted by the counting rules and, when every
version is listed, their sum (the radar's value), the dates and the radar
window of the contract's newest version, the solicitation procedure and the
competitive flag, the instrument, the commodity type and GSIN, the agreement
and trade agreement codes, the limited tendering reason, the number of bids,
the comments, and the provenance: the dataset, its file and last read
(`stats.json` `sources`), and the records' data date.

`rec_contracts` leaves out `loaded_at`, which changes for every row each
time the file is read, so a night sends only the rows that changed. Rows the
address cannot carry (a department that is not a buyer id, a reference over
200 characters or with a control character) are left out and counted in the
manifest's `left_out.contracts_unaddressable`.

The database missing, loading or failing answers 503 (`no-store`,
`Retry-After: 3600`) with the search; a row it does not hold answers 404 with
the same link. The page is cached like the other record pages
(`public, max-age=300`) and is not in the sitemaps.

## Record tables

`/organizations/<id>/records` and `/buyers/<id>/records`
(`site/src/pages/records.tsx`), linked from the profile and the buyer page:
every award notice, contract history record, published contract and grant
naming the organization or of the buyer over the ten fiscal years ending
with the data date's, from `rec_details` (one row per counted record, with
its date, reference, title and the figures the charts count). Newest first
or largest value first (`sort=largest`), 50 to a page (`page=`), filtered by
fiscal year (`year=2025`), the other party (`buyer=<id>` on a profile,
`organization=<id>` on a buyer page), source (`source=`) and method
(`method=OB|TC|ST|TN|AC`). Each title opens the record's page on the site
(award notices, history records, published contracts) or the government's
record of a grant. `<address>.csv` with the same query sends the matches
(at most 10,000).

`rec_details.ref` holds an award or history reference in the URL form its
page has, from the same `export_static.RefMap` that writes `records.ref`, so
the two tables agree on which records have a page. When two published
references reduce to one URL form, the first in sort order keeps the page;
the other record has none here, and its `ref` is `:` and the reference as
published (the `<department>:<reference>` shape with no department). A
reference with no URL form at all, whose record had no row before, is
written the same way. The
record tables, the earlier awards and the organization feeds show such a
record's title unlinked with its reference as plain text (a feed entry
carries it as content instead of a link). The ten largest records read
`records.ref`, which is null for it, so they show the title unlinked. The
value is not null because D1 created the column `NOT NULL`, and only a
`LAYOUT` change recreates a table; this changes the column's values, not
its form, so it needs none. A row whose `ref` changes this way hashes
differently, so the ledger sends it again as an ordinary change (as it does
when a later reference takes a URL form an earlier record held), and the
rows new to the table go as new rows.

Every statement reads through `rec_details_org (oid, day)` or
`rec_details_buyer (bid, day)`, held to a span within ten fiscal years: the
page, the count and total, and the other party's 100 most frequent (a
profile's buyers) or largest (a buyer's organizations), in one batch.

Once the accounts switch is on, the filters, the order, later pages and
the counts are part of Pro (`analytics`), and the file too
(`export_filtered`); a reader without them gets the newest 50 records (one
statement beside the state row) and a note marked Pro, and the file is the
site's 404. While the switch is off every reader gets the whole table and no
file. The pages are `noindex`, their links `nofollow`; the database missing
or loading answers 503 as the analytics views do.

## The radar over its whole window

`/expiring/3m`, `/6m` and `/12m` read the static window files while nothing
is filtered or sorted. A filter (buyer, client department `client=`,
organization `supplier=`, segment, competitive flag, value band, source, the
March 31 mark `fye=0`, the standing offer mark `sosa=0`) or `sort=value`
reads `rec_expiring` instead (`site/src/records_tables.ts`): one batch of the
state row, a page of 100 matches (`page=` counts the matches' pages), their
count, total and the number with no value, and the form's choices from the
whole window (its buyers, client departments and 200 largest
organizations, and its counts by flag, source, band and mark). Every
statement is bounded by the window's end dates through `rec_expiring_end`,
so none reads more than the 12-month window's rows (about 20,000). Such an
address is `noindex`.

`/expiring/<window>/rows.csv` with the same query sends the matches (at most
10,000, in the order shown) as CSV: Pro's (`export_filtered`, and
`radar_depth` for a deep window) once the accounts switch is on, the site's
404 otherwise and while the switch is off. It counts as a download for the
per-address limit and is sent `private, no-store`. A free reader of the
3-month window filters the whole window and sees the file marked Pro; the
deeper windows keep their ten-row tease without Pro.

`rec_expiring` is written from the static export's 12-month window files by
the same nightly sync (`records-sync --static`), so the two views of the
radar never disagree. When the records database is missing, loading or
failing, a filtered view filters the window file's page as before and says
so.

## Earlier awards, incumbents and organization feeds

Three panels and a feed read one statement each beside the state row
(`site/src/records_tables.ts`, rendered by `site/src/pages/backbone.tsx`);
a database that cannot answer leaves a one-line note and the page stands.

- **Earlier awards on an open tender** (`/tenders/<reference>` while the
  notice is open, for every reader): the records of the notice's buyer from
  the last ten fiscal years that share a UNSPSC class (a code's first six
  digits) with the notice, through `rec_classes_class (cls, bid, day)`. The
  statement returns the 50 sharing the most classes, newest first; the page
  ranks them by the words of four letters or more their titles share with
  the notice's title (either language) and shows ten.
- **Who holds the contracts ending within 12 months**, on each buyer page and
  segment page: the radar's 12-month window (`rec_expiring`) grouped by
  organization, the largest value first, at most 25, with each
  organization's count (linked to the radar filtered to it), counted value
  and soonest end. A buyer's rows are those naming it as the buyer or as the
  client department. Once the accounts switch is on, a reader without
  `radar_depth` sees the first three and a note marked Pro.
- **An organization's records feed**,
  `/data/feeds/organizations/<id>.xml` (linked from the profile): the 50
  newest records naming the organization within ten fiscal years, as Atom,
  each entry linking the record's page. The feed bucket's rate limit applies;
  the answer is `public, max-age=3600` and kept an hour in the edge's cache,
  so a poller costs one D1 read an hour. An id with no profile is the site's
  404; the database unable to answer gives 503.

With these, the buyer and segment pages read the records database once
each (the incumbents); the profile reads it only through its record table
and feed addresses.

## Local development

```
cd site
npm run db:local        # applies records_schema.sql to the local awardwatch-records too
cd ../pipeline && python -m awardwatch_pipeline records-sync --full --db ../data/awardwatch.sqlite --static ../data/out/static
cd ../site && for f in $(cat ../data/out/records/batches.txt); do npx wrangler d1 execute awardwatch-records --local --file ../data/out/records/$f; done
npx wrangler d1 execute awardwatch-records --local --file ../data/out/records/finish.sql
```

## Charts

Server-rendered, no script: the time charts are the site's own
(`site/src/chart.tsx` `ChartStack`: bars or a line in the one chart hue,
gridlines and labels in the text tokens, a hover title on each mark), one
panel per series on one scale where a chart compares (small multiples, so no
organization or source is told apart by colour), with a thinner bar when a
chart has few slots (`barGap`). A ranking is a list of horizontal bars on one
baseline (`RankedBars`), largest first, the figure printed at each bar's
end. Every chart of a full view has its table under it.

The average and the median are two panels, each on its own scale: a few
large records put the average far above the median, and one scale would
flatten the median's bars. The first and newest values of the amended
records are two panels on one scale, the same measure before and after. The
contracts ending are two charts by fiscal quarter, value and count, since
their units differ. The ten largest records are a table only.

## Phase 3

- Saved views: a view's address, period included, kept as a saved search in
  the account.
- Price benchmarks from comparable awards. `rec_classes` now carries each
  award notice's and history record's UNSPSC classes, so what is left is a
  rule for "comparable" that holds up on the titles.
- The corporate family, left out because the data does not support it. No
  source the pipeline reads says who owns whom. An organization is one
  normalized legal name (`merges.py` joins spellings of one business on a
  shared business number plus a second fact); the business number on grant
  rows names one legal entity, the published contracts and CanadaBuys files
  carry none, and the federal corporations extract names no parent. A family
  drawn from shared name words would join unrelated firms and miss the
  subsidiaries that trade under other names, so it waits for a source that
  states ownership.
