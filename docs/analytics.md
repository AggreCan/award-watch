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
| `rec_expiring_prov` | row of `rec_expiring` (its `k`) and province or territory the row names: stated by its source (`derived` 0) or derived from its other fields (`derived` 1, `places.py`); `pk` is the sync's key | a few thousand (about 1,150 of the window's 7,178 rows were placed on 2026-11-06, most in one or two provinces) |
| `rec_contracts` | published contract row: every field its page shows (`/contracts/<department>/<reference>`) | about 1.34 million |
| `rec_gsin` | GSIN code a published contract carries: its names | about 10,000 at most |
| `rec_contract_indigenous` | published contract row (its `rec_contracts` `k`) whose `indigenous_business` names a set-aside under the Procurement Strategy for Indigenous Business (`psib` MS or VS) or whose `indigenous_business_excluding_psib` says yes (`ib` 1); none for a vendor withheld as a person | tens of thousands (143 of the first 5,290 rows of `contracts.csv`) |
| `rec_lines` | row of `rec_expiring` (its `k`) whose holder is named: the holder's record with the buyer as JSON (`j`, the pipeline's `lines.py`), asked for by `sk`, the row's kind and reference in lower case (*Holder's record* in `docs/accounts.md`) | about the window's rows (1,894 of the development copy's 1,906, about 355 bytes each) |
| `rec_events` | thing that happened on a data date of the last 90 to an organization, a buyer, a single record or a tender notice, plus a count row past 100 a subject a day (*Events*) | thousands a night, a few hundred thousand |
| `rec_instruments` | standing offer or supply arrangement the pipeline keeps (`docs/sosa.md`): its fields and its call-ups as JSON | a few thousand |
| `rec_holders` | active holder of one, by region, whose name is shown | about 10,000 |
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
  contracts) or the agreement start (grants). Null without a date. A notice
  or history record whose award date falls after the data date takes its
  publication date instead (`records_db.NOTICE_DAY`): in every such row seen
  the award date is the contract's end date entered in the award-date
  field, so the record counts in the year it appeared, and `rec_details.day`
  and `rec_classes.day` carry the same date.
- `bid`: the buyer, a 40-bit number from the buyer id (`rec_buyers` maps it
  back). For PSPC contract history the buyer is the client department, as on
  the buyer pages. A buyer keeps one number: when the buyers stage merges
  another id into it (`sources/buyers.merge`: a former name such as Revenue
  Canada, a second spelling such as "Department of National Defense", a CKAN
  organization listed twice), the pipeline database moves the retired id's
  records to the surviving id in one transaction, so the next sync finds
  each moved row's hash changed and sends it again under the survivor's
  number, deletes the retired id's `rec_buyers` row, and moves the summary
  rows (`rec_buyer_quarters`, `rec_buyer_years`, `rec_due`) and the record
  tables (`rec_details`, `rec_classes`, `rec_contracts`, `rec_expiring`) the
  same way. Nothing is kept under a retired number, and the survivor's
  figures are the sum of the parts. A retired id's analytics and records
  pages redirect through `buyers/aliases.json`.
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
| A night with buyer merges | the same, plus every record of each retired buyer id in `records` and the record tables, and its summary rows: the first night of the buyer de-duplication (2026-11) moves the former Status of Women Canada's published contracts and grants, three CKAN organizations listed twice, and the made buyers for National Defence and Parks Canada spellings, an estimated 10,000 to 30,000 rows, a few batches; later nights merge only what is new |
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

## The index

`/analytics` lists the views a reader can open, and the rail's Browse group
links it as "Analytics" with the Pro chip in the count's slot
(`site/src/pages/analytics_index.tsx`). It answers only while the accounts
switch is on, as the views do: off, it is the site's 404 and the rail has no
item. On, every reader gets the same page:

| Panel | What it lists | Read from |
|---|---|---|
| Your Organization | for a signed-in account that has named its organization (`docs/accounts.md`, *Your organization*), that organization's view and its page in the account | the accounts database (`org_claims`) and the profile |
| Buyers | every buyer with a record in one of the four money sources, by name in the page's language, with its acronym | `buyers/index.json` |
| Organizations | a line on finding one (by name in the search box, or in the directory; every profile links its view), then the organizations with the largest award notice values of the data year | `stats.json` (`top_organizations_year`) |
| Segments | the 57 UNSPSC segments, in code order | the site's own list of segments |

Each entry links its view with `rel="nofollow"`. A reader whose plan lacks
`analytics` gets one gate note under the head, the only chip in the page's
body: each view's first chart is free for the latest three fiscal years
(`FREE_YEARS`) and Pro shows every chart for up to ten (`MAX_YEARS`), with a
link to `/account/sign-in?next=/account/billing`. A Pro reader gets no note.
Saved views per account do not exist yet; they will be one more panel.

The search box is a GET to the same page (`?q=`):

- an organization id, the address of a profile, a buyer page or a segment
  page, a buyer id the list holds or a two-digit segment code goes straight
  to that view (302);
- otherwise buyers and segments are matched here (every word in a name,
  acronym or code, either language, the last word as a prefix) and
  organizations through the search database's statements (the count and the
  first page, one batch); a query that matches exactly one view goes to it;
- anything else lists the matches by kind, the first 25 organizations with a
  link to `/search` for the rest, and says when nothing matched.

A missing `buyers/index.json` or `stats.json` leaves a plain line in its
panel and the page answers 200; a search database that cannot answer is a
line in the organizations' panel, the matches page is then sent `no-store`,
and nothing goes straight to a view on a match it could not count. The page
never reads the records database. The plain page is a section page for
search engines (its title and description, the sitemap with the data date);
a query is `noindex`, and `robots.txt` disallows `/analytics?` but
`?lang=fr`, since each query reads the search database. The views roll-up
counts it as the route `/analytics`. `site/test/analytics-index.test.ts`
holds all of this.

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
(`stats.json` `sources`), and the records' data date. When the row reports a
set-aside under the Procurement Strategy for Indigenous Business (MS
"Mandatory Set-Aside", VS "Voluntary Set-Aside") or an Indigenous business
outside one ("Indigenous Business excluding PSIB": Y), the page shows it in
the source's terms from `rec_contract_indigenous`, read in the same batch; a
records database without that table (a site deployed before the nightly that
creates it) is read again without it, and the page shows neither.

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
its date, reference, title and the figures the charts count). Newest first,
or by date or value either way (`sort=oldest|newest|smallest|largest`, which
the table's Date and Value heads also set), 50 to a page (`page=`), filtered by
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
March 31 mark `fye=0`, the standing offer mark `sosa=0`) or an order
(`sort=end|end-desc|value-asc|value`, which the table's Ends and Value heads
also set) reads `rec_expiring` instead (`site/src/records_tables.ts`): one batch of the
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
radar never disagree. `rec_expiring_prov` is written beside it from each
row's own `provinces` and `provinces_derived` (`records_db.expiring_province_rows`):
one row per row and province, `derived` 1 for a derived one (a code the row
also states counts as stated), indexed by `rec_expiring_prov_prov (prov, k)`
so a province filter seeks the province's rows and joins `rec_expiring` by
`k`. It is a table of its own because `rec_expiring` keeps its columns: a
column added there reaches D1 only through a full reload. When the records
database is missing, loading or failing, a filtered view filters the window
file's page as before and says so.

`rec_lines` is written beside them from the lines stage's `expiring_lines`
(`records_db.lines_rows`), one row per window row whose holder the stage
counted, keyed as the row is in `rec_expiring` and found by
`rec_lines_sk (sk)`. The window pages and the record pages read it for a
signed-in reader only (`readLines`, `readLine`); a database without it shows
the pages as they were. Like `rec_expiring_prov`, it is a table of its own
that the nightly schema creates, so it needs no full reload, and `LAYOUT`
stays 2.

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

## Events

`rec_events` holds what happened on each data date of the last 90 to an
organization, a buyer, a single record or a tender notice: what the watches
read (`docs/accounts.md`, *Watches*). The sync derives the rows
(`records_db.derive_events`, after `build`, before `stage`) from tonight's
temporary tables, the ledger, the radar's own candidates and the previous
night's state, keeps them in the pipeline's `records_events`, and sends them
to D1 through the ledger as every table is sent: a new table, so no full
reload and no `LAYOUT` change.

The previous night's state is `records_event_state` in the pipeline database:
each award notice and PSPC history record with its versions after the first,
its counted value and its end date; each published contract row with its value
as published and its end date; each tender notice open on the data date. The
events step replaces it whole each night. `lo` below is the previous night's
data date (meta `records_events_at`, at most 7 days back); on the first night
there is none, and no amendment, cancellation, end date or closing is written.

| Kind | Rule |
|---|---|
| `award`, `grant` | a row of `records` (extra = 0) whose key the ledger does not hold, naming an organization or a buyer (`grant` for a grant); none while the ledger holds no records row (a first load); a published contract row joining a known contract is `amended` instead |
| `amended` | an award notice or PSPC history record whose versions after the first, counted value, or end date changed since the state (versions or value up, or the end moved); a published contract row whose value as published rose or whose end date moved; a published contract row new tonight whose department and procurement_id match a row of the state. `ocents` and `cents` are the values before and after, `oendd` and `endd` the end dates when it moved, `namd` the amendment number |
| `cancelled` | the same, when the newest version's status is cancelled: the value before in `ocents`, never a fall to zero |
| `ends_12m`, `ends_6m` | a row of the radar's 12-month window whose end date is after `lo` plus 365 (182) days and on or before the data date plus them, so each end date crosses each line once; `horizon` 365 or 182 |
| `ended` | the radar's own candidates (`expiring.notice_candidates`, `contract_candidates`, `dedupe`: newest end date, not cancelled, each contract once) whose end date is on or after `lo` and before the data date |
| `notice` | a tender notice whose first version was first seen after `lo` (the first night: on the data date), published within 7 days of that, naming a buyer |
| `notice_amended` | a notice first seen earlier with a version first seen after `lo`: `oclosing` and `closing` when the closing moved, the earlier title in `other` when it changed |
| `notice_closed`, `notice_cancelled` | a notice open on the previous night's data date (`normalize.tender_status_on`) and not open tonight; `notice_cancelled` when its status is cancelled |
| `notice_awarded` | an award notice first seen after `lo` whose solicitation is a notice's (compared in upper case): once per notice, the winner in `other` (none when withheld) |
| `instrument_gained`, `instrument_lost` | a row of the sosa stage's `sosa_events` (kind 12, 13; `docs/sosa.md`) younger than 90 days whose key `records_events` does not hold yet: one per organization, instrument and region. The stage compares each weekly file with the last one applied and writes no gain on its first file and no loss before its second, so this step carries its rows over and compares nothing; a row's day there is the file's publication date, which can be earlier than `lo` (a held file released later), so rows are taken by key, not by day |
| `instrument_expires_6m` | an active holder row (resolved to an organization) of an instrument whose expiry is after `lo` plus 182 days and on or before the data date plus 182, so each expiry crosses the line once: one per instrument and organization, its regions together; `horizon` 182. No 365-day line: many instruments run for years |

Subjects: `oid` (the organization), `buyer` (the buyer id; history: the client
department), `sid` (the lowest UNSPSC segment of an award notice, a history
record or a notice), `ref` (what a watch on one record follows:
`award:<reference>`, `history:<reference>` in the URL form in lower case,
`contract:<department>:<reference>`, `grant:<department>:<reference>`,
`tender:<reference>`; `sosa:<agreement number>` for a standing offer or supply
arrangement). An event about a published contract is written once per
row of the contract (50 at most) with that row's `ref`, so a watch on any
version's page sees it; the organization and buyer are on the first only. An
instrument's event names its holder (`oid`) and no buyer or segment; `endd`
is the expiry, `title` and `title_fr` the description, `other` and `other_fr`
the type and the regions' names ("Regional Master Standing Offer · British
Columbia"), `path` the instrument's page; no column was added for it.

At most 100 rows of one kind per organization or buyer per data date, the
largest values first; past that the rows lose that subject (they still serve a
watch on the record itself) and one count row (`ref` `count:<kind>:<subject>`,
`more` the rows past 100) stands for them. The manifest's `events` carries
tonight's count of each kind and how many subjects went past the cap
(`capped`).

Each row's key hashes what it is about rather than (day, kind, ref): a night
derived twice, or a night whose apply failed and whose records are new to the
ledger again, writes nothing new and keeps the day first found. A data date
earlier than the last derived derives nothing. Rows older than 90 data dates
are deleted here and, through the ledger, in D1.

Columns: `day` (the data date first seen, which every line shows), `kind`,
`src` (5 a tender notice), `oid`, `buyer`, `sid`, `ref`, `cents`, `ocents`,
`endd`, `oendd`, `closing`, `oclosing`, `namd`, `title`, `title_fr` (120
characters, contacts scrubbed), `other`, `other_fr`, `horizon`, `more`, `path`
(the page the line links). Indexes: `(oid, day)`, `(buyer, day)`, `(sid, day)`,
each partial, `(ref, day)`, and `(day, kind)` for the console's counts. The
site's statements (`site/src/account/watch_events.ts`) bind 30 day slots and 25
subject slots and seek each pair (a buyer narrowed to a segment binds its
buyer and segment); each ends in a `LIMIT`, and the tests read their plans.
The rows statement joins each `sosa:` row to `rec_instruments` through
`rec_instruments_agr` for the instrument's active holders now, one seek per
row read.

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
