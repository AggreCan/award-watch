# Outbound link sampling

Every record on the site links to the government's own copy of it: the
CanadaBuys notice, the contracts or grants search, the Registry of Lobbyists'
report, the dataset on open.canada.ca. A publisher that moves or withdraws
pages breaks those links without telling anyone. Each night, after the
deploy, the run checks about 40 of them. A changed address scheme (every link
of one kind answering 404) shows the night it happens; a single withdrawn
page shows within weeks.

The code:

| Part | File |
|---|---|
| The draw, the checks, the record, the command `link-sample` | `pipeline/awardwatch_pipeline/link_sample.py` |
| The table `link_checks` | `pipeline/schema.sql` |
| The step "Sample the outbound links" | `.github/workflows/nightly.yml` |
| The status fields and the notice | `run_status` and `read_broken_links` in `pipeline/awardwatch_pipeline/nightly.py` |
| The item needing attention | `link_item` in `pipeline/awardwatch_pipeline/resilience.py` |
| The tests (the network faked) | `pipeline/tests/test_link_sample.py`, and the link sample's tests in `test_nightly.py` and `test_resilience.py` |

Nothing needs setting up. The table comes from the schema's `CREATE TABLE IF
NOT EXISTS` the first time the run opens the database, and the step needs no
secret.

## What is sampled

Six kinds of link, each built the way the site builds it
(`site/src/pages/shared.tsx`, `buyers.tsx`, `data.tsx`):

| Kind | Address | Drawn from |
|---|---|---|
| `tender` | `https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/<reference>`, or the French page on `achatscanada.canada.ca` | `tenders`, one draw per reference whatever its amendments |
| `award` | `https://canadabuys.canada.ca/en/tender-opportunities/award-notice/<reference>`, or the French page | `awards`, the same way |
| `contract` | `https://search.open.canada.ca/contracts/?search_text=<reference>` | `contracts` rows with an organization |
| `grant` | `https://search.open.canada.ca/grants/record/<department>,<reference>,current` (one escaped path segment) | `grants` rows with an organization |
| `lobbying` | `https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/cmmLgPblcVw?comlogId=<number>` | `lobbying_communications` rows with an organization |
| `portal` | `https://open.canada.ca/data/<en or fr>/dataset/<id>` and `.../organization/<name>` | the seven source datasets, and every buyer with an open-data organization name and at least one award, history record, contract or grant |

A notice reference goes into its address in lower case with its colons
removed (`SSC-26-00040563:A:1` is at `.../ssc-26-00040563a1`), as
`noticePath` in `shared.tsx` and `notice_path` in `feeds.py` write it. A
contract history record has no page of its own and links to its dataset,
which the `portal` kind covers. Contracts, grants and lobbying reports
without an organization are left out because no profile shows them.

`test_the_addresses_are_the_ones_the_site_links` compares the fixed part of
every address with the site's source, so a change on one side alone fails
the pipeline tests.

## How the sample is drawn

- 40 links (`SAMPLE_SIZE`), dealt one kind at a time in the order of the
  table above. With every kind full that is 7 tenders, 7 awards, 7 contracts,
  7 grants, 6 lobbying reports and 6 portal pages. A kind with fewer links
  than its share passes the rest to the others.
- Each kind draws with its own random generator, seeded by the data date
  (`data_as_of` in the database's meta table) and the kind's name. The same
  database on the same data date draws the same links in the same order, and
  a kind added later leaves the others' draws as they were.
- A table kind picks a random rowid and takes the first linked row at or
  after it (wrapping round to the start) whose record is not drawn yet, so
  a draw never reads a whole table; the contracts and grants hold over a
  million rows each. A row that follows a gap in the rowids is drawn a
  little more often than the others. Nothing is estimated from the sample,
  so that is left as it is.
- A tender or award notice is checked on the English or the French host,
  chosen at random, since the site links both.

## How a link is checked

- One request at a time, in the dealt order, so the hosts alternate, and at
  least one second between two requests to one host (`config.DEFAULT_DELAY`,
  or the host's entry in `config.CRAWL_DELAY`).
- The pipeline's user agent (`config.USER_AGENT`: the site's address and its
  corrections page), a 10-second timeout, redirects followed.
- HEAD first. When HEAD answers 405 or 501 the server does not take HEAD
  there, so a GET follows; its body is streamed and never read.
- One retry at most, after 5 seconds, and only when no answer came or the
  answer was 429 or 5xx. A Retry-After of up to 30 seconds is waited out; a
  longer one means the link is not asked again that night.
- No check starts after 480 seconds (`BUDGET_S`). The slowest single check
  takes about 70 seconds, so the command writes its results inside the
  step's 10-minute limit; the links left over are counted as not checked.

About 40 requests a night, spread over five hosts.

## What counts as broken

A link is broken when its final answer, after redirects, is 404 or 410. A
403 or 401 (the host refused the runner), a 429 or a 5xx (the host is busy
or failing tonight) and no answer at all are not broken: they say nothing
about whether the page exists. No answer is counted apart in the outcome
line. A page that has gone but answers 200 (a "soft 404") passes the check.

The site keeps its links whatever the answer: a government page may come
back, and the record still names its source.

## What the run writes

| Where | What |
|---|---|
| `link_checks` (the pipeline database) | one row per check: `checked_at` (one value for a night), `data_date`, `kind`, `record_ref`, `url`, `method` (HEAD or GET), `status` (NULL when no answer came), `error` (the exception's name), `elapsed_ms`, `attempts` (1 or 2). Rows older than 60 days (`RETENTION_DAYS`) are deleted when the next night's rows are written. The table travels in the database backup and is never exported. |
| `data/out/links/last_outcome.txt` | `checked N, M broken`, with `, K with no answer` and `, J not checked (time limit)` when there are any. The step writes `failed` before the command starts, so a step stopped by its time limit or a fault reads as failed. |
| `data/out/links/broken.json` | `{data_date, checked_at, checked, broken: [{kind, ref, url, status}]}`; deleted at the start of a run, so a run that stops leaves none. |
| `status.json` | `link_sample` (the outcome line, `failed` or `not run`) and `link_sample_broken` (the broken links, at most 100). |

`record_ref` names the record the link belongs to: a notice's reference,
`<department>:<reference>` for a contract or grant, a communication number,
`dataset:<source>` or `buyer:<buyer id>`.

## Where it shows

- Broken links are one item needing attention, naming up to ten of them
  with their kind, record and status (the rest are in `status.json`). The
  run's last step fails, so GitHub's failed-run email goes out, and the
  run-attention issue lists the item. They are also one notice,
  `link_sample: N of tonight's sampled government links answered 404 or 410;
  the run-attention issue lists the addresses`, which goes to `LAST_RUN.md`
  and is the line in the site's daily check email (`site/src/watchdog.ts`
  prints every notice of the last run). The run's `ok` stays true, so the
  retry schedules do not run the refresh again: a retry would find the same
  pages missing.
- A sample that did not finish (`link_sample: failed`) is the notice
  `the sample of outbound government links did not finish; the next run
  draws another`. It is never an item needing attention and stops nothing.
- The step runs after the deploy and before the database is saved, with
  `continue-on-error` and a 10-minute limit. It runs only when the database
  passed its checks, and only the run status reads its outcome, so it never
  delays or stops publishing.

## What to do with a broken link

1. Open the address in a browser. A single record gone at the source (a
   withdrawn notice, a grant record taken down) needs nothing: the site's
   page still describes the record and names its source.
2. Several links of one kind broken in one night, or the same kind every
   night, mean the publisher changed its address scheme. Find the new form
   on the publisher's site, then change the builder in
   `site/src/pages/shared.tsx` (or `buyers.tsx` and `data.tsx` for the
   open.canada.ca pages), the matching function in `link_sample.py`, the
   Atom feeds' `NOTICE_URL` and `notice_path` in `feeds.py` for the
   CanadaBuys notices, and the expected addresses in
   `test_the_addresses_are_the_ones_the_site_links`.
3. The history is in a restored copy of the database:

   ```sql
   SELECT substr(checked_at, 1, 10) AS night, kind, status, COUNT(*)
   FROM link_checks GROUP BY night, kind, status ORDER BY night DESC, kind;
   ```

## Running it by hand

```
cd pipeline
python -m awardwatch_pipeline link-sample --db ../data/awardwatch.sqlite --out ../data/out/links
python -m awardwatch_pipeline link-sample --db ../data/awardwatch.sqlite --size 5 --data-date 2026-11-04
```

`--data-date` draws a past night's sample again (the default is the
database's data date), `--size` changes the number of links and `--budget`
the seconds after which no check starts. The command makes real requests to
the government hosts and adds its rows to `link_checks`. It always exits 0
once it has written its outcome: a broken link is a fact about the source,
reported in the run status, never a failed step.
