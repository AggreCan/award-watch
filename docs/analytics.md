# Analytics

The analytics views chart one buyer, one organization or one UNSPSC segment
over federal fiscal years, from a D1 database of the records themselves. They
are part of Pro (feature `analytics`). A free reader sees the first chart of
each view for the latest three fiscal years and a short note naming what the
rest of the view holds. This is phase 1: three views, their tables and a CSV
file of each table. Saved views, chosen periods and the other analyses listed
at the end are later phases.

The code is `pipeline/awardwatch_pipeline/records_db.py` (the rows and the
sync), `pipeline/records_schema.sql` (the schema), the step "Sync the records
database" in `.github/workflows/nightly.yml`, and on the site
`site/src/records_db.ts` (the queries) and `site/src/pages/analytics.tsx` (the
pages and the CSV files).

## The database

D1 `awardwatch-records`, binding `RECORDS` in `site/wrangler.jsonc`. It is a
database of its own: a full reload here touches neither the forms, the search
database nor the accounts. Written only by the nightly sync; the site only
reads it, with prepared statements.

| Table | One row per | Rows (estimate) |
|---|---|---|
| `records` | counted record of the four money sources, plus one row for each further segment a notice's codes reach | about 2.8 million |
| `rec_orgs` | organization named on a record: its number and display name | about 350,000 |
| `rec_buyers` | buyer named on a record: its number, id and names | about 1,000 |
| `rec_buyer_quarters` | buyer, source, fiscal year and quarter: count, value, count without a value | about 50,000 at most |
| `rec_segment_years` | segment, source and fiscal year: count, value, buyers, organizations | about 2,000 |
| `rec_meta` | key: `state` (`loading` or `ready`), `as_of` (the data date the rows describe), `rules` | 3 |

A row of `records` is one record as the profiles count it (*Counting money*
on the Methodology page): an award notice or a PSPC history contract by its
reference (the newest amendment), a published contract row, a grant or
contribution agreement by department and reference (the highest amendment).
Its columns are all small integers or short codes, so the table stays near
100 bytes a row with its indexes:

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

Grants whose recipient reads as a person (`recipient_withheld`) are not in the
database at all. A contract whose supplier reads as a person is in it with no
organization, the way the export keeps it, and counts in its buyer's figures.

Indexes: `records (bid, src, fy)`, `records (oid, src, fy)` and
`records (sid, src, fy)`, each partial (`WHERE ... IS NOT NULL`), so the
published contracts and grants, which carry no segment, cost no segment
index entry; `rec_buyers (id)`; `rec_buyer_quarters (bid, src, fy)`;
`rec_segment_years (sid, src, fy)`. Every statement the site sends names one
of them (`site/test/analytics.test.ts` reads each query plan).

## The nightly sync

Modelled on the search sync (`docs/hosted-search.md`), with three changes for
a table a hundred times larger.

1. `records-sync` builds tonight's rows into temporary tables of the
   pipeline database, hashes each row, and compares the hashes with the
   ledger (`records_ledger` in `schema.sql`: table, key and hash of every row
   D1 holds). The differences go to `records_staged`, not to the manifest,
   since a first load would make a manifest of a hundred megabytes. It writes
   the batches (at most 5 MB or 5,000 statements a file, 100 rows an upsert,
   500 keys a delete, no statement above 64 KiB), `batches.txt`, `finish.sql`
   and `manifest.json` under `data/out/records/`, and `failed` to
   `last_outcome.txt` before it starts.
2. Wrangler applies `records_schema.sql` (every statement `IF NOT EXISTS`)
   and each batch in order, then reads the five row counts back;
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
load that is about 3 million small rows.

A full reload drops the five tables, applies the schema, sets `state` to
`loading`, and sends every row. The pages answer "being loaded" until
`finish.sql` sets it back, so no reader sees half a load. The sync makes one
by itself on an empty ledger and after a count read back disagreed, but not
within 28 days of the last one (a full load writes about ten million rows,
a fifth of the plan's monthly allowance).

When `site/wrangler.jsonc` still holds the placeholder database id, the step
sends nothing and writes `no database`, a notice in the run status rather
than an item needing attention. `failed` is an item needing attention
("Records database sync: failed (sent again next run)"); the run goes on and
the views answer from what D1 holds.

What it costs, estimated from the sources' sizes on 2026-11-01 (1.34 million
published contracts, 1.07 million grant rows, the CanadaBuys notices and
history):

| | Estimate |
|---|---|
| A first load or full reload | about 290 MB of SQL in about 60 batches; about 3.2 million rows and 9 million index entries written |
| A night | the records whose figures, organization, buyer or flag changed: thousands to tens of thousands of rows, one or two batches |
| The count check | one count of each table, about 3.2 million rows read a night |
| Database size | about 400 MB |
| The ledger in the pipeline database | about 3.2 million rows, about 70 MB |

## The views

| View | Address | Charts, each with its table |
|---|---|---|
| Buyer | `/buyers/<id>/analytics` | value by fiscal quarter; value by segment (notices and history); the non-competitive share by fiscal year, by count and by value; the ten organizations with the largest values and the share the largest one, five and ten hold |
| Organization | `/organizations/<id>/analytics` | value by fiscal year; the ten buyers with the largest values; the ten segments with the largest values (notices and history); its share of one segment's value by fiscal year beside up to five other organizations chosen from that segment's 25 largest |
| Segment | `/segments/<nn>/analytics` | buyers and organizations with a record, by fiscal year; the ten buyers and the ten organizations with the largest values; the organizations new to the segment in the latest fiscal year |

Each view reads one source at a time (`?source=awards`, `history`,
`contracts` or `grants`; a segment view `awards` or `history`), because no
figure ever adds two sources. The default is the source with the most
records on the entity's own page (award notices on a tie, and on a segment
view). `?years=3`, `5` or `10` sets the period:
that many fiscal years ending with the one the data date falls in, which is
partial and marked so. The organization view takes `?segment=<nn>` and up to
five `?vs=org-...` for its share chart; without a segment it uses the
organization's largest, and without a choice it compares the segment's five
largest others. Only organizations among the segment's 25 largest in the
period are shown beside it. Anything else in the address is ignored, never an
error: a value outside these lists reads as the default. Ids are checked as
the entity pages check them, and an entity with no page is the site's 404.

The CSV of a table is `<view address>/<table>.csv` with the same query
(`quarters`, `segments`, `competition`, `suppliers`; `years`, `buyers`,
`segments`, `share`; `years`, `buyers`, `winners`, `entrants`). Pro only:
any other request gets the site's 404. The files are downloads for the
per-address limit (ten a minute) and are sent `private, no-store`.

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

## Free readers and the switch

While `ACCOUNTS_ENABLED` is not `"true"`, every analytics address is the
site's 404 and no page links to one: there is no Pro to show.

With the switch on, nothing is hidden. The buyer, organization and segment
pages link their view with the word Pro marked (`pro-tag`). A request whose
plan lacks `analytics` gets the view's head, its source tabs, the first chart
for the latest three fiscal years with no table, and for every other chart
its title and one line of what it shows, marked Pro (`pro-note`), with a link
to `/account/billing` (signed out: `/account/sign-in`). That page reads D1
once: one batch of the state row and the first chart's statement, which reads
a summary table (buyers, segments: at most 12 rows) or the organization's own
records of three fiscal years through its index. The look of the Pro mark is
the two classes in `public/styles.css`, in both colour modes.

The pages are `noindex` and `robots.txt` keeps crawlers off them, so a crawl
of the profiles never turns into D1 reads.

## When the database is missing

No `RECORDS` binding, a database without the tables, `state` other than
`ready`, or a failed statement: the view answers "Analytics are not available
right now" with status 503, `Cache-Control: no-store` and a link back to the
entity page; a CSV answers the same status. A failure is logged as a D1 code
and a fixed phrase. Nothing else on the site reads the records database.

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

## Later phases

- Saved views (a view's address as a saved search) and periods chosen by
  start and end year.
- Amendment growth, recompetes due by quarter, average and median values,
  price benchmarks from comparable awards, the corporate family.
- Record tables with filters and export on profiles and buyer pages (the
  records backbone's own item), which need the reference and title columns
  and so one full reload.
- The daily check's email naming a failed records sync (today the run's
  attention issue carries it).
- The radar's deeper windows and the same-day notices converted to the
  `pro-tag` and `pro-note` pattern, once the Pro mark is settled.
