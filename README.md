# Award Watch

Public records of federal spending in Canada, organized around the organizations
that receive it: open tender notices and the awards that follow, every contract
over $10,000 that a federal department has published, every grant and
contribution agreement, and the lobbying communications those organizations
report. Every row links to the government record it came from. The site
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
```

The data ships as static assets with the Worker; the browser filters the list
pages; a D1 database of its own answers the search field on every page, which
finds an organization by any spelling on its records or its business number,
and a buyer by name or acronym (`docs/hosted-search.md`); another holds only
what visitors submit; object storage holds the downloads.

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

The code is source-available; see `LICENSE.md`.
