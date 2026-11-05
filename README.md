# Award Watch

Public records of federal spending in Canada, organized around the organizations
that receive it: open tender notices and the awards that follow, every contract
over $10,000 that a federal department has published, every grant and
contribution agreement, and the lobbying communications those organizations
report. Every row links to the government record it came from, and the
nightly run checks a sample of those links (`docs/link-sampling.md`). The site
rebuilds itself once a day from the open data files; the scheduled run is the
only way its data changes.

## Layout
```
pipeline/   Python: download, load, match, compute, export (owns data/awardwatch.sqlite)
site/       Cloudflare Worker: pages + JSON API over the pipeline's static JSON
pipeline/schema.sql   the one schema both halves use
brand/      the mark and the lockup
data/       raw downloads and outputs (git-ignored)
.github/workflows/nightly.yml   the one scheduled run that refreshes data and deploys
.github/workflows/intraday.yml  the day's new tender notices, read every two hours while a paid plan is live (docs/intraday.md)
```

The data ships as static assets with the Worker; the browser filters the list
pages; a D1 database of its own answers the search field on every page, which
finds an organization by any spelling on its records or its business number,
and a buyer by name or acronym (`docs/hosted-search.md`), and holds the day's
new tender notices between two nightly runs for the paid view
(`docs/intraday.md`); another holds the records themselves, reduced to
figures, for the analytics views of buyers, organizations and segments
(`docs/analytics.md`); another holds only what visitors submit; object
storage holds the downloads.

Accounts (sign-in by an emailed code, saved searches, API keys) are built but
not yet open; the switch `ACCOUNTS_ENABLED` keeps them off (`docs/accounts.md`).

## Quick start
```
cd pipeline && pip install -e .[dev] && pytest
python -m awardwatch_pipeline run --db ../data/awardwatch.sqlite

cd ../site && npm install && npm run data:local && npm run dev
```

## Sources and licences
CanadaBuys tender notices, award notices and contract history (Public Services
and Procurement Canada), the proactive publication of contracts and of grants
and contributions (Treasury Board of Canada Secretariat, consolidated on
open.canada.ca), the Registry of Lobbyists' monthly communication reports
(Office of the Commissioner of Lobbying) and the federal corporations extract
(Corporations Canada) are all published under the Open Government Licence,
Canada. The Data page on the site lists each file, its publisher and the date
it was last read.

The Registry of Lobbyists' host has refused this project's requests since
2026-10-31. While it does, the lobbying stage reads the registry's export from
a copy the operator downloaded by hand and keeps in R2, or from the Internet
Archive's newest capture of the same file when that capture holds a newer
export. Only captures the archive already holds are read; the pipeline never
asks the archive to fetch the registry. The registry's Open Data Licence
Agreement permits this reuse. The run's notices name the copy read and the
start of its SHA-256. The stage still asks the registry's host first every
week, and the live file takes over the first time the host answers.

The code is source-available; see `LICENSE.md`.
