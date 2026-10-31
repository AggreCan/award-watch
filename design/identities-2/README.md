# Award Watch: identity directions, round two

Three page directions for awardwatch.ca, after the first round (Ledger, Signal, Civic) was turned down for its serif and condensed faces, its paper, ochre, oxblood and tinted grounds, and a template feel. Each direction carries the same three pages with the same real records, so the comparison is between designs:

```
index.html                 switcher: point of view, signature moves, both palettes, links, a live preview
sheet/    home.html  tenders.html  organization.html  style.css
console/  home.html  tenders.html  organization.html  style.css
dossier/  home.html  tenders.html  organization.html  style.css
tools/    extract.py extract2.py -> data.json extra.json; gen.py index_gen.py (pages); check.py (width check)
```

Open `index.html` from disk; nothing needs a build. Fonts load from Google Fonts.

## What all three share

These are the owner's answers, applied the same way in each direction.

- Inter alone, for everything. Weight and size carry the hierarchy. Every figure is set with `font-variant-numeric: tabular-nums` (applied to the whole page, so dates, amounts, counts and references line up in columns).
- Square corners, 1 px borders and hairline rules, flat buttons. No shadows, gradients, tints or images.
- Neutrals plus two colours. The emerald `#0f7b4f` marks open notices, awarded records, links and the check. The amber `#b45309` marks closing within 7 days and nothing else. In the dark schemes they lift to `#34d399` and `#fbbf24`.
- Light by default. The dark scheme applies under `:root[data-theme="dark"]` and under `prefers-color-scheme: dark` unless `data-theme="light"` is set. The header button stores the choice in `localStorage` (key `aw-theme`, shared by all ten pages). The FR switch is decorative.
- Tables restack into labelled blocks below 700 px. No page scrolls sideways at any width.
- Field conventions: sortable column headers (working), a filter bar whose active filters show as removable chips (working), status chips (Open, Closing soon, Awarded, Expired, Cancelled), closing dates with days left, "Data as of 2026-10-31", a CanadaBuys link on every record, Export CSV buttons, Watch and Save search buttons (they toggle, and store nothing), and the non-competitive definition as a footnote on every profile.
- The header mark is `brand/mark-two-tone.svg` inlined as filed: two `currentColor` paths and the check in `#0f7b4f`. Dossier uses `brand/wordmark.svg` instead, also inlined as filed. The tab icon is `brand/favicon-w.svg`. In the dark schemes one CSS rule lifts the check to the dark emerald, because the filed `#0f7b4f` reaches 3.6:1 on those grounds; delete the rule to keep the filed colour.

The emerald and the amber have the same lightness: against each other they reach 1.05:1 in the light schemes and 1.15:1 in the dark ones. The two time states therefore never rely on colour. "Open" is an outline and "Closing soon" is solid (Sheet and Dossier fill the chip; Console fills the square glyph and sets the label in amber), and both always carry their label. In the dark schemes the emerald and the ink are 1.6:1 apart, so links stay underlined everywhere.

## A. Sheet

**The idea.** The register as one ruled sheet. A white page, ink, and 1 px rules between rows and sections, with no panels or cards. It should read as the most trustworthy document on the internet, typeset by people who make good software.

**Signature moves.**
1. The check from the mark is the system's awarded glyph. It sits beside every awarded row, in a narrow left column of ticks, and inside the Awarded chip. The page defines the mark's own check path once as an SVG symbol (cropped to its bounds) and reuses it.
2. Every table ends on a right-aligned Source column of small links: CanadaBuys for a notice, Open data for a total built from a dataset.
3. The masthead is two ink hairlines with the mark, the name and the data date on the first row and the navigation on the second, under a light rule. Nothing in it is filled.
4. Amounts sit right-aligned in a column ruled on both sides, the only vertical rules inside a table; totals close on an ink rule. Each section opens on an ink rule; rows are separated by `#e5e7eb`.

**Palette and contrast** (text on the ground, then on the hover row):

| Role | Light | Contrast | Dark | Contrast |
|---|---|---:|---|---:|
| Ground | `#ffffff` | | `#101010` | |
| Hover row | `#f9fafb` | | `#171717` | |
| Ink | `#111111` | 18.9, 18.1 | `#ececec` | 16.1, 15.2 |
| Secondary text | `#374151` | 10.3, 9.9 | `#c2c2c2` | 10.7, 10.1 |
| Muted text | `#6b7280` | 4.8, 4.6 | `#9a9a9a` | 6.8, 6.4 |
| Row rule | `#e5e7eb` | | `#2b2b2b` | |
| Section and masthead rule | `#111111` | | `#ececec` | |
| Emerald | `#0f7b4f` | 5.3, 5.1 | `#34d399` | 9.9, 9.3 |
| Amber | `#b45309` | 5.0, 4.8 | `#fbbf24` | 11.4, 10.7 |
| Text on the amber chip | `#ffffff` | 5.0 | `#101010` | 11.4 |

**Cost on the real site.** The lowest of the three. One stylesheet of 15 KB, the sort, chip and theme script (1.6 KB), and the 48 KB Inter file. The current page templates map onto it almost directly: sections, tables and footnotes. Three things need care: every table needs its column classes (amount, source, status, date) set consistently so the ruled amount column and the Source column line up; the tick column adds one cell per award row; and long pages stay long, because the sheet has no tabs or panels to fold content into.

## B. Console

**The idea.** The product a bid manager opens every morning. White panels on a near-white page, a dense toolbar, and the counts that changed overnight always in view.

**Signature moves.**
1. A persistent left rail that is a live index: Today; Open tenders, New today, Closing within 7 days (amber square and count); Awards this week, Awarded in 2026; Watched organizations (WSP Canada Inc. is the watched example) and Saved searches; then the browse links. Below 1000 px it collapses into a wrapping strip of count buttons under the top bar.
2. The tender list as a split view from 1200 px: the list on the left, the selected notice's details on the right (buyer, dates, method, selection criteria, UNSPSC, delivery, trade agreements, contract period, the description's opening as published, the CanadaBuys link, Watch notice). The panel footer reads "j / k to move, Enter to open"; both keys work, a click selects a row, Enter opens the CanadaBuys notice, and `/` focuses search. Below 1200 px the details sit under the list.
3. Stat tiles with 32 px tabular figures and one line of change beneath: "+25 new since yesterday", "−46 on the week before (149)", "+100 notices published this week".
4. A dense toolbar of filter buttons, with the active filters below it as removable chips. Status chips use a square glyph plus the label: hollow emerald for Open, solid emerald for Awarded, solid amber with an amber label for Closing soon, hollow grey for Expired, solid grey with a struck label for Cancelled.

**Palette and contrast** (highest and lowest across the page, panel and selected-row grounds):

| Role | Light | Contrast | Dark | Contrast |
|---|---|---:|---|---:|
| Page | `#f8fafc` | | `#0b1120` | |
| Panel | `#ffffff` | | `#0f172a` | |
| Selected row | `#f1f5f9` | | `#172033` | |
| Border | `#e2e8f0` | | `#1e293b` | |
| Strong border | `#cbd5e1` | | `#334155` | |
| Ink | `#0f172a` | 17.9, 16.3 | `#e2e8f0` | 15.3, 13.2 |
| Secondary text | `#334155` | 10.4, 9.5 | `#cbd5e1` | 12.7, 11.0 |
| Muted text | `#5b6b80` | 5.4, 5.0 | `#94a3b8` | 7.3, 6.3 |
| Emerald | `#0f7b4f` | 5.3, 4.8 | `#34d399` | 9.8, 8.5 |
| Amber | `#b45309` | 5.0, 4.6 | `#fbbf24` | 11.3, 9.7 |
| Text on the emerald button | `#ffffff` | 5.3 | `#0b1120` | 9.8 |

The greys are the cool slate family, because the owner gave `#f8fafc` and `#e2e8f0` for the page and the borders; the muted grey is darker than slate-500 so it clears 4.5:1 on the selected row.

**Cost on the real site.** The highest of the three.
- The rail needs counts the export does not yet produce: open notices closing within 7 days, award notices published this week and the week before, notices published this week with a 2026 award date. `stats.json` would gain those fields.
- The split view needs each notice's details on the list page. The mockup embeds them as JSON for 25 notices, which takes the page to 54 KB. The real open list is far longer, so the site would fetch the detail shard (`tenders/<abc>.json`) when a row is selected and keep the list file to list fields, as the export contract already requires.
- Keyboard handling, focus management, the sticky detail panel and the collapse of the rail are page script and CSS that the other two directions do not need. The watchlist and saved searches would live in `localStorage` until there are accounts.
- The panel and tile layout puts more markup around each table, so every page template changes.

## C. Dossier

**The idea.** The organization as a file and the site as the archive that holds it. White ground, generous margins, a strong type scale, sections numbered like a published report, and a fixed 24 px grid under everything.

**Signature moves.**
1. Each profile opens with a record line under the name, in tracked capitals with Inter's case-sensitive forms: "Supplier · 24 award notices since 2023 · Montreal QC · Corporations Canada: [match pending]".
2. The home page is Today's sheet, a dated issue: the date as the title (40 px, weight 600, letter-spacing −0.032em, Inter's display optical size), a standfirst, key figures, contents, the day's 25 new notices as the lead table, then numbered sections (closing within 7 days, award notices published yesterday, award notices by day of publication, largest recipients in 2026, sources read).
3. The wordmark is the masthead, with the navigation as one line of text links under a hairline.
4. Tables are inset to the title line, rows are 48 px (two grid lines), tender tables in successive sections share column widths from 1000 px up, and the row under the pointer or keyboard focus takes a 2 px emerald rule on its left edge. Every block starts and ends on a 24 px line: line heights, gaps, button rows and table rows are multiples of 24, and text inside a ruled block sits a 12 px half-step below its rule. "Show the 24 px grid" in the footer (or `#grid` on the URL) draws the grid over the page.

**Palette and contrast** (text on the ground, then on the hover row):

| Role | Light | Contrast | Dark | Contrast |
|---|---|---:|---|---:|
| Ground | `#ffffff` | | `#0c0c0c` | |
| Hover row | `#fafafa` | | `#141414` | |
| Ink | `#0a0a0a` | 19.8, 19.0 | `#f0f0f0` | 17.2, 16.2 |
| Secondary text | `#3d3d3d` | 10.9, 10.4 | `#c6c6c6` | 11.5, 10.8 |
| Muted text | `#6b6b6b` | 5.3, 5.1 | `#9e9e9e` | 7.3, 6.9 |
| Row rule | `#e6e6e6` | | `#262626` | |
| Heading rule | `#0a0a0a` | | `#f0f0f0` | |
| Emerald | `#0f7b4f` | 5.3, 5.1 | `#34d399` | 10.2, 9.6 |
| Amber | `#b45309` | 5.0, 4.8 | `#fbbf24` | 11.7, 11.0 |
| Text on the amber chip | `#ffffff` | 5.0 | `#0c0c0c` | 11.7 |

The greys here are pure neutrals, with no cool cast.

**Cost on the real site.** In between, with two specific costs.
- The wordmark inlined as filed weighs 18 KB per page, which took the home page to 59 KB. The site would serve it once as a cached SVG with `currentColor` (or as two colour files for the two schemes) and reference it.
- Inter with the optical-size axis is 73 KB of latin woff2 against 48 KB without it. The axis is what makes the 40 px titles look set rather than enlarged; dropping it saves 25 KB.
- Today's sheet is its own template and needs new export fields: award notices published the previous day, and the count per publication day for the last 28 days. Numbered sections and the contents list are generated per page, and every new component has to hold the 24 px grid, which takes discipline in review rather than code.

## The records on the pages

Every row comes from the samples of 2026-10-31 under `data/raw/samples/`: `newTenderNotice.csv` (25 notices), `2026-2027-awardNotice.csv` (4,860 award notices) and `2026-2027-contractHistory.csv` (2,466 rows). `tools/extract.py` is the round-one script with the package renamed to `awardwatch_pipeline`; `tools/extract2.py` adds the figures this round needs. Neither stores a contact field, and the notice descriptions are kept only up to their first email address or phone number, so contact details stay on CanadaBuys. Run `python extract.py`, `python extract2.py`, `python gen.py` and `python index_gen.py` from `tools/` to rebuild everything. Organization names are grouped with the pipeline's `norm_name`; money follows the counting rules in the project guide.

**WSP Canada Inc.** (`org-269e65b4fe`), 24 award notices under five spellings: WSP Canada Inc. (19), WSP Canada Inc (2), WSP Canada inc. (1), WSP CANADA INC. (1), WSP CANADA INC (1).

| Year | Award notices | Value | Non-competitive | PSPC contract history | Value |
|---|---:|---:|---:|---:|---:|
| 2026 | 17 | $10,610,928.00 | 0 of 17 | 13 | $10,427,178.00 |
| 2024 | 5 | $259,777.35 | 1 of 5 ($59,939.00) | 0 | $0.00 |
| 2023 | 2 | $5,000,000.00 | 0 of 2 | 0 | $0.00 |
| All years | 24 | $15,870,705.35 | 1 of 24 ($59,939.00) | 13 | $10,427,178.00 |

- The non-competitive notice is CW2372925 (G7 Climate Risk and Vulnerability Assessment, awarded 2024-08-29).
- 16 of the 24 notices carry a value of 0.00 as published; 13 of them are standing offers or supply arrangements.
- Buyers: Public Works and Government Services (PSPC) 20 notices, $15,686,955.35; National Research Council 1, $183,750.00; Fisheries and Oceans, Agriculture and Agri-Food, and Natural Resources 1 each at $0.00.
- Supplier addresses: Montreal QC 20, Québec QC 2 (spelled "Quebec" once), Ottawa ON 1, Victoria BC 1.
- First award 2023-05-31, latest 2026-10-06.
- Contract history: 14 rows under two spellings (WSP Canada Inc. 13, WSP CANADA INC 1), 13 contracts at their newest amendment, all awarded in 2026, $10,427,178.00, none non-competitive. All 13 references also appear among the award notices, which is why the two sources sit in separate columns and are never added. The source links on those rows point at the matching award notices.
- Published contracts, grants and contributions, and lobbying are not loaded in the mockups.

**Other figures.**
- New today: the 25 rows of the new-notices file (23 published 2026-10-30; the 2 Shared Services Canada notices give no publication date). By closing date: 1 within 7 days (Solenoid Procurement, 2026-11-05), 21 in 8 to 30 days, 3 later.
- Award notices published this week (2026-10-25 to 2026-10-31): 103; the week before: 149; on 2026-10-30: 9, listed in Dossier's "published yesterday" section.
- Award notices dated 2026: 3,895, worth $19,197,439,673.29 by the counting rules (48 in other currencies left out, 10 cancelled at zero); 100 of them were published this week.
- Daily publication counts for 2026-10-03 to 2026-10-30, highest 39 (2026-10-08 and 2026-10-21).
- Recent award notices: the 8 newest award dates on or before 2026-10-31.
- Largest recipients, 2026: Chantier Davie Canada Inc. ($13,044,299,191.04), MDA SYSTEMS LTD ($719,671,091.09), Kongsberg Defence & Aerospace ($695,137,779.00), NMG Matawinie Inc., Rio Tinto Fer et Titane, United Van Lines (Canada) Ltd., Pomerleau Inc., General Dynamics Ordnance and Tactical Systems - Canada Inc. This order differs from round one's README because `norm_name` has changed since; the top eight were checked by eye and all are companies.
- `[n]` marks the figures that need the open-notices file, which the samples do not include: open notices in total, and closing within 7 days across all of them. The registry match on the profile is `[match pending]` because the registry stage has not run on the samples.
- Buyer names drop a leading "Department of" for space, pending the buyers stage's display names.

## Fonts and licence

Inter only, under the SIL Open Font License 1.1 (the licence field of `brand/fonts/Inter-Bold.ttf`, Inter 4.001). Google Fonts served the latin subset on 2026-10-31 as one variable woff2 of 48 KB for weights 400 to 700 (Sheet, Console, the switcher) and 73 KB with the optical-size axis added (Dossier). The site would serve its own copies.

## Checks

- Widths: `tools/check.py` loads every page in an iframe of exact width and lists any element whose right edge passes the viewport. At 360, 700, 800, 1000, 1100, 1199, 1200, 1280 and 1440 px, in the light and the dark scheme, no page overflows (the iframe's scrollbar makes the 360 check run at 345 px). Tables are labelled blocks below 700 px. Columns of secondary detail hide between 700 and 999 px (to 1199 px in Console, whose rail takes 240 px from 1000 px up) and come back as labelled lines in the blocks below 700 px.
- Rendered and looked at in headless Chrome at 1280, 1000, 700 and 360 px, in both schemes, and Dossier with its grid drawn.
- Console: j, k, a row click, Enter, column sort, theme toggle, chip removal and the watch toggle were exercised by script.
- Page weights: 26 to 59 KB for the nine pages, 19 KB for the switcher. No file contains an em-dash; the en-dashes inside some notice titles are the publisher's.
