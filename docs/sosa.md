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

The file as published in 2026 departs from the dictionary
in three ways, and the stage reads both forms:

- `agreement-type_en` holds the acronym (`NISO`, `NMSO`, `RISO`, `RMSO`,
  `DISO`, `SA`) where the dictionary spells the type out. `sosa.type_code`
  knows a type by either, and `sosa.TYPES` names each in both languages
  (`NISO` is a national individual standing offer, a type the dictionary
  does not list). A type known by neither keeps the file's words.
- `commodity` holds UNSPSC codes, several joined by "; ", and the two
  descriptions their names as "code - name" pieces, each field in literal
  double quotes. The stage strips the quotes and keeps the codes whole
  (`sosa.commodity_codes`, `sosa.commodity_names`); a GSIN from the
  dictionary's layout reads the same way.
- `delivery-point-code` holds `CA` for the whole country and a code stored
  as `RCNNCR` (its letters) for the National Capital Region, where the dictionary
  has `NA` and `NC`, and country codes such as `US`. The site names `CA`
  and `RCNNCR` as it names `NA` and `NC`, and any other code by the file's
  own `delivery-point_en` or `_fr`.

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
  `BC`; `FD` foreign, `NA` national, `NC` national capital, `CA` and
  `RCNNCR` the current file's national and national capital). A profile
  counts agreement numbers, not rows.
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
- Segments. The dictionary's file carried a GSIN; the current one carries
  UNSPSC commodity codes, which the pages show with their names but which
  do not set the segments. An instrument inherits the
  segments of the award and tender notices whose solicitation or contract
  number has the agreement number's stem (the part before the first `/`,
  spaces and case folded; at least six letters or digits). The newest tender
  notice of the stem is the instrument's RFSO or RFSA notice. An instrument
  no notice shares its stem with has no segment and is listed under "no
  segment" (1,013 of 3,787 on 2026-11-07). Reading the segments from an
  instrument's own UNSPSC commodity codes would give those one; it is not
  done.
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
`ref` `sosa:<agreement>`, the organization and the expiry. A holder with
no organization gets no event, since no watch can name it. Rows older than
400 days are deleted.

The records sync turns them into the watches' events
(`records_db.derive_events`; `docs/analytics.md`, *Events*): three kinds of
`rec_events` row on the holder organization (`oid`), each with `ref`
`sosa:<agreement>`, the expiry in `endd`, the description in `title` and
`title_fr` (120 characters), the type and the region's name in `other` and
`other_fr` ("Regional master standing offer · British Columbia", the type
named by `sosa.TYPES` whatever the file wrote), and the
instrument's page as `path`. `rec_events` keeps its columns: no `LAYOUT`
change, no reload.

| Kind | From |
|---|---|
| `instrument_gained` | each kind 12 row, once (by its key; its day is the file's publication date, which can be earlier than the previous night) |
| `instrument_lost` | each kind 13 row, once |
| `instrument_expires_6m` | an active instrument whose expiry enters the 182 days of the data date between the previous night and tonight, once per holder organization, its regions together; no 365-day line |

The first file writes no kind 12 row, so the first load derives nothing;
lost events start after the second file. The per-organization cap of 100 rows
a kind a day applies as to every kind.

An organization watch (`docs/accounts.md`, *Watches*) follows the three
kinds: "Gained a standing offer or supply arrangement", "No longer holds a
standing offer or supply arrangement", "Instrument expires within 6 months"
("A obtenu une offre à commandes ou un arrangement en matière
d'approvisionnement", "Ne détient plus d'offre à commandes ou d'arrangement
en matière d'approvisionnement", "Instrument expirant d'ici 6 mois"). A watch
made from now on follows them; a watch stored earlier keeps its list until
its reader ticks them. Free accounts see the rows on the watches page; Pro
gets them in the watch mail:

```
- E60ZT-120002/001/ZT
  Gained a standing offer or supply arrangement · Regional master standing offer · British Columbia · Environmental consulting services · expires 2028-03-31 · 14 holders
  First seen 2026-11-07
  https://awardwatch.ca/instruments/E60ZT-120002%2F001%2FZT
```

The holder count is the instrument's active holders now (`rec_instruments.n`,
persons withheld counted), read in the events statement through
`rec_instruments_agr`; an instrument the records database no longer holds
shows none.

The watches' calendar feed (`docs/accounts.md`, *Calendar feeds*) lists, for
each organization watch that follows `instrument_expires_6m`, every active
instrument the organization holds that expires within 182 days: one all-day
event per instrument and organization, UID
`instrument-sosa:<agreement>:<organization id>@awardwatch.ca`, `SEQUENCE` 0
(the records database does not carry `expiry_changes`), title "Expires:
{agreement} · {type} · {holder}".

## What the site shows

| Address | What | Reads |
|---|---|---|
| `/instruments` | every active instrument with its segment chips, filtered by type, region (by name, in the page's language), segment (or none), one commodity code, end user and expiry within 3, 6 or 12 months; sorted by expiry or holders; 100 a page; the commodity codes with their names, the first three in the list; the lead names the source, its weekly cadence and the file's date | `instruments/index.json` (one row per instrument: the type code, and the file's words for a type the stage does not know; the commodity codes; and the names of the types, the codes and the delivery points once each) |
| `/instruments/rows.csv` | the view as CSV, at most 10,000 rows (Pro) | the same file |
| `/instruments/<agreement>` | type, descriptions in both languages, the commodity codes with their names (`gsin` holds the codes, `gsin_en` and `gsin_fr` the "code - name" pieces), end user, start, expiry and days left, the RFSO notice, the inherited segments; the holders (linked to the profile, regions, first seen, call-ups and their value), persons withheld as a count, the call-ups of other vendors; the source cited | `rec_instruments`, `rec_holders` |
| `/instruments/<agreement>/holders.csv` | the holders as CSV (Pro) | the same |
| profile | "Holds N active standing offers or supply arrangements" in the head, and a section of every instrument held (soonest expiry first) and the ones no longer held within 90 days | `instruments` in the profile shard |
| segment page | "Holders in this segment": the 25 organizations with the most active instruments carrying the segment, with the count and the soonest expiry, after the incumbents | `holders` in `categories/<nn>.json` |
| buyer page | the same block for the instruments whose end user is the buyer | `holders` in `buyers/<id>.json` |
| tender page | "Current holders of {agreement}" for each active instrument the notice's solicitation stem issued | `instruments` in the tender shard |
| `/account/organization` | for Pro, the instruments the claimed organization holds (soonest expiry first, 25 shown, the profile's section for the rest) and `instruments.csv`; Free sees the title with the Pro chip (`docs/accounts.md`, *Your organization*) | `rec_holders` by organization (a scan: no index leads with it), `rec_instruments` by key |

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
4. Optional: `rec_holders` has no index by organization, so the watches'
   calendar feed reads `rec_instruments` whole (a few thousand rows) for an
   organization's instruments. `CREATE INDEX IF NOT EXISTS rec_holders_org ON
   rec_holders (oid) WHERE oid IS NOT NULL;` in `records_schema.sql` would let
   it seek; nothing needs it at today's size.
