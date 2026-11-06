# Standing offers and supply arrangements

Every federal standing offer and supply arrangement that Public Services and
Procurement Canada lists as active, with its holders, their regions and the
expiry, joined to the organizations' profiles and to the call-ups the
published contracts record against each instrument. The pages are free for
every reader; the two CSV files are part of Pro (`export_filtered`) once the
accounts switch is on.

The code is `pipeline/awardwatch_pipeline/sources/sosa.py` (the stage),
`pipeline/awardwatch_pipeline/sosa_export.py` (the static files and the
records rows), the `sosa_*` tables in `pipeline/schema.sql`,
`rec_instruments` and `rec_holders` in `pipeline/records_schema.sql`, and on
the site `site/src/instruments.ts` (the loaders and statements) and
`site/src/pages/instruments.tsx` (the pages and panels).

## The source

The weekly CSV `https://sosa.canadabuys.canada.ca/cds/opendata/tpsgc-pwgsc_ocama-sosa.csv`,
open.canada.ca dataset `f5c8a5a0-354d-455a-99ab-8276aa38032e`, Open
Government Licence - Canada, described by its data dictionary
(`https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/ocama-sosa-dd.xml`). On
2026-10-30 the file was 3,995,642 bytes. One row is one supplier on one
instrument at one delivery point. The columns read are the dictionary's:
`agreement-number`, `agreement-type_en` and `_fr`, `award-date`,
`commodity` (a GSIN) and `commodity-description_en` and `_fr`,
`date-file-published`, `delivery-point_en`, `_fr` and `delivery-point-code`,
`end-user-entity_en` and `_fr`, `expiry-date`, `sosa-description_en` and
`_fr`, `supplier-legal-name`, `supplier-operating-name` and
`supplier-standardized-name`. A file without the agreement number, the type,
the dates, the delivery point code or the legal name is refused before
anything is written.

The file lists active instruments only, so the history is what the tables
keep of each week's file.

## The stage

`sosa` runs in the nightly after the organizations stage (so after the
CanadaBuys sources, and after tonight's merges, which the holders' links
need). It asks for the file every night with a conditional request, through
the machinery the contracts and grants stages use (`contracts.refresh`, with
no stand-in copy), and applies a file only when its `date-file-published`
differs from the one last applied; most nights change nothing. Whatever the
file did, the nightly upkeep runs: the holders' organizations are resolved
again, the instruments whose expiry passed lose their holders, the notices
are joined again, and the call-ups are counted again.

The host sends its certificate without the intermediate that issued it.
Windows clients fill the gap from their own store; the pipeline's client does
not, so the read fails the certificate check until the operator places that
intermediate's PEM at `pipeline/awardwatch_pipeline/data/sosa_intermediate.pem`.
The stage then trusts it for this one host (`PoliteClient.trust_intermediate`),
with verification and the host name check still on.

| Table | One row per |
|---|---|
| `sosa_instruments` | agreement number: type, descriptions, GSIN, end user (and its buyer id when a source has named it so), start, expiry, the stem, the inherited segments, the RFSO notice, active holders and persons withheld, first and last file, how many files moved the expiry |
| `sosa_holders` | supplier, instrument and delivery point: the names, the resolved organization, first and last file, files missing in a row, when and why it was marked lost |
| `sosa_callups` | instrument and holder organization ('' for any other vendor): published contract rows naming the instrument over ten fiscal years, their counted value, rows without one |
| `sosa_events` | gain (kind 12) or loss (kind 13) of an instrument in a region by an organization |

## The rules

- A holder row is keyed by the agreement number, the normalized legal name
  (`normalize.norm_name`) and the delivery point code (`CA-BC` read as
  `BC`; `FD` foreign, `NA` national, `NC` national capital). A profile counts
  agreement numbers, not rows.
- A legal name that reads as a person (`matching.is_person_name`, the rule
  of the award notices) is withheld everywhere: no name is stored, the key
  carries a hash of the normalized name so the row is the same row next
  week, the operating and standardized names are dropped, and the row is
  counted. The first names are listed for the operator in
  `data/out/review/sosa-persons.txt`, which no step publishes.
- The organization is resolved, never created: the id the name would give
  under `organizations.upsert`, sent on through `organization_aliases` when
  a merge retired it, kept only when that organization exists. A holder whose
  name names no profile is shown unlinked.
- Gained: a row first seen in a file after the first file applied. The first
  file writes no gained events, and lost events start after the second.
- Lost: a row absent from two files in a row (one absence is not a loss), or
  whose instrument's expiry has passed. A lost row is kept 90 days, marked,
  then deleted; an instrument left with no row goes with it. A row that
  comes back into a later file is held again, with no new event.
- Segments. The file carries a GSIN, not UNSPSC. An instrument inherits the
  segments of the award and tender notices whose solicitation or contract
  number has the agreement number's stem (the part before the first `/`,
  spaces and case folded; at least six letters or digits). The newest tender
  notice of the stem is the instrument's RFSO or RFSA notice. An instrument
  no notice shares its stem with has no segment and is listed under "no
  segment" with its GSIN. A GSIN-to-UNSPSC crosswalk, if PSPC still publishes
  one under the OGL, would give those instruments a segment from their
  commodity and would let a segment carry instruments whose RFSO predates the
  notices the pipeline holds; it is not used.
- Call-ups. A published contract whose `standing_offer_number`, spaces and
  case folded, equals the agreement number is a call-up against it. They are
  counted per holder organization over ten fiscal years, valued by the
  counting rules (`organizations.CONTRACT_CHECKED`); a vendor that is not a
  resolved holder (another firm, a person withheld, a name with no profile)
  counts under the instrument alone. Departments fill that field
  inconsistently, and the page says so.
- A file whose holder rows fall by more than 30 percent from the last file
  applied is held: nothing is applied or marked lost, the run status carries
  `held=<date>`, and the copy is read again each night. The operator releases
  it by writing its publication date to
  `pipeline/awardwatch_pipeline/data/sosa_release.txt`.
- A change to the name rules or the person test (`KEYS_VERSION`) applies the
  next file quietly: named rows move to their new keys, and no event is
  written for that file.

## The events

`sosa_events` holds one row per organization, instrument and region for kind
12 (gained) and kind 13 (no longer held, `why` absent or expired), with
`ref` `sosa:<agreement>`, the organization and the expiry. They are in the
pipeline database because the records database has no `rec_events` table
yet; the watch build (pro-features section 1) moves them there. A holder with
no organization gets no event, since no watch can name it. Rows older than
400 days are deleted.

## What the site shows

| Address | What | Reads |
|---|---|---|
| `/instruments` | every active instrument, filtered by type, region, segment (or none), commodity, end user and expiry within 3, 6 or 12 months; sorted by expiry or holders; 100 a page; the lead names the source, its weekly cadence and the file's date | `instruments/index.json` |
| `/instruments/rows.csv` | the view as CSV, at most 10,000 rows (Pro) | the same file |
| `/instruments/<agreement>` | type, descriptions in both languages, GSIN, end user, start, expiry and days left, the RFSO notice, the inherited segments; the holders (linked to the profile, regions, first seen, call-ups and their value), persons withheld as a count, the call-ups of other vendors; the source cited | `rec_instruments`, `rec_holders` |
| `/instruments/<agreement>/holders.csv` | the holders as CSV (Pro) | the same |
| profile | "Holds N active standing offers or supply arrangements" in the head, and a section of every instrument held (soonest expiry first) and the ones no longer held within 90 days | `instruments` in the profile shard |
| segment page | "Holders in this segment": the 25 organizations with the most active instruments carrying the segment, with the count and the soonest expiry, after the incumbents | `holders` in `categories/<nn>.json` |
| buyer page | the same block for the instruments whose end user is the buyer | `holders` in `buyers/<id>.json` |
| tender page | "Current holders of {agreement}" for each active instrument the notice's solicitation stem issued | `instruments` in the tender shard |

The agreement number is one escaped path segment (`E60ZT-120002%2F001%2FZT`).
The instrument page is in the sitemaps; a filtered or later view of the list
is `noindex`. The radar's `so` mark is unchanged: instruments carry no value
and are not contracts, so they stay off its totals and counts.

The instrument page reads one D1 batch: the state row, the instrument
through `rec_instruments_agr` and its holders through
`rec_holders_instrument` (at most 5,000 rows, one per holder and region).
The database missing, loading or failing answers 503 with the CanadaBuys
search linked; a number it does not hold answers 404.

## States and bounds

- A file that fails to download or parse leaves every row as it was:
  `last_seen` does not move and nothing counts as absent. The stage fails, the
  run status carries `sosa` as failed and the daily check mails it; the list
  says the rows are the last file's.
- A held file: the list says so, with the last file's date.
- An instrument whose every holder is withheld: "all holders withheld (n)".
- The file is about 4 MB; the stage runs in seconds. 100 instruments a page,
  10,000 rows a CSV, 25 holders on the segment and buyer blocks, every
  instrument a profile holds (at most 500).

## The console

The stage's row in the run status (and `LAST_RUN.md`) reads
`<state> published=<date> file_rows=<n> file=<applied|same_publication|held>
instruments=<n> holders=<n> resolved=<n> withheld=<n> with_segments=<n>
callups=<n> gained_week=<n> lost_week=<n>`: the file's publication date, the
rows it held, the active instruments and holder rows, the holder rows linked
to a profile and withheld, the instruments with an inherited segment, the
call-up rows found, and the holder rows gained and lost in the last seven
days; `held=<date>` is added while a file is held. The
operator console (`/admin`) does not show these yet.

## Operator steps at landing

1. Place the host's issuing intermediate certificate at
   `pipeline/awardwatch_pipeline/data/sosa_intermediate.pem` (from the
   certificate's Authority Information Access "CA Issuers" address, its
   fingerprint checked), or the stage fails its certificate check every night.
2. Nothing to apply by hand: `schema.sql` creates the `sosa_*` tables and
   the records sync creates `rec_instruments` and `rec_holders` with its
   schema (new tables, `LAYOUT` unchanged), sent as ordinary changes.
3. The first file loads quietly (no gained events); the second starts the
   lost events.
