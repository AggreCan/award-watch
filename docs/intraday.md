# Same-day tender notices

CanadaBuys regenerates its new tender notices file,
`newTenderNotice-nouvelAvisAppelOffres.csv`, every two hours through the day.
The nightly run reads it once, at 12:30 UTC. Between two nightly runs, the
workflow `.github/workflows/intraday.yml` reads it again after each cut and
writes the notices it holds to the hosted search database (D1
`awardwatch-search`, binding `SEARCH`). A paid request to `/tenders` or
`/tenders/new` then shows those notices in a band above the list. Free pages
are unchanged. The schedule does work only while a paid plan is live: with
none, each run stops at its gate within seconds (see "Who it runs for").

The code:

| Part | File |
|---|---|
| The workflow | `.github/workflows/intraday.yml` |
| Fetch, parse, resolve, SQL, run row, lookup, prune | `pipeline/awardwatch_pipeline/intraday.py` |
| The row parser shared with the nightly loader | `pipeline/awardwatch_pipeline/sources/canadabuys_rows.py` |
| The D1 tables | `pipeline/intraday_schema.sql` |
| The nightly's two steps | "Save the buyer lookup for the same-day refresh" and "Prune the same-day notices" in `.github/workflows/nightly.yml` |
| The query and the merge | `site/src/intraday.ts` |
| The band | `site/src/pages/intraday.tsx` |
| The plan gate on a request | `site/src/plan.ts` |
| The live paid plans the workflow's gate counts | `LIVE_PRO_SQL` in `site/src/account/entitlements.ts` |
| Where a failure shows | the daily check, `site/src/watchdog.ts` |

## When it runs, and why those minutes

The file's Last-Modified headers (measured 2026-11-02) put the cuts at 06:15,
08:15, and so on to 22:15 Ottawa time. Ottawa is UTC-5 in winter (EST) and
UTC-4 in summer (EDT), so the same cuts fall an hour apart in UTC between the
two halves of the year.

| Cut (Ottawa) | Winter, UTC | Summer, UTC | Run (UTC) | Wait, winter | Wait, summer |
|---|---|---|---|---|---|
| 06:15 | 11:15 | 10:15 | 11:45 | 30 min | 90 min |
| 08:15 | 13:15 | 12:15 | 13:45 | 30 min | 90 min |
| 10:15 | 15:15 | 14:15 | 15:45 | 30 min | 90 min |
| 12:15 | 17:15 | 16:15 | 17:45 | 30 min | 90 min |
| 14:15 | 19:15 | 18:15 | 19:45 | 30 min | 90 min |
| 16:15 | 21:15 | 20:15 | 21:45 | 30 min | 90 min |
| 18:15 | 23:15 | 22:15 | 23:45 | 30 min | 90 min |
| 20:15 | 01:15 | 00:15 | 01:45 | 30 min | 90 min |
| 22:15 | 03:15 | 02:15 | 03:45 | 30 min | 90 min |

The schedules are `45 11-23/2 * * *` and `45 1-3/2 * * *`: 45 minutes past
every odd hour from 11:45 to 03:45 UTC. One schedule serves both halves of
the year, so nothing changes at the clock changes. The 03:45 run reads the
day's last cut (22:15 Ottawa) in winter and in summer. The runs go on at
weekends: the host still regenerates the file, and a run whose file has not
changed costs one short request and about a minute of runner time.

Only the new notices file is read. The open notices file (every open notice,
with its amendments and closing changes) comes once a day, at about 06:20
Ottawa time, and stays the nightly's.

The workflow has a concurrency group of its own (`intraday`), so it never
waits for the nightly and two of its runs never overlap. It can also be
started by hand from the Actions tab (Run workflow).

## Who it runs for

The band is for the paid plan alone, so the refresh runs only while at least
one pro entitlement is live in the accounts database (D1
`awardwatch-accounts`, binding `ACCOUNTS`). Each run's second step, "Check for
a live paid plan" (right after the check that the Cloudflare secrets exist),
counts them before the checkout and the installs, with one `curl` request to
the D1 REST API:

```
POST https://api.cloudflare.com/client/v4/accounts/<account id>/d1/database/<accounts database id>/query
{"sql": "SELECT COUNT(*) AS n FROM entitlements WHERE plan = 'pro' AND revoked_at IS NULL AND starts_at <= ?1 AND (ends_at IS NULL OR ends_at > ?1)",
 "params": ["<the current UTC instant, 2026-11-03T13:45:00.123Z>"]}
```

The statement is `LIVE_PRO_SQL` in `site/src/account/entitlements.ts`: the
window rule of `planFromRows` (not revoked, started, not ended), counted over
the pro rows. The workflow carries the same text, and
`pipeline/tests/test_intraday.py` holds the two equal; change the rule and
both change. The count does not apply the "newest row wins" half of
`planFromRows`, so a user whose newest live row is free but who still holds
an older live pro row is counted, and the refresh then runs for a user the
site serves as free. The database is named by its id (the
`ACCOUNTS` binding's `database_id` in `site/wrangler.jsonc`), in the job's
`ACCOUNTS_DATABASE_ID`. The token is the nightly's `CLOUDFLARE_API_TOKEN`,
whose D1 permission covers every database on the account.

| The count | What the run does |
|---|---|
| above 0 | the refresh, as below |
| 0 | one line ("No paid plan is live; no refresh this run."), then ends green with no run row |
| not read (an HTTP error, an answer that is not a count) | one line naming the HTTP status, then ends green with no run row |

The count is never printed: the repository and its run logs are public. A
run for nobody costs the first two steps, a few seconds. A count that cannot
be read is not a red run either: while a plan is live, the daily check names
a refresh that has stopped going through (see "What a failure does").

To run the refresh whatever the count (a test, or the first run after a
schema change), start it by hand with the input set: Actions, intraday, Run
workflow, tick "Run the refresh even when no paid plan is live", or from a
shell:

```
gh workflow run intraday.yml -f force=true
```

## What a run does

0. Counts the live paid plans and stops, green and with no run row, when
   there are none (see "Who it runs for").
1. Reads, from D1, the file validators (ETag and Last-Modified) of the newest
   run that went through, and the versions `intraday_tenders` holds
   (`intraday.STATE_SQL`, one statement).
2. Fetches the file with a conditional request carrying those validators,
   with the pipeline's named user agent. A 304 (unchanged) skips to step 6.
3. Fetches the buyer lookup from R2 (`intraday/lookup.json.gz`). When R2 has
   none yet, or cannot be read after three tries, the run goes on and every
   buyer keeps its name as published.
4. Parses the file with the nightly loader's own column map and normalizers,
   resolves each contracting entity through the lookup, and writes the SQL
   batch (`intraday refresh`).
5. Applies the batch with `wrangler d1 execute awardwatch-search --remote`.
6. Records the run row in `intraday_runs` (`intraday record`).

The job restores no database and writes nothing else: no `status.json`, no
commit, no deploy, no R2 upload.

The file is cumulative over the day, so each changed cut lists the day's
earlier notices again. Each version is an upsert keyed by reference and
amendment: a batch applied twice leaves the same rows. `seen_at` keeps the
time a version was first read; every other field takes the file's newest
value. A notice whose newest version in the file is no longer open
(cancelled, awarded, expired) is deleted with all its versions.

### What the file holds

The live file read on 2026-11-02 at 04:07 UTC (the 22:15 Ottawa cut of
Sunday 2026-11-01) had the same 67 columns as the 2026-10-31 layout the
nightly loader reads, and one row, at amendment 0. The 2026-10-30 file kept
in the test fixtures has 25 rows, three of them at amendment 1 or 2: notices
published and amended the same day, listed once at their newest amendment,
with no amendment 0 row. The nightly's database holds those three at the
same amendments only. So the file can carry amendments, of notices published
that day. A notice the nightly took in at amendment 0 in the morning and that
is amended later in the day shows in the band as "amended today".

## The buyer lookup

The intraday job has no database, so it cannot run the buyers stage. The
nightly leaves it a lookup instead, gzipped JSON at
`awardwatch-data/intraday/lookup.json.gz`:

| Key | Holds | Rule of `buyers.resolve` |
|---|---|---|
| `spellings` | every CanadaBuys spelling in `buyer_names` and its buyer | 1, a spelling already resolved |
| `titles` | the CKAN and seed spellings, folded as SQLite's NOCASE folds them, with their buyers | 2, a title |
| `acronyms_en`, `acronyms_fr` | each acronym key and the buyers carrying it | 3, an acronym |
| `keys` | the key index's CKAN and seed tier (normalized titles, former names, aliases, multi-word acronyms) | 4, a key of a form of the spelling |
| `made` | the key index's tier of buyers made from earlier spellings | 6, a buyer already made |
| `buyers` | the listed buyers' English and French names (`buyers/index.json`) | the only ids the site links |
| `as_of` | the data date of the export it was written with | |

`BuyerLookup` in `intraday.py` applies the rules in the same order with the
same normalization (`name_key`, `spelling_forms`, `split_acronym`, the
acronym key, `non_institution`). It never makes a buyer: where the nightly
would make one, it resolves to none. A notice whose buyer resolves to a
listed buyer gets that buyer's id and names. Any other keeps its spelling as
published with no id, unless the spelling names or locates a person
(`buyers.public_spelling`), and the next nightly reconciles it.
`pipeline/tests/test_intraday.py` holds the lookup to `buyers.resolve` on a
list of spellings covering every rule, and holds a refresh row to the open
list's row for the same notice.

The nightly writes the lookup (step "Save the buyer lookup for the same-day
refresh") only after a deploy that worked and that the live check did not
find broken, so the buyers it links have pages on the live site. When the
step fails, R2 keeps the last good lookup, and the run status says
`intraday_lookup: failed` with a notice.

### Its size, and the bound

Every refresh downloads the lookup from R2 and parses it whole, so its size
is the cost of each cut. Measured 2026-11-03 00:35 UTC, after the 2026-11-02
nightly: `intraday/lookup.json.gz` is 58,773 bytes gzipped. That needs no
slimming.

Once the file is in R2, the nightly's step prints its size ("buyer lookup
saved to R2: <n> bytes") and the run status records it as
`intraday_lookup_bytes`, an integer beside `intraday_lookup` (null on a night
that saved none; `intraday_lookup` itself is unchanged). The site's daily
check names a lookup over 2,000,000 bytes (`LOOKUP_MAX_BYTES` in
`site/src/watchdog.ts`). Past that bound the lookup would keep only the
spellings seen on a notice, award or contract in the last 24 months, the
resolver's order unchanged, and `test_intraday.py` would still hold it to
`buyers.resolve` on the probe spellings.

## The tables, and applying the schema

`pipeline/intraday_schema.sql` creates two tables in `awardwatch-search`:

- `intraday_tenders`: one row per version read (reference, amendment), with
  the open list's fields (titles, buyer, dates, category, notice type,
  method, segments, provinces, codes, excerpts) and `seen_at`. List columns
  hold JSON text. Indexed on `seen_at`.
- `intraday_runs`: one row per run: `id` (GitHub run id and attempt), `at`,
  `file_last_modified`, `file_etag`, `rows_read`, `rows_new`,
  `rows_updated` (versions read again), `ok`, `detail`.

The schema is applied by hand, once, before the first scheduled run. From
the `site` folder, where `wrangler.jsonc` names the database:

```
cd site
npx wrangler d1 execute awardwatch-search --remote --file ../pipeline/intraday_schema.sql
npx wrangler d1 execute awardwatch-search --remote --command "SELECT name FROM sqlite_master WHERE name LIKE 'intraday%'"
```

The second command lists the two tables and their two indexes. Every
statement is `IF NOT EXISTS`, so applying the file again changes nothing. A
later change to a table is applied the same way; the tables hold two days of
rows, so dropping and recreating one costs only those days.

The search sync never names these tables. Its full reload drops its own two
tables and their full-text indexes and nothing else
(`test_the_search_sync_never_names_the_intraday_tables`).

## Pruning

The nightly's step "Prune the same-day notices" deletes the versions first
read more than two days before the run, and the run rows older than 30 days
(`intraday prune`). The site shows only the versions first read since the
data date, so a prune that fails changes no page: the run status says
`intraday_prune: failed` with a notice, and the next night prunes.

## Checking a run

The Actions tab shows each run. A run the gate stopped (no live paid plan)
shows its first two steps and nothing else, and leaves no row. Every other
run that could reach D1 leaves a row:

```
cd site
npx wrangler d1 execute awardwatch-search --remote --command "SELECT id, at, ok, rows_read, rows_new, rows_updated, detail FROM intraday_runs ORDER BY at DESC LIMIT 14"
npx wrangler d1 execute awardwatch-search --remote --command "SELECT COUNT(*) AS n, MIN(seen_at) AS first, MAX(seen_at) AS last FROM intraday_tenders"
```

The `detail` column reads one of:

- `unchanged since the last run (304)`: the file had not changed.
- `<n> rows read: <n> new, <n> read again, <n> no longer open, <n> without a reference; <n> with a buyer as published (no listed buyer); lookup <date>`:
  the file was read and applied. "lookup missing, buyers as published" or
  "lookup unreadable, buyers as published" in place of the date means the
  run had no lookup.
- `failed at <step>; the next run fetches the file again`: a step failed
  (`ok` is 0).
- `the new notices file could not be fetched`: the host answered with an
  error the client's retries did not clear (`ok` is 0).

## What a failure does

A failed cut is a row, not a red run. The fetch, the lookup, the parse and
the apply carry `continue-on-error`, so when one fails the run goes on to
"Record the run", which writes a row with `ok` 0 and the step that failed,
and the run ends green: GitHub sends no email for it. The steps that need the
failed step's output are skipped (after a failed fetch, the lookup, the parse
and the apply; after a failed parse, the apply, which also checks the parse's
own outcome, so a missing or partial batch is never applied).

"Read the last run from the search database" carries `continue-on-error` as
well. When it fails (the search database is down, or its binding is wrong),
the run ends green with no row: the fetch runs only after a state read that
worked, the lookup, the parse and the apply skip with the fetch, and the
record needs the read too, since a run that cannot read D1 cannot write its
row there either. Such a run shows its state step failed in the Actions tab
("no such table" there means the schema has not been applied), and the
daily check names it while a paid plan is live (no refresh gone through for
4 hours, or the runs could not be read).

The run goes red only when it cannot run at all, and then it leaves no row:

- the Cloudflare secrets are missing;
- the checkout or an install failed;
- "Record the run" could not write the row.

The next run sends the validators of the last run that went through, so it
downloads the file again and writes every row of the day; the file is
cumulative, so the notices of a failed cut arrive with the next one. A notice
the job never wrote comes with the next nightly, as it did before this job
existed.

The site's daily check (the Worker's cron at 06:00 UTC, `site/src/watchdog.ts`,
2 h 15 after the day's last cut) is where a failure shows. It reads
`intraday_runs` with one prepared statement on the `SEARCH` binding (the
newest run that went through, and over the 24 hours before the check the
runs, those with `ok` 0, and the new versions the others wrote) and the count
of live paid plans with `LIVE_PRO_SQL` on the `ACCOUNTS` binding. Its message
can carry these items:

| Item | When |
|---|---|
| "No same-day refresh has gone through since <time> UTC, more than 4 hours before this check, while a paid plan is live. Check the intraday workflow's runs." | a paid plan is live and the newest run that went through is more than 4 hours old (the 03:45 run did not) |
| "No same-day refresh has gone through while a paid plan is live: the search database holds no run that did. Check the intraday workflow's runs." | a paid plan is live and `intraday_runs` holds no run that went through |
| "<n> of <m> same-day refreshes failed since yesterday; the <k> that went through wrote <r> new notice versions. A later run writes the day's notices again; intraday_runs.detail names the step that failed." | any run in the last 24 hours has `ok` 0, plan or no plan |
| "The same-day refresh runs could not be read from the search database (<code, phrase>)." | the read failed; the fault by its code only, never a thrown check. An answer that does not read, or no `SEARCH` binding, gives the same opening with that reason instead; this item then replaces the three above |
| "The buyer lookup for the same-day refresh is <n> bytes, over the 2,000,000-byte bound; ..." | `intraday_lookup_bytes` in the run status is over 2,000,000 |

A count of paid plans that cannot be read (or no `ACCOUNTS` binding) counts
as no plan: the 4-hour item is left out, never reported as a fault, since the
accounts may be switched off. The run status's two nightly steps come in the
message's notices, one line each, when they read `failed`
(`intraday_lookup: ...`, `intraday_prune: ...`), as the nightly words them.
A day with nothing to say leaves the message exactly as it was.

A failed run never touches the nightly: it writes nothing to `status.json`,
opens no issue and changes no deploy, and the nightly's attention issue
leaves the intraday job alone.

## What the free and paid views show

The plan gate on a request is `requestPlan` in `site/src/plan.ts`: the
accounts module's `planOfRequest`, which answers "free" without reading
anything while `ACCOUNTS_ENABLED` is off or the request has no session, and
`allowed(plan, "intraday")`, which carries the feature for the paid plan
only.

- **Free**: the pages as before. A free request makes no D1 call and reads
  no file for the band, and its page is byte for byte the page without the
  feature (`site/test/intraday.test.ts`).
- **Paid**: a band above the list on `/tenders`, and on `/tenders/new` for
  the newest day, headed "n notices posted since this morning's refresh"
  ("n avis publiés depuis la mise à jour de ce matin"). It lists the notices
  first read since the data date that the nightly's list does not hold
  (chip "same day", "le jour même") and the notices it holds at a lower
  amendment (chip "amended today", "modifié aujourd'hui"), newest first, in
  the tender list's columns. A notice the nightly already holds at the same
  or a higher amendment is left out. The title opens the notice on
  CanadaBuys, since the site has no page for it until the next nightly. A
  buyer the lookup did not match shows its name as published, without a
  link. Nothing is added to the home page, the feeds or search.

The band sets the D1 rows against the nightly's notices first seen on its
data date (`tenders/new/<date>.json`) and its first open notices
(`tenders/open-first.json`); the full open list stays the browser's. When D1
is missing or fails, a paid request gets the free page with no error; the
log names the fault by its code only.
