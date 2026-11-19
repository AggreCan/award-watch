# Site-only deploy

`.github/workflows/deploy-site.yml` deploys a change to the site's code or
pages (a wording fix, a layout fix, a page bug) in a few minutes, without
running the nightly refresh. It ships the Worker from `main` together with
the data the site already serves, and it is built so that it cannot write,
delete or change that data. The data here means the R2 bucket
`awardwatch-data` (backups, the static bundle `static.tar.gz.parts` and its
parts, `downloads/`, `review/`, `views/`, `status.json`), the D1 databases
`award-watch` (the forms) and `awardwatch-search` (the hosted search
database, which only the nightly sync writes; `docs/hosted-search.md`), and
the data files the Worker serves as assets (`site/public/data`).

## What it is for

Changes under `site/` that work with the data already live: page text,
layout, styles, scripts, and bugs in a page or in the API.

Anything that touches the exported data or the pipeline goes out with the
nightly run, which rebuilds the data and then deploys `main`. A site change
that needs a new data field, or a file the export does not write yet, waits
for that refresh: put it on `main` with the pipeline change and the next
night ships both. Worker secrets and the forms database's schema are set by
hand and are never part of a deploy.

The next nightly run deploys `main` anyway, once `main` passes its tests
(*The tests before every deploy*). This workflow only ships a site change
sooner.

## The tests before every deploy

Nothing ships without passing its tests, in either workflow.

- **This workflow** runs the site's three checks right after `npm ci`, each
  a step of its own in `site/`: `npm run typecheck`, `npm test` (the Worker
  suite) and `npm run test:mail` (the mail suite). They run before the
  bundle is downloaded, so the suites never see `site/public/data`. A check
  that fails stops the run there: no version is recorded, nothing is
  deployed or rolled back, and the summary's Tests row names the check that
  failed and its Deploy row says the deploy was not run because of it. On
  GitHub's runner the three take about four minutes.
- **The nightly** runs the same three and the pipeline suite in a job of its
  own, `tests`, before the refresh. When all four pass, the night runs
  `main`. When one fails, the night runs the commit the live Worker version
  was deployed from, which passed its tests when it was deployed: the
  pipeline, the export and the Worker all from that one commit, so the data
  and the code that reads it match. The run's items needing attention (the
  `run-attention` issue and the failed-workflow email) say which checks
  failed on `main`, at which commit, and which commit the night ran. When
  that commit is `main`'s own (a deploy of `main` that went out before a test
  began to fail by the clock), the night runs `main` all the same. When the
  live commit is not known, or the repository no longer has it, the refresh
  does not run and the run fails: the site keeps the data it has, and the
  retries at 16:30 and 20:30 UTC try again. Fix `main` (or revert the
  change) and dispatch this workflow or `nightly.yml`.

Every deploy names its commit on the Worker version it makes: the version's
tag is the commit's first 12 characters and its message is `commit <the
full commit>`, both read with `git rev-parse HEAD` from the tree the deploy
uploads. The nightly's `tests` job reads them back. To read them yourself,
from `site/` with a token in the environment:

```
npx wrangler deployments status --json
npx wrangler versions view <version id> --json
```

The first names the version carrying the traffic; the second shows its
annotations, `workers/tag` and `workers/message`. The dashboard shows both
on the version (Workers & Pages, `award-watch`, Deployments). A version
deployed before the deploys named their commit has neither, so until one
deploy has gone out with the tag, a night whose tests fail on `main` has no
commit to fall back to and does not run. Dispatch this workflow once after
the change that brought the tags lands, so the live version names its
commit.

## The five steps

1. The run starts by hand only, from `main` (the Actions tab or the REST
   API, see *How to start it*). There is no schedule and no push trigger.
   It shares the nightly's concurrency group, `nightly`: while a refresh
   runs, the site deploy waits, and a refresh that starts during a site
   deploy waits for it.
2. It checks out `main` and installs the pipeline (for its helper commands)
   and the site's pinned Wrangler (`npm ci` in `site/`), then runs the site's
   typecheck, Worker suite and mail suite. A check that fails stops the run
   before anything is downloaded (*The tests before every deploy*).
3. It downloads the static bundle from R2, reads only. The nightly saves
   the archive `static.tar.gz` in parts of at most 250 MiB (Wrangler refuses
   a single upload above 300 MiB): `static.tar.gz.000`, `static.tar.gz.001`
   and so on, then the manifest `static.tar.gz.parts` with each part's
   SHA-256. The workflow downloads the manifest and each part it names (only
   names of the form `static.tar.gz.NNN`), and `python -m
   awardwatch_pipeline.nightly join` puts the archive back together,
   stopping the run when a part is missing or does not match its hash. The
   nightly saves the bundle only after a deploy that passed its live check,
   so it should hold the data the site serves. `python -m
   awardwatch_pipeline.nightly site-bundle-check` proves it: it fetches
   `/data/stats.json` and `/data/tenders/open.json` from the live site and
   compares each with the archive's copy as parsed JSON. stats.json lists
   the newest runs with their times, so an archive from any other night
   fails. Only when both match is the archive copied to `site/public/data`.
4. It records the Worker version serving traffic (`wrangler deployments
   status`), compares the two files once more (now from
   `site/public/data`) and keeps the live stats.json byte for byte, then
   runs `wrangler deploy` from `site/`, with the commit as the version's tag
   and message. After the deploy it runs the
   nightly's smoke test (home, open tenders, data and one profile) and the
   bundle check again: the two files from the live site, and the archive's
   stats.json against the copy kept before the deploy. The run rolls the
   Worker back to the recorded version when the deploy failed, when the
   smoke test found the Worker answering 500 to 599, or when any comparison
   failed.
5. It writes nothing: no R2 upload or removal, no D1 command, no commit, no
   `LAST_RUN.md`, no `status.json`. The nightly's gate and its state never
   see this run. The run's summary page lists the reason given, the commit,
   the files compared before and after the deploy, the version live before
   and after, the smoke verdict and any rollback.

## Three measures that keep it away from the data

### Primary: a token that cannot write data

Every Cloudflare call in the workflow uses its own secret,
`CLOUDFLARE_SITE_DEPLOY_TOKEN`, never the nightly's token. That token has no
R2 write and no D1 write permission (see *The deploy token*), so even a
mistaken command in the workflow is refused by Cloudflare. The first step
fails at once, before anything is installed, when the secret is empty; there
is no fallback to another token. The token is handed only to the steps that
call Wrangler, so `npm ci` and the pipeline install never see it.
`CLOUDFLARE_ACCOUNT_ID` is the secret the nightly already uses. The third
secret it reads, `MAIL_TEST_TO`, is optional and is not a credential: the
live mail check's test inbox (`docs/mail.md`), passed to the Worker at the
deploy, kept as a secret only so the address is masked in the public run log.

### Secondary: no write command in the workflow

The workflow runs these Cloudflare commands and no others, all with the
site's pinned Wrangler:

| Command | What it does |
|---|---|
| `wrangler r2 object get --remote awardwatch-data/static.tar.gz.parts` | reads the bundle's manifest |
| `wrangler r2 object get --remote awardwatch-data/static.tar.gz.NNN` | reads each part the manifest lists |
| `wrangler deployments status --json` | reads the version serving traffic, before the deploy and at the end |
| `wrangler deploy --tag <commit, 12 characters> --message "commit <commit>"` | uploads the Worker and its assets from `site/`, naming the commit |
| `wrangler rollback <recorded version> --yes` | puts the recorded version back on all traffic |

The pipeline commands are `live-version`, `smoke`, `site-bundle-check` and
`join` from `awardwatch_pipeline.nightly`. They read files and fetch public
pages; `join` also writes the joined archive on the runner. The npm commands
are `npm ci` and the three checks; the one git command is `git rev-parse
HEAD`, which reads the commit the deploy names.

`pipeline/tests/test_site_deploy.py` reads the workflow file and fails when:
the trigger is anything but `workflow_dispatch`; `permissions` is anything
but `contents: read`; the concurrency group is not `nightly` in both
workflows; a line runs `r2 object put`, `r2 object delete`, `r2 bucket`, a
`d1` command, the pipeline's main command line, a nightly command that
writes state (`pack`, `status`, `attention`, `gate` and the others), `git`
other than `git rev-parse HEAD`, an npm script other than the three checks,
`curl`, `npx` or the Cloudflare API directly; a check is missing, allowed to
fail, put behind a condition, or moved after the bundle download or the
deploy; a Wrangler call is anything but
the five forms above through the pinned binary; a part name reaches a key or
a path without being checked against `static.tar.gz.NNN`; any secret other
than the three above is read; `CLOUDFLARE_API_TOKEN` (the variable Wrangler
reads) is set from anything but the site deploy token; or the deploy's
arguments carry anything but the landing page's Brandfetch client id, read
from the repository variable `BRANDFETCH_CLIENT_ID` and passed as
`--var BRANDFETCH_CLIENT_ID:<id>` only while the variable is set
(`docs/landing.md`), and the live mail check's test inbox, read from the
repository secret `MAIL_TEST_TO` and passed as `--var MAIL_TEST_TO:<address>`
only while the secret is set (`docs/mail.md`), and the commit as the
version's tag and message; the nightly's deploy passes all three the same
way. It also plants each
of those changes in a copy of the file and checks that the guard catches it.
The checks are textual: PyYAML is not a dependency of the pipeline.

The bundle check (`resilience.bundle_check`) exits non-zero on any
difference, a file missing from the archive, an answer other than 200 or a
body that is not JSON, naming the file. Before the deploy that stops the
run; after it, it triggers the rollback.

### Tertiary: checks after the deploy and an automatic rollback

After the deploy the run checks the live site twice over (the smoke test and
the bundle check) and rolls back on a failed deploy, server errors or any
difference. The version recorded before the deploy carries the same data,
so a rollback costs nothing but the change itself, and it never touches D1
or R2. A version that cannot be recorded stops the run before the deploy,
so there is always a way back. The run fails, and GitHub sends its
failed-workflow email, whenever anything was not confirmed, including a
smoke verdict of `unverifiable`, which (as in the nightly) is not a reason
to roll back.

## The deploy token

1. Cloudflare dashboard, signed in as the project account: My Profile, API
   Tokens, Create Token, Custom token.
2. Name `site deploy`. Permissions:

   | Type | Permission | Access | Needed for |
   |---|---|---|---|
   | Account | Workers Scripts | Edit | the deploy, the version reads and the rollback |
   | Account | Workers R2 Storage | Read | reading the static bundle's manifest and parts; the Worker's R2 binding |
   | Account | D1 | Read | the Worker's two D1 bindings |
   | Account | Account Settings | Read | Wrangler's account lookups |
   | User | User Details | Read | Wrangler's user lookups |
   | Zone | Workers Routes | Edit | the two custom domains in `site/wrangler.jsonc`, sent with every deploy |

   Account resources: the project account only. Zone resources: the
   `awardwatch.ca` zone only. No IP filtering (the GitHub runners' addresses
   change). No end date: the monthly expiry checks of the nightly run do not
   read this token, so nothing would warn before it lapsed.
3. GitHub, the repository, Settings, Secrets and variables, Actions, New
   repository secret: name `CLOUDFLARE_SITE_DEPLOY_TOKEN`, the token as the
   value.

The list is the best reading of what Wrangler needs for a deploy with
assets, R2 and D1 bindings and custom domains, plus an R2 object read. The
first run proves it. If a step stops on a permission or authentication
error, add the read permission Cloudflare names. Never add a write
permission beyond the two in the table, and never Workers R2 Storage Edit or
D1 Edit: without them the token cannot change the data. The token's summary page
in the dashboard lists every permission it holds.

## How to start it

From the Actions tab: Actions, deploy-site, Run workflow, branch `main`,
an optional reason, Run workflow.

Through the GitHub REST API, with a token that has Actions read and write
on the repository:

```
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/OWNER/REPO/actions/workflows/deploy-site.yml/dispatches \
  -d '{"ref": "main", "inputs": {"reason": "fix the tenders page heading"}}'
```

GitHub answers with a 2xx status and the run appears on the Actions tab. A run started
from any branch but `main` stops at its first step.

GitHub keeps one waiting run per concurrency group: a run queued while
another is waiting replaces the waiting one. So start one site deploy at a
time, and avoid the minutes around 12:30, 16:30 and 20:30 UTC, when the
Worker starts the nightly; GitHub's own schedules for the same slots can
come at any time after them (*What starts the runs*). A site deploy replaced
this way changed nothing; start it again. A nightly start replaced this way
is made up by the slot's other start or by the next slot (the 16:30 and
20:30 slots run whenever the day's run did not finish clean).

## What starts the runs

The nightly (`nightly.yml`) and the same-day job (`intraday.yml`) are
started by the Worker's own cron through GitHub's API, and by GitHub's own
schedules at the same times as the fallback. GitHub starts a scheduled
workflow when it can: from about 2026-11-17 it started this repository's
runs hours late or not at all (the nightly at 20:49 and 20:53 UTC in place
of about 13:30), while Cloudflare's cron fired the Worker's schedules on
time every day.

| Cron (`site/wrangler.jsonc`) | Constant | What the Worker does |
|---|---|---|
| `0 6 * * *` | `WATCHDOG_CRON` | the daily check (`site/src/watchdog.ts`) |
| `0 15-20 * * *` | `DELIVERY_CRON` | the deliveries (`site/src/account/deliveries.ts`) |
| `30 12,16,20 * * *` | `NIGHTLY_CRON` | starts `nightly.yml` on `main`, input `gate` = `"true"` |
| `45 1,3,11,13,15,17,19,21,23 * * *` | `SAME_DAY_CRON` | starts `intraday.yml` on `main`, no input |

`site/src/index.tsx` routes each expression exactly; one it does not know
runs nothing. A start is one request from `site/src/dispatch.ts`,
`POST https://api.github.com/repos/<WORKFLOW_REPO>/actions/workflows/<file>/dispatches`
with `{"ref":"main"}` (and the nightly's input), given up after 10 seconds.
It is called from the Worker's `scheduled` handler alone: no request to the
site can start a run. The repository is the variable `WORKFLOW_REPO` in
`site/wrangler.jsonc`; the workflow is one of two names in the code. Each
start writes one line to the Worker's log, such as
`dispatch: nightly.yml started (HTTP 204)`, `refused (HTTP 401)` or the
fault's kind, and never the token; after a refusal or a fault GitHub's own
schedule starts the run. GitHub has
answered 204; its current reference describes 200 with the new run's id, and
the Worker takes either.

Cloudflare's documentation (Workers, Cron Triggers, and the Workers limits
page) gives five-field expressions with `,`, `-` and `/` in every field, UTC
times, at most 5 cron triggers an account on the Free plan and 1,000 on the
Paid plan (this Worker holds 4), and up to 15 minutes for a changed trigger
to reach every location, during which a slot can be missed: avoid a deploy
that changes `triggers` in the quarter hour before a slot.

### The token

`WORKFLOW_RUN` is a Worker secret: a fine-grained GitHub personal access
token for this one repository with one repository permission, Actions:
read and write, and nothing else. Set it from `site/` (Wrangler asks for the
value; it never goes in a file, a variable or a workflow):

```
npx wrangler secret put WORKFLOW_RUN
```

To replace it (refused, revoked, or near its end): GitHub, Settings,
Developer settings, Personal access tokens, Fine-grained tokens, Generate new
token, with this repository alone and Actions read and write; run the command
above with the new value, then delete the old token on GitHub. A deploy
keeps the secret. Without it nothing is sent and the runs start on GitHub's
schedule alone. The permission lets the token start any workflow of the
repository; the Worker's code names only the two.

The daily check reads `nightly.yml` once a morning with the token
(`GET .../actions/workflows/nightly.yml`, the same headers):

| What it finds | The email |
|---|---|
| 401 or 403 | an item that begins "GitHub refused the token that starts the nightly and the same-day job (WORKFLOW_RUN, HTTP <code>); until it is replaced the runs start on GitHub's own schedule, which can be hours late." |
| the answer's `github-authentication-token-expiration` 14 days away or less | an item naming the day the token expires |
| no secret, or no `WORKFLOW_REPO` | a note at the foot of an email that goes anyway: the runs start on GitHub's schedule alone |
| GitHub not reached, or another status | a line in the Worker's log, nothing in the email |

A read that answers proves the token is valid and current, not that it may
still start runs: any token reads a public repository's workflow. A refused
start shows in the Worker's log, and the next morning as a late night: the
check names a nightly whose last refresh started more than 3 hours after its
day's 12:30 UTC slot (from a run status written before the start was
recorded, one that finished after 17:00 UTC).

### The gate

Each nightly slot is often started twice, by the Worker and by GitHub's
schedule, and a late or stray schedule can come at any hour. The nightly's
`gate` job asks every schedule of GitHub's and every start whose `gate`
input is `"true"` the same questions, with the runner's clock:

- before 12:00 UTC: no run. Nothing is due before the 12:30 slot, so the
  trigger is a late one from the day before.
- `status.json` shows a run that started at or after 12:00 UTC today
  (`run_started`; a status from before that field, by its end, `run_at`),
  with `ok` true and the deploy step's outcome `success`: no run.
- anything else, a status that cannot be read and a gate that fails
  included: the refresh runs.

A run started by hand from the Actions tab leaves `gate` at `"false"` and
always runs. It does not count as the day's run when it starts before
12:00 UTC, so the 12:30 slot still reads the morning's files. The same-day
job needs no gate: its concurrency group runs the two starts of a slot one
after the other, and the second gets 304 from the host.

## What a failed run means

A failed site deploy never leaves the data changed, and a rollback leaves
the previous version, with the same data, live. The nightly is unaffected:
it reads nothing this run writes. Remember that the change is still on
`main`, and the next nightly deploys it if it passes its tests; fix or
revert it there first.

| Where it stopped | What it means | What to do |
|---|---|---|
| Check the deploy token and the branch | The secret is missing, or the run was started from another branch | Add the secret (above), or start it from `main` |
| Typecheck, The Worker suite or The mail suite | `main` fails that check. Nothing was downloaded or deployed | Read the step's log, fix `main`, then start a new run. The nightly runs the live commit until `main` passes |
| Download the static bundle from R2 | `static.tar.gz.parts` is not in R2, a part it lists is missing or does not match its hash, or R2 refused the token | A permission error: add Workers R2 Storage Read. A missing or damaged bundle: wait for a nightly run |
| Unpack the bundle and check it | The archive is not what the site serves: the last nightly deployed but its save to R2 failed, or something was deployed since | Nothing was deployed. Wait for the next nightly run, which deploys `main` with fresh data |
| Record the live Worker version | Wrangler could not read the deployments | Nothing was deployed. Check the token's Workers Scripts permission |
| Check again and keep the live stats.json | The site's data changed between the two checks | Nothing was deployed. Start it again |
| Deploy the Worker | Wrangler failed three times. The run rolls back in case a try went part of the way | Read the deploy log; a permission error names the permission to add |
| Check the live site (broken) or the data check after the deploy | The new version answered with server errors or served other data. It was rolled back | Fix the change on `main`, then start a new run |
| Check the live site (unverifiable) | The pages answered, but not as expected (an edge refusal, a page without the data date). No rollback | Open the pages the step names. If the site is wrong, roll back by hand |
| Roll the Worker back | The rollback failed, so the new version may still be live | Roll back by hand to the version in the summary |

To roll back by hand: the dashboard (Workers & Pages, `award-watch`,
Deployments, the version listed as live before, Rollback), or
`npx wrangler rollback <version id>` from `site/` with the token in the
environment.

## The forms database

The forms database (`award-watch`) takes its schema by hand, never from a
deploy. A column added to one of its tables in `pipeline/schema.sql` reaches
an existing database only through a statement the operator runs once, from
`site/` with a token that can edit D1. Neither statement below is
idempotent: a second run only answers "duplicate column name".

The wrong merge reports (2026-11-07) added two columns to `corrections`:
`kind` (`correction` or `merge`) and `name` (the name a reader says does not
belong on the profile).

```
cd site
npx wrangler d1 execute award-watch --remote --command "ALTER TABLE corrections ADD COLUMN kind TEXT NOT NULL DEFAULT 'correction'"
npx wrangler d1 execute award-watch --remote --command "ALTER TABLE corrections ADD COLUMN name TEXT"
```

Until both have run, the site still keeps a report: it is stored as a plain
correction whose text starts `[merge] ` and the name, and the operator
console lists every row as a correction. Rows stored that way stay as they
are after the columns are added.
