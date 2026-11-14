# Payments in the Public Accounts

What each federal department reported paying each payee for professional and
special services in a fiscal year, as the Public Accounts of Canada publish
it, on the payee's profile and on the department's buyer page. These are
payments, the site's one source of amounts paid. Every other source is a
contract or agreement value, and a payment is never added to one: not in a
tile, a total, a year table, a chart, a ranking, a CSV, the analytics, the
radar, a feed or a sentence. The pages are free for every reader.

The code is `pipeline/awardwatch_pipeline/sources/public_accounts.py` (the
stage, the review file and the two export blocks), the `pa_files` and
`pa_payments` tables in `pipeline/schema.sql`, the two guarded calls in
`export_static.py`, and on the site `site/src/public_accounts.tsx` (the
readers and the two panels). This is the first slice: the professional and
special services file for 2025-26. The works file, a list page with the
records database, the earlier years and the contractual obligations come in
later slices; nothing here shuts them out.

## The source

PSPC's "Detailed information on Professional and Special Services, as per
the Public Accounts of Canada", open.canada.ca dataset
`ac597ff8-ee13-48c3-b315-42e528090af2`, Open Government Licence - Canada,
yearly (`P1Y`). One CSV a fiscal year; the file named 2026
(`https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/idsps-dipss/idsps-dipss-2026.csv`,
2,698,024 bytes, published 2026-11-06) holds fiscal 2025-26. Each record
says it "is not the official record of information"; the official version is
the Public Accounts of Canada on the Receiver General's site. The stage finds
the file through the dataset record's resources (`package_show`), never by
building the address: the language split of the files moved twice since 2003.

The 2026 layout (`split2026`) has 20 columns: the fiscal year
(`Fscl-yr_Ex-fin`, "2025/2026"), the ministry code and portfolio, the
department's number and name in both languages, the class of service's code
and name in both languages, the payee (`Contractor-details_Details-entrepr_eng`
and `_fra`), its city, province (or state abroad) and country (blank in
Canada) in both languages, the current-year column and the aggregate column.
A file without one of them is refused before a row is written; a column the
stage does not know is named in a notice and the file is read. The files are
UTF-8 with a byte-order mark and CRLF line ends. The portfolio columns are
never read (the works file of 2026 has them swapped).

Each department and class is a block:

| Row | How it is told | Amount |
|---|---|---|
| header | no payee | the class total as published, in the current-year column |
| named | a payee | the aggregate column |
| under | "Service payment(s) under $100,000 (N)", "(N payees)", or with no count | the aggregate column; N kept when written |
| withheld | the publisher's "Name withheld", or a person (below) | the aggregate column; no name or place kept |

On 2025-26: 9,169 rows, 1,087 blocks (every one adding up to its header),
1,087 header rows, 1,054 under rows and 7,028 rows naming a payee.

## The stage

`public_accounts` runs after `sosa` in the nightly: after the organizations
stage, so tonight's merges are known, and before `families`, `indicators`
and `export`. Its own log row; a fault in its own code fails it and the
stages after it run.

- **Cadence.** The dataset record (one request) is read every night from
  September to January, when every release so far has landed, and weekly
  otherwise. The newest year's file is downloaded only when the record lists
  a newer year, a changed address or a changed `last_modified`, or when the
  rules changed (`public_accounts.rules()`). The download is conditional on
  the copy applied (ETag, Last-Modified); a 304 or a copy with the same
  SHA-256 reads nothing again. Most nights make one request and read nothing;
  outside the season most make none.
- **Every night**, whatever the record said: the departments' buyers, the
  federal test and the links are computed again from the stored names
  (`relink`), and only the rows that changed are written.
- **Applying a file** deletes the fiscal year's rows and writes the file's,
  records the file in `pa_files` and links every row, in one transaction: a
  fault leaves the rows of the night before.
- **Never a failed run** for the network or the file. A record that does not
  read, a download refused or timed out, a layout the stage does not know, a
  copy whose named rows fall by more than 30 percent from the copy of the same
  year applied before, or more than 2 percent of its class blocks not adding
  up: the rows applied before stand, the log row carries a notice and the
  stage ends ok, so no same-day retry starts. A refused or held copy is not
  downloaded again while the record lists it; the operator releases a held
  copy by writing its SHA-256 (12 characters or more, given in the notice) to
  `pipeline/awardwatch_pipeline/data/public_accounts_release.txt`.
- **Rules.** `rules()` joins the stage's version, the name rules
  (`NORMALIZE_VERSION`), the person test (`matching.person_test_stamp`) and a
  digest of the hand-kept hashes. A file applied under other rules is read
  again from its address on the next night, since a withheld row keeps no name
  to test again.
- **A samples run** reads `data/raw/samples/pa-services.csv` and makes no
  request.

## The tables

| Table | One row per |
|---|---|
| `pa_files` | file applied: family, fiscal year, language, resource id, address, layout, ETag, Last-Modified, the record's `last_modified`, SHA-256, rules, rows, when applied |
| `pa_payments` | row of a file (fiscal year, row number): kind, department number and names, its buyer, class code and names, the payee as written in English (and in French when it differs), the normalized name, city, province, country (both languages), province code, cents, the under rows' count, a federal payee's buyer, the organization, the place flag, and why (the person rule; for an unlinked payee common, key or none) |

`pa_payments.organization_id` refers to `organizations` with `ON DELETE SET
NULL`: a merge that removes an organization clears the link, and the relink
the same night sends the payments to the organization that took the records.
Nothing goes to the records database or the accounts database in this slice.

## The rules

1. **Persons.** A row is withheld before anything is written when the
   publisher wrote "Name withheld"; when `matching.is_person_name` reads its
   legal part (`matching.filed_name`) as a person, as on every source; or by
   three rules of this stage only, so no other source moves: a courtesy title
   ("(Dr)", "(MD)", a leading "Dr"), a professional corporation whose name
   without its form ("Professional Corporation", "Prof. Corp.", "Dental
   Corporation", "Medical Corporation", "Notary Public Inc", "PC" and the
   like) reads as a person or starts with a title, and one or two capitalized
   words followed by one or two capitals that are not a legal form, a
   province or a state ("<Surname> <II>"). Every rule reads the English and
   the French name, as written and without the place after it; the last reads
   the English only. A name whose hash is in
   `pipeline/awardwatch_pipeline/data/public_accounts_withhold.txt`
   (`public_accounts.withhold_key`, never a name) is withheld too. A withheld
   row keeps its department, class and amount, so the class totals stay as
   published; every name and place column is NULL. The first names withheld
   are listed in `data/out/review/public-accounts-persons.txt`, which no step
   publishes. On 2025-26: 370 rows (6 by the publisher, 262 by the site's
   test, 65 by a title, 36 practitioners' corporations, 1 surname and
   initials).
2. **Federal payees.** The name, without its brackets, inverted ("Health
   (Department of) (HC)" read as "Department of Health") and without a place
   after it, each keyed by `buyers.name_key`, equal to the key of a
   department name of these files or of a buyer title (`buyer_names` sources
   ckan, seed and alias). No shortening, no acronym rule. Such a row names a
   buyer and never an organization; the department's page counts it apart. On
   2025-26: 954 rows, 139 spellings. The titles of a provincial or
   territorial government are left out (`other_governments`: a buyer whose
   English name begins "Government of", Canada's aside): open.canada.ca
   lists the provinces and territories among its organizations, so each is
   a buyer, and a payment to one is a payment to a named payee. The first
   production night (2026-11-14) had set the Government of Ontario, of Yukon
   and nine more apart as federal: 13 of the first 300 rows of that list.
3. **The place in a name.** Some 2026 payees still carry their place
   ("<Firm> LLP, Ottawa, Ontario"). A trailing comma part is cut, before the
   name is normalized, while it is a province or state, the row's own city or
   country, or a city the file's city column holds; the first part always
   stays, and a name without a comma is never cut ("Innovate BC"). On
   2025-26: 69 names.
4. **The link.** The id `organizations.upsert` would give the legal part,
   sent on through `organization_aliases`, kept only when that organization
   exists. A payee that names no organization gets no profile and is listed
   on the department's page under its own name. A name of one word, or of
   generic words only (`matching.is_common_name`), links only when the
   payee's province is among the organization's addresses. A link whose
   province (or country abroad) is not among the organization's addresses
   keeps the link and carries `pf = 1`, which the row shows. A match key
   (`match_key.match_key`) naming an organization is listed for review and
   never linked.
5. **Departments.** Each department's English and French names go through
   `buyers.resolve` with source `public_accounts`, as every stage's
   spellings do. Eight names no title or rule ties to the right buyer have
   rows in `buyers.csv` (the Royal Canadian Mounted Police External Review
   Committee resolved to the RCMP before its row).

On 2025-26, against the development copy (6,928 organizations, a floor):
5,704 organization payee rows (3,675 spellings), 2,020 rows linked (763
spellings, 669 organizations), 3,684 not (124 a common name in another
province, 37 a match key candidate), 68 rows flagged.

## What the site shows

| Where | What | Reads |
|---|---|---|
| profile | "Payments Reported in the Public Accounts", after the record panels and before the interest panel: what the rows are, that they are amounts paid never added to a contract value, that the match is by the payee's name; per fiscal year a heading with the year's sum and its departments, and a table of department (the buyer's own name, linked to its page), class of service, payee as written with its place, and the amount; a row whose province is not among the profile's addresses says so; the source, the dataset, the line that the copy is not the official record, the licence. One line under the tiles says the payments are not in their totals | `public_accounts` in the profile shard |
| buyer page | "Payments for Professional and Special Services", the last panel: per class of service the total as published, the payees listed, the payees under $100,000 and the federal institutions (count and amount); the persons withheld as a count, never an amount; the federal note; the 50 largest payees named, each linked to its profile when one holds it | `public_accounts` in the buyer file |
| Data page | the source's row, the licence's row, the line that the files are not the official record; each file read under Files Read | `stats.json` "sources", rows `pa_services` |
| Methodology | "Payments in the Public Accounts" (`#public-accounts`), the counting rule, the source in the list | |

The profile block: `{v, services: [{fy, n, total, d, rows}], buyers, classes,
loaded}`, the newest `PA_FREE_YEARS` (3) fiscal years, at most
`PA_PROFILE_ROWS` (100) rows a year, largest first; a row is `[department
key, class, dollars, payee, payee in French or null, city, city in French or
null, place, flag]`, the department key a listed buyer's id or `pa:` and the
department's number. The buyer block: `{v, fy, classes: [{cls, en, fr, total,
named, under, federal, withheld}], payees, named_rows, years}`, at most
`PA_BUYER_PAYEES` (50) payees. A block that does not read shows no panel, and
a file without one renders the page byte for byte as before. Both blocks ride
in files the pages read already: no request, no statement. The open API
returns them with the profile and the buyer.

The free window is the analytics' (`FREE_YEARS`, 3; Pro 10). With one year
held, nothing is gated yet.

## States and bounds

- Before the first night with the stage: no block, no panel, every page as
  before; the Data page lists the source as not read yet.
- A file refused or held: the rows of the copy applied before stand, and the
  run status carries the notice.
- On 2025-26 the file reads in about 2 seconds and the nightly relink takes
  under a second on the development copy. Profile blocks are 0.4 KB at the
  median and 6 KB at the largest there; buyer blocks 2 KB at the median and 7
  KB at the largest.

## The console

The stage's row in the run status (and `LAST_RUN.md`) reads `<state>
fy=<newest fiscal year> files=<n> rows=<n> named=<n> linked=<n> unlinked=<n>
withheld=<n> federal=<n> flagged=<n> held=<fy, layout or none>`, the figures
of the newest year; the state is read, unchanged, not due, not read, refused,
held or no sample. Counts only: no name reaches the log. A fault in a block
builder at export time writes the files without the block and logs
`export_public_accounts` with a notice.

## Operator steps

1. Nothing to apply by hand: `schema.sql` creates `pa_files` and
   `pa_payments` on the next run.
2. After the first night with the stage, and after each autumn release, read
   `data/out/review/public-accounts.txt` (private, saved to R2's `review/`
   prefix): the files, the counts by rule, the federal payees by the strict
   test and the general resolver's further readings (a misspelled department
   gets a row in `buyer_aliases.csv`), the flagged links, the common names
   left unlinked, the match key candidates, departments with no buyer and
   blocks that do not add up. `public-accounts-persons.txt` lists the first
   names withheld.
3. A name the rules missed is withheld by adding its hash
   (`public_accounts.withhold_key` of its normalized name) to
   `public_accounts_withhold.txt`; the files are read again the next night.
4. A held copy is released by writing its SHA-256 to
   `public_accounts_release.txt`.
