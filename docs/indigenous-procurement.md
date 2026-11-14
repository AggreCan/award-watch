# The Indigenous Procurement Target

What each federal institution reported to Indigenous Services Canada under the
mandatory minimum 5% Indigenous procurement target, as that department
published it, on the institution's buyer page: its plan for the next two
fiscal years, the goods and services where it reported a gap, and the result
of its latest reported year. These are the institutions' own reports. A plan
commits no one to a purchase, a result is shown with the file's own figures,
and nothing here is added to a contract or agreement value anywhere on the
site. The panel is free for every reader.

The code is `pipeline/awardwatch_pipeline/sources/indigenous_target.py` (the
stage, the review file and the export block), the `ipt_files`, `ipt_plans`,
`ipt_gaps` and `ipt_results` tables in `pipeline/schema.sql`, the guarded call
in `export_static.py`, and on the site `site/src/indigenous_target.tsx` (the
reader and the panel). This is the first slice: no list page, no segment
pages, no records or accounts database, no API route of its own (the open
API's `/api/buyers/{id}` passes the buyer file through whole, block included,
as it does the Public Accounts' block). The contract details file is not read
yet.

## The source

Indigenous Services Canada (ISC) on open.canada.ca, Open Government Licence -
Canada (`license_id` `ca-ogl-lgo`, read on each dataset record on 2026-11-13;
the stage reads nothing from a dataset under another licence). Institutions
report two things to ISC each year, and ISC publishes each as a dataset of
its own, under a new id every year and at no fixed date:

| Dataset | Read 2026-11-13 | What the stage reads |
|---|---|---|
| "2025-2026 and 2026-2027 Planned Procurement ... Mandatory Minimum 5% Indigenous Procurement Target", `88bd5306-e0a1-46dd-8e02-909931ade592` (`frequency` as_needed) | planned procurement CSV (503,786 bytes), gaps CSV (54,501 bytes), planning summary CSV, three dictionaries | the planned procurement and the gaps files |
| "Results of the Mandatory Minimum 5% Indigenous Procurement Target for Fiscal Year 2024-2025", `65dfa39f-e699-4698-b8c7-29e1b99d7b23` (`frequency` not_planned) | results CSV (14,208 bytes), contract details CSV (1,622,085 bytes), two dictionaries | the results file |

The earlier datasets are the previous plan (2024-25 and 2025-26,
`440a10df-4f65-47f4-851c-6acf30d37841`) and the results for 2023-24
(`5d27d152-09d8-4303-adc4-0c46b4a9733b`) and 2022-23
(`34b3aa67-dd04-455b-996f-9d9b5032ed39`). The planning summary is not read:
it carries departmental contact names and email addresses, which the site
never holds. The contract details wait for a later slice.

ISC's own notes on the records, which the page and the Methodology repeat:
the planned procurement rows are each institution's top commodity areas with
the amount that "may be allocated" to each and where the goods or services
"may be delivered", estimates from departmental planning that may change, and
no full breakdown of the planned totals; the gaps are the economic objects
where an institution anticipates challenges or limits in buying from
Indigenous businesses; the institutions are responsible for their data, and
the datasets are not revised after publication.

### The files as read

| File | Encoding | Rows | Columns read |
|---|---|---|---|
| planned procurement 2025-26 and 2026-27 | UTF-8, byte-order mark, CRLF | 952 (498 for 2025-26, 454 for 2026-27), 95 institutions | fiscal year, institution and acronym in both languages, economic object code and name in both, category, subcategory and reporting object in both, amount, delivery location in both |
| gaps 2025-26 | UTF-8, byte-order mark, CRLF | 267 (225 naming an object, from 58 institutions; 42 "No Data Provided" rows reading "No Identified Gaps Reported by the Organization" in English and "Aucune information fournie par l'organisation" in French) | fiscal year, institution, economic object code and name in both languages |
| results 2024-25 | UTF-8, byte-order mark, CRLF | 95 (82 "Yes" and 13 "No" under the target) | institution, phase, report received, A, B, C, the percentage, target met in both languages, fiscal year |
| the previous plan's two files | Windows-1252, no byte-order mark | 896 and 197 | the same, with other headers and no fiscal year in the gaps file |

Every layout of 2022-23 to 2025-26 reads (the tests hold each header row as
published). The headers changed every year ("Met 5% Target - EN", "Met 5%
Target", "Meet 5% Target"; "Organization Acroym - FR"), so each column is
found by what its header says (`indigenous_target.COLUMNS`), and a file that
lacks a column the stage needs is refused before a row is written. Amounts
are text ("$1,500,000 ", "$99,999.99 ") and kept in cents; the percentage is
a fraction ("0.0647") and kept as published, never worked out again (the
Northern Pipeline Agency's 0.2639 is not 104 / 393). "No Data Provided"
(alone, or with "Aucune donnée n'a été fournie") in an amount (39 plan rows),
a delivery location (7), a whole plan row (3: one institution and year each)
or a result is kept as not provided, never as zero; a blank is kept as not
stated. Inside a dataset a file is told by its name in the record, never by
its address: the 2025-26 plan and gaps files share one file name.

## The stage

`indigenous_target` runs after `public_accounts` in the nightly, after the
buyers stage has merged buyers and before `families` and `export`. Its own
log row; a fault in its own code fails it and the stages after it run.

- **Finding the datasets.** One catalogue search a night
  (`package_search`, organization `isc-sac`, the phrase "Indigenous
  Procurement Target") lists every dataset with its files; the newest plan
  and the newest results are told by the fiscal years in their English titles
  (`indigenous_target.classify`). The search gives an uploaded file's address
  from the catalogue's root (`/data/dataset/...`); the stage makes it whole.
  When the search does not answer, or lists none of a kind, the known ids
  (`config.IPT_PLAN_DATASETS`, `config.IPT_RESULTS_DATASETS`, newest first)
  are read one at a time (`package_show`); the log row says `(search)` or
  `(fallback)` for each, and a fallback is a notice.
- **Cadence.** The search every night (20 hours). A file is downloaded only
  when the dataset found is new, the record lists a changed address or
  `last_modified`, or the rules changed (`indigenous_target.rules()`); the
  request is conditional on the copy applied (ETag, Last-Modified) and a copy
  with the same SHA-256 is not read again. Most nights make one request.
- **Applying a file** replaces its table whole, records the file in
  `ipt_files` and resolves every institution, in one transaction: a fault
  leaves the rows of the night before.
- **Every night**, whatever the catalogue said, each institution's buyer is
  resolved again (`relink`), so tonight's buyer merges move the rows.
- **Never a failed run** for the network or the files. A search or record
  that does not read, a dataset missing or under another licence, a file the
  record does not list (or two that read as one part), a download that fails,
  a column renamed, no row of the fiscal years the dataset covers, or a copy
  of the same dataset with more than 30 percent fewer rows than the copy
  applied before: the rows applied before stand, the log row carries a notice
  and the stage ends ok. A held copy is applied once the operator writes its
  SHA-256 (12 characters or more, given in the notice) to
  `pipeline/awardwatch_pipeline/data/indigenous_target_release.txt`.
- **A samples run** reads `data/raw/samples/ipt-plan.csv`, `ipt-gaps.csv`
  and `ipt-results.csv` when present and makes no request.

## The tables

| Table | One row per |
|---|---|
| `ipt_files` | part applied (plan, gaps, results): dataset, how it was found, fiscal years, resource, address, the record's names for the file, encoding, ETag, Last-Modified, the record's `last_modified`, SHA-256, rules, rows, when applied |
| `ipt_plans` | row of the planned procurement file: fiscal year, kind (row, or none where the whole row says No Data Provided), institution in both languages, its buyer, the economic object, its category, subcategory and reporting object in both languages, the amount in cents with its state (stated, not provided, blank, text) and as written, the delivery location in both languages with its state |
| `ipt_gaps` | row of the gaps file: fiscal year, kind (gap, or none in the file's own words), institution, its buyer, the economic object in both languages |
| `ipt_results` | row of the results file: fiscal year, institution, its buyer, phase, report received, A, B and C each in cents with its state and as written, the percentage as a fraction with its state and as written, target met in both languages as written |

Nothing goes to the records database or the accounts database in this slice.

## Institutions to buyers

`buyers.resolve` on each institution's English and French names, source
`indigenous_target`, as every stage does. On the 2025-26 files, against the
CKAN organizations the buyers stage loads (353, cached 2026-11-01) and the
seed: 95 institutions, 94 to a federal CKAN buyer, none to a province or a
territory, none to no buyer, and one, the Leaders' Debates Commission, to a
buyer the resolver makes: open.canada.ca has no organization for it (its 353
organizations, read 2026-11-13), so no seed row ties it to one. It is listed
in the review file; with no record it is not a listed buyer and no page
shows its block.

The buyers table holds the provinces and territories too (CKAN lists each as
an organization, "Government of Ontario" as `on`). The files name federal
institutions only, so a name that resolves to a buyer whose English name
starts "Government of" is a wrong match: it is listed in the review file and
gets no block. A part of a buyer that two institutions of the same file
resolve to is left out as well. Economic objects are not UNSPSC segments, and
nothing maps one to the other.

## What the site shows

| Where | What | Reads |
|---|---|---|
| buyer page | "Indigenous Procurement Target", after Records by Year and before the Public Accounts' payments (which stay the last panel): whose reports these are and that none of their figures is added to a total; for each plan year a table of category, economic object, the amount as reported and the delivery location, rows by category, stated amounts largest first, "Not provided" where the file says so, a line where the file gives no data for the year or has no row; the gaps by name, or the file's own words where it reports none; the result as a list (A, B, C, the percentage, Target met, and Report received where the file says it was not); the datasets linked with their fiscal years, ISC's note on revisions, the licence | `indigenous_target` in the buyer file |
| Data page | the source's row (publisher Indigenous Services Canada, linked to the catalogue's list of the target's datasets, since their ids change yearly), the licence's row; each file read under Files Read (the plan's two files of one name told apart by the start of their resource ids) | `stats.json` "sources", rows `indigenous_target` |
| Methodology | "Indigenous Procurement Target" (`#indigenous-target`), the source in the list | |

The block: `{v, objects, plan?, gaps?, result?}`. `objects` maps a key (the
economic object code) to `[English, French, category in English, in French]`.
`plan` is `{ds, fy: [first, second], years: [{fy, n, rows, np?}]}`, a row
`[key, amount, location]`, the amount a number, `"np"` (not provided), the
text as written or null (blank), the location `[English, French or null]`,
`"np"` or null; `np: 1` marks a year the file gives no data for. `gaps` is
`{ds, years: [{fy, n, keys, none}]}`, `none` the file's words for a no-gap
row. `result` is `{ds, fy, a, b, c, pct, met, rcv?}`. At most
`IPT_PLAN_ROWS` (200) rows a year and `IPT_GAP_ROWS` (200) gaps, with `n`
the full count. A block that does not read shows no panel, and a file
without one renders the page byte for byte as before.

## States and bounds

- Before the first night with the stage: no block, no panel, every page as
  before; the Data page lists the source as not read yet.
- On 2025-26 against a copy of the development database: the first night
  reads the three files in about 5 seconds with four requests, and a night
  with nothing new takes about a second with one. Blocks are 2.2 KB at the
  median and 10.3 KB at the largest (National Defence; Fisheries and Oceans
  7.5 KB).

## The console

The stage's row in the run status (and `LAST_RUN.md`) reads `<state>
plan=<fiscal years> (<search|fallback>) results=<fiscal year> (...)
states=<plan,gaps,results> rows=<plan>/<gaps>/<results> institutions=<n>
mapped=<n> made=<n> provincial=<n> unmapped=<n> held=<parts or none>`.
Counts only: no name reaches the log. A fault in the block builder at export
time writes the buyer files without the block and logs
`export_indigenous_target` with a notice.

## Operator steps

1. Nothing to apply by hand: `schema.sql` creates the four tables on the
   next run.
2. After the first night with the stage, and after each new dataset, read
   `data/out/review/indigenous-target.txt` (private, saved to R2's `review/`
   prefix): the files applied, the rows by kind and state, the institutions
   the resolver made a buyer for, those resolved to a province or a territory
   or to none, and the buyers two institutions of one file resolve to. An
   institution that has an open.canada.ca organization gets a row in
   `buyers.csv`.
3. A held copy is released by writing its SHA-256 to
   `indigenous_target_release.txt`.

## Test fixtures

`pipeline/tests/fixtures/indigenous_target_plan.csv`, `_gaps.csv` and
`_results.csv` are the header and the rows of eight institutions of the
2025-26 planned procurement and gaps files and of the 2024-25 results file
named above, bytes as published with the line ends made LF;
`indigenous_target_gaps_2024.csv` is three rows of the previous plan's gaps
file (`626a46d3-5ed0-44f3-98dd-1ac6fb8fae5c` in dataset `440a10df-...`), in
its Windows-1252. All under the Open Government Licence - Canada. The site's
test blocks are the export's own for rows of the same files.
