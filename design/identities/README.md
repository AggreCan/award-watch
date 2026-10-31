# Award Watch: three identity directions

Mockups of three visual identities for Award Watch (awardwatch.ca). Each direction has the same three pages (home, open tenders, an organization profile) filled with real records from the CanadaBuys samples of 2026-10-31. Open `index.html` to switch between them. Every file opens from disk with no build step; fonts load from Google Fonts for convenience.

```
index.html          switcher: the mark, then palettes, fonts and links per direction
ledger/  home.html  tenders.html  organization.html  style.css
signal/  home.html  tenders.html  organization.html  style.css
civic/   home.html  tenders.html  organization.html  style.css
```

All three share the rules that hold whatever the choice. Buttons are flat, with no gradients or shadows. Data shading uses one hue. Colours that carry meaning differ in lightness, and every state also has a text label. There is no decorative imagery. Every table restacks into labelled blocks below 700 px. Each page has a light and a dark scheme: dark applies under `:root[data-theme="dark"]` and under the system setting unless `data-theme="light"` is set, and the header button stores the choice in `localStorage` (key `aw-theme`, shared by all nine pages). The FR button is decorative. None of the directions uses a navy navigation bar, Public Sans, or a grey-ruled register on plain white.

The accent was fixed by the mark. The decided mark is a lowercase "aw" in Inter Bold whose second v is a check in emerald `#0f7b4f`, and every direction takes that emerald as its only accent: the light schemes use `#0f7b4f` itself, and each dark scheme lifts the same hue (155.6 degrees) to stay readable. The three directions therefore differ in ground, type and layout, and share their colour.

## Ledger

A printed financial record. Warm paper, near-black ink, and the mark's emerald kept for three jobs: links, the "Open" status, and the current-row marker (a 3 px bar on the row under the pointer or keyboard focus). Light: paper `#f6f1e6`, amount band `#ece3d1`, ink `#1f1a14`, muted `#5e5446`, hairline `#d5cab5`, emerald `#0f7b4f`. Dark: paper `#17130f`, band `#221c16`, cream ink `#efe5d0`, muted `#b5a891`, hairline `#3e352b`, emerald lifted to `#36a175`, a quieter green that sits with the cream ink. On paper, ink reaches 15.3:1, muted 6.6:1 and emerald 4.7:1; emerald against ink is 3.3:1, so links stand apart from text by lightness as well as by their underline. In the dark scheme ink is 14.8:1, muted 7.9:1 and emerald 5.7:1, and links rely on the underline (emerald against cream is 2.6:1). Source Serif 4 sets headings, notice titles and amounts; Source Sans 3 sets the text. Section labels are spaced capitals, because Google's subsets of both families carry no small-caps feature; check the self-hosted files for `smcp` before switching to true small caps. Amounts are right-aligned in a banded column framed by two fine rules, the only vertical lines on any page, and totals close on a double rule. To a reader it looks like a statement of account, kept with care and without comment, which fits a site whose rule is that records are records. It costs the most in fonts: 211 KB of latin woff2 (Source Serif 4 roman and italic with the optical-size axis, 168 KB; Source Sans 3, 43 KB). The serif italic accounts for 50 KB of that, and Ledger sets every subline and note in it. The paper tones need checking on low-quality screens in dark mode, and French sublines, which run longer, will wrap more in the italic serif. The mark is drawn from Inter and sits beside a serif name, which reads as a logo beside a title. The CSS itself is plain.

## Signal

A modern data product. Cool white ground, white cards with 4 px corners, generous spacing, and the mark's emerald for everything interactive and for the "Open" status. Light: ground `#f4f6f9`, surface `#ffffff`, text `#0e1116`, muted `#56606d`, border `#dfe4ea`, emerald `#0f7b4f`, hover `#0c5f3d`, tint `#e5f5ef`. Dark: ground `#0b0f14`, surface `#111821`, text `#e6edf3`, muted `#98a4b2`, border `#212b37`, emerald `#33cc8e`, tint `#113224`. Text on white is 18.9:1, muted 6.4:1, emerald 5.3:1, white on an emerald button 5.3:1, and the "Open" tag 6.9:1; in the dark scheme text is 15.1:1, muted 7.0:1, emerald 8.6:1 and dark text on an emerald button 7.8:1. Inter sets everything, so the name beside the mark is in the mark's own face. Tabular figures apply only to amounts and stat figures, because Inter's `tnum` also widens the hyphens in dates and reference numbers. The stat tiles carry a 36 to 48 px bold numeric scale. On the tender list a sticky bar holds the search box, category chips and closing-window chips, with the other five filters in a panel above it; the bar stops sticking below 1000 px. Bars in the rankings and buyer tables are emerald on its own tint. A reader sees a current, fast tool that is easy to scan. It is also the most familiar look of the three and says the least about this site in particular. It is the cheapest in fonts (one variable Inter file, 47 KB latin). The chips and the sticky bar need a little script and filter state; the mockup only toggles the pressed state.

## Civic

A broadsheet's data page. Black and white with the mark's emerald, condensed headlines, heavy rules, square corners, dense but ordered. Light: ground `#ffffff`, ink `#111111`, muted `#545454`, hairline `#d5d5d5`, emerald `#0f7b4f`, tint `#e5f5ef`. Dark: charcoal `#1b1b1a`, off-white ink `#f1eee8`, muted `#aca89f`, hairline `#3a3936`, emerald `#3bb080`, tint `#153729`. Emerald fills the kicker labels and the "Open" tag under white text (5.3:1; in the dark scheme, near-black text on `#3bb080` at 6.8:1), underlines links (which stay in ink), marks the current navigation item, sits under each pull-figure and draws the bars. Archivo Narrow sets the nameplate, headlines, labels and pull-figures; IBM Plex Sans sets text and tables. Libre Franklin and Oswald, the brief's other two options, were checked first and dropped: as Google serves them, both have proportional digits and no `tnum` feature, so amounts would not line up in a column. Archivo Narrow and Plex Sans have tabular digits by default. The masthead is a dateline, a nameplate (the mark beside the name in condensed capitals), an 8 px rule and the navigation. The home page is a front page in two columns: the lead column carries today's 25 new notices under a headline, and the side column carries closing soon, recent awards and the top organizations as short blocks with emerald bars. The profile opens on four pull-figures and keeps the organization's name in its display spelling, since an all-caps rendering would match a different recorded spelling ("WSP CANADA INC."). Readers get the seriousness of a newspaper's data desk, in a form few data sites use. Fonts cost 86 KB of latin woff2 (Archivo Narrow, one variable file, 18 KB; Plex Sans roman and italic, 68 KB). The front page needs its own template, and the side-column blocks are separate markup from the tables, so there is more to keep bilingual. Condensed capitals in the navigation and labels will wrap sooner in French.

## The mark

Every masthead carries `brand/mark-two-tone.svg` inline as the file has it: two `currentColor` paths for the letters and the emerald path for the check, in one SVG with a comment naming the file (`brand/make_mark.py` builds it). The name sits beside it as live text in the direction's own type. `brand/wordmark.svg` is not used on the pages: beside the mark it would repeat "aw", and on its own it would put Inter into the Ledger and Civic mastheads; `index.html` shows it for reference. The tab icon links `brand/favicon.svg`. In the dark schemes one CSS rule (`.mark [fill="#0f7b4f"]`) lifts the check to the direction's dark emerald, because the filed `#0f7b4f` reaches only 3.3 to 3.6:1 on the dark grounds; delete that rule to keep the filed colour everywhere.

## WSP Canada Inc. (the profile page)

Computed from `data/raw/samples/2026-2027-awardNotice.csv` with the pipeline's `norm_name` and the counting rules in the project guide: one contract per reference number (each reference appears once in this file); value is the total contract value when above zero, otherwise the contract amount; cancelled counts zero; years are calendar years of the award date.

The file has 19 notices under the exact spelling "WSP Canada Inc.". Under the site's identity rule five spellings reduce to the same name, giving 24 notices: WSP Canada Inc. (19), WSP Canada Inc (2), WSP Canada inc. (1), WSP CANADA INC. (1), WSP CANADA INC (1).

| Year | Notices | Total value | Non-competitive, by count | Non-competitive, by value |
|---|---:|---:|---:|---:|
| 2026 | 17 | $10,610,928.00 | 0 of 17 | $0.00 of $10,610,928.00 |
| 2024 | 5 | $259,777.35 | 1 of 5 | $59,939.00 of $259,777.35 |
| 2023 | 2 | $5,000,000.00 | 0 of 2 | $0.00 of $5,000,000.00 |
| All years | 24 | $15,870,705.35 | 1 of 24 | $59,939.00 of $15,870,705.35 |

- The one non-competitive notice is CW2372925 (G7 Climate Risk and Vulnerability Assessment, awarded 2024-08-29). Its file row gives a contract amount of $68,015.00 and a total contract value of $59,939.00; the rule takes the total.
- 16 of the 24 notices carry a value of zero; 13 of those are standing offers or supply arrangements.
- No notice is in a currency other than CAD; two give no currency, both with zero value.
- Buyers (contracting entity): Public Works and Government Services (PSPC) 20 notices, $15,686,955.35; National Research Council 1, $183,750.00; Fisheries and Oceans 1, $0; Agriculture and Agri-Food 1, $0; Natural Resources 1, $0.
- Places seen: Montreal, QC (20); Québec, QC (2, spelled "Quebec" and "Québec" in the file); Ottawa, ON (1); Victoria, BC (1).
- First seen 2023-05-31 and last seen 2026-10-06, by award date. The notices were published between 2026-04-07 and 2026-10-07, because this file holds fiscal year 2026-2027 only; the 2023 and 2024 rows are older contracts whose notices were published or amended this year.
- The other four sources show their empty state ("No records loaded for this mockup"). The contract history sample (`2026-2027-contractHistory.csv`) does hold 14 rows under this name, which the page could show.

## Other figures on the pages

- New today: the 25 rows of `newTenderNotice.csv`; 23 were published on 2026-10-30 and the 2 Shared Services Canada notices give no publication date.
- Closing soon: the 8 soonest closing dates among those 25. Only one closes within 7 days (Solenoid Procurement, 2026-11-05), so the "Closing within 7 days" and "Open tenders" tiles show `[count]` with a note: both need the open-notices file, which the samples do not include. The tender list's pager shows `[open count]` and `[last]` for the same reason.
- Awards this year: 3,895 award notices dated 2026 in the 2026-2027 file, worth $19,197,439,673.29 by the counting rules (shown as $19.20 billion). The 48 notices in other currencies are left out of the value; 10 are cancelled and count zero; 5 carry award dates after 2026-10-31 and are kept as published.
- Recent awards: the 8 newest award dates on or before 2026-10-31, ties broken by publication date, then reference. Four are security-guard supply arrangements published at $0.
- Top organizations, 2026 so far: suppliers grouped by `norm_name`, totalled by the counting rules over notices dated 2026. Chantier Davie Canada Inc. leads with one notice at $13,044,299,191.04. The ranking keeps every row, because the pipeline's person-name test flags 313 supplier rows in 2026, among them companies such as Kongsberg Defence and Aerospace AS ($692,647,779.00, third here) and Rio Tinto Fer et Titane. The top eight were checked by eye: all are companies.
- Segment names in the tender filter are the standard UNSPSC segment titles, pending the pipeline's segment seed.

## Fonts and licences

All five families are under the SIL Open Font License 1.1 (checked in each font file's licence field). Sizes are the latin woff2 files Google Fonts served on 2026-10-31 for the weights the mockups use; latin covers French. The site would serve its own copies.

| Family | Direction | Latin woff2 |
|---|---|---:|
| Source Serif 4 | Ledger | 168 KB (roman and italic, optical-size axis) |
| Source Sans 3 | Ledger | 43 KB (roman and italic) |
| Inter | Signal | 47 KB (one variable file) |
| Archivo Narrow | Civic | 18 KB (one variable file) |
| IBM Plex Sans | Civic | 68 KB (roman and italic) |

## Checks

Every page was rendered in headless Chrome inside frames 360, 700, 800, 900, 1000, 1100, 1101 and 1280 px wide, with no horizontal overflow at any width. Tables restack below 700 px; the profile's figures table, with a column per source, restacks below 1000 px. Light and dark schemes were checked by screenshot. No file contains an em-dash (the en-dashes inside some notice titles are the publisher's). Pages weigh 22 to 37 KB each.
