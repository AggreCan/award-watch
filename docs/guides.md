# Guides

Plain explanations of the federal records the site reads, at `/guides` and
`/guides/<slug>`, in English and French. Each guide answers one question a
reader types into a search engine, links into the site's own pages where the
reader can see the thing described, and lists the official pages its rules
were read from.

## Where a guide lives

- `site/src/guides.ts` holds the guides as typed content: a slug, a title, a
  shorter title for the result list where the heading does not fit 60
  characters with the site's name, a one-sentence summary (the page's lead
  and its meta description), the day it was last checked, its sections and
  its sources.
- A section is an id, a title and blocks: a paragraph, a list, a definition
  list (`terms`), a table or a figure (see Figures). Every piece of text
  carries its English and its French side by side.
- A link inside a sentence is a `{slot}` written in both languages, with one
  address in the block's `links`, so the two languages cannot link apart.
  Body links go to the site's own pages; official pages go in the sources.
- A table's columns are kinds of the column system (`site/src/columns.tsx`).
  Give the room to the words: a column of sentences is `main`, and a column
  that names each row in a word or two is a fixed kind (`label`, `text`).
  Two `main` columns share the room equally, which suits a comparison. A
  short naming column left as `main` takes all the spare width and leaves
  the sentences beside it to wrap in 192 px.
  An amount is `{ money: n }`, and the page formats it in the reader's
  language.
- A source is the official page's title as the page gives it, its publisher
  in both languages and its address. `fr` holds the French page's title and
  address only when that page itself was read; otherwise a French reader is
  sent to the English page and told so.
- `site/src/pages/guides.tsx` draws the index and the guides. The frame's
  words (the rail's name, the index's lead, the checked line, the sources'
  head) are in `site/src/i18n.ts` under `nav.guides` and `guides.*`.

## Adding a guide

1. Read every official page the guide rests on, in that session, and record
   each claim with the address it came from. A page that refuses automated
   reading is not worked around. A claim with no source stays out.
2. Where the Methodology states how the site reads a field (closing times,
   statuses, derived provinces, the counting rules), the guide says the same.
3. Write the English, 600 to 1,000 words, then the French in full, with the
   federal government's own French terms. Write French with plain spaces and
   straight apostrophes, as in the dictionary; the page applies the
   typography.
4. Add the guide to `GUIDES` in `site/src/guides.ts`. The slug is its address,
   and the order of `GUIDES` is the index's.
5. Set `checked` to the day the sources were read. When a source changes
   (the trade agreement thresholds are revised every two years), read it
   again and update the guide and the day.
6. Add a line for it to `site/public/llms.txt`. A guide with a table goes on
   the table-fit list in `site/test/columns.test.ts`.
7. Give it at least one figure of the page its text describes, and run
   `npm run figures` (see Figures).
8. Run the tests. `site/test/guides.test.ts` holds the two languages to the
   same sections, links and figures, requests every link inside a guide and
   finds its fragment, checks that every source is an https page on a
   government domain, and checks the result-list tags, the sitemap, the
   absence of account links and Pro marks, and the writing rules a test can
   check (no em-dash or en-dash, none of the banned words, no question).
   A link to a page the records database serves, such as a published
   contract, needs that row seeded in the test, as the guide on set-asides'
   example contract is.

## Figures

A figure is a capture of one of the site's own pages, cropped to the part a
section explains, with numbered marks on the fields the section's text
explains and a legend under it. A figure never pictures a Government of
Canada page (CanadaBuys, canada.ca): their terms forbid commercial
reproduction without written permission and any reproduction of the Canada
wordmark, arms or flag, so no government symbol appears in a capture.

### The sample records

The pages are rendered from records made for the figures, in
`site/figures/`, never from real ones, so a figure never freezes a real
firm's record:

- `tenders.json` and `contracts.json`: tender notices, award notices and
  contract history records, each served in the detail shard its reference
  hashes to;
- `data/`: the other files the pages read under `/data/`, at their paths;
- `records.sql`: rows of the records database (published contracts,
  standing offers).

A supplier is plainly a sample ("Sample Supplier Inc."), never an invented
name that could match a real firm. A buyer may be a real federal
institution. Dates, amounts and field values follow the real formats, and so
do reference numbers, kept in ranges the real series are nowhere near, so a
figure never shows a real record's number beside a sample supplier:
CanadaBuys references `cb-900-9000…`, published contracts
`C-<fiscal year>-Q<n>-9…`, PSPC contract numbers `CW9…`, and PSPC
solicitation, procurement and agreement numbers with a `99` block
(`EN578-99…`, `F5211-99…`); `site/test/guide-figures.test.ts` holds every
sample reference to those patterns. The samples' clock is their data date,
2026-11-13, at noon in Ottawa. They are kept apart from
`site/test/fixtures/`, so a test fixture change never moves a figure.

### Adding a figure

1. Add any record the page needs to `site/figures/`.
2. Add a `figure(...)` block to the section whose text it pictures, in
   `site/src/guides.ts`: an id, the page captured (a site path), the CSS
   selector of the element the image is cropped to, the alt text and the
   caption in both languages, and three to six marks. A mark is
   `mark(target, en, fr)`: a CSS selector read inside that element
   (`field(dl, n)` takes a definition list's nth label and value as one
   target) and one short sentence. The sentence says only what the guide's
   own sections say about that field. A mark that would need a fact the guide
   does not state is left out. Every caption ends with the sample line
   (`guides.figure_sample` in `site/src/i18n.ts`).
3. Run `npm run figures` in `site/`, then the tests.

### The tool

`npm run figures` (`site/scripts/make-guide-figures.mjs`):

1. renders every captured page through the Worker, from the sample records
   (`site/figures/render.test.ts` under `site/vitest.figures.config.ts`, a
   suite of its own that `npm test` never runs);
2. serves those pages beside `site/public` over local HTTP (nothing under
   `/data/`), so their stylesheet, scripts and fonts load as on the site;
3. opens a headless browser (Edge; `FIGURES_BROWSER` names another, such
   as Chrome), a fresh one for each capture, since one kept open across
   many captures was seen to darken light pages, and loads each page in both
   languages, at two widths and in both themes. The wide image is the desktop layout (from 1000 px) at the
   widest viewport whose crop fits the figure's room in the guide's column
   (846 px less the frame's 8 px indent, 838), shown at its own size; the
   phone image is a 390 px viewport, shown in 316 px (0.854 of its size for
   the usual 370 px crop). It waits for the fonts and the layout, reads the
   box of the region and of each mark's target, and captures the region with
   6 px around it as WebP at device scale 2;
4. places each mark as the page will draw it, at the scale the guide shows
   that image, and refuses the figure when a mark's edge or number covers any
   line of text inside the image (a `Range` over each text node gives the
   lines), when an edge falls outside the image, or when a number falls
   outside it anywhere but into the room on its left. The numbers it places
   by are `site/scripts/guide-figure-marks.mjs`'s, the stylesheet's own
   (the test holds the two equal). A target hard against its neighbours'
   text cannot pass: mark the line or the cell that holds it instead;
5. writes `site/public/figures/guides/<slug>/<id>.<en|fr>.<wide|phone>.<light|dark>.webp`,
   removes the files of figures that no longer exist, and writes
   `site/src/guide_figures.gen.ts` (each image's size, the viewport it was
   laid out at and each mark's box in percent of the image), which the page
   reads.

It prints one line a figure: its sizes and the scale the guide shows it at.
It stops with an error, and changes no file, when a region or a target is
missing or not visible at some language, width or theme, when light and dark
lay out apart, when a figure's text would show below 0.85 of its size, or
when a mark would cover text (all such marks of the run are named at once).
`npm run figures -- --check <folder>` then loads each guide that holds
a figure at 1440 and 390 px, light and dark, in both languages, fails on a
sideways scroll, a figure showing the wrong file or the wrong number of
marks, or a fetched file of the hidden theme, and saves each figure as it
shows into the folder, again with a fresh browser for each page it loads.
Each browser runs on a debugging port nothing else answers on, so another
headless browser on the machine is never touched. It is closed before the
next opens and on every way out, with its whole process tree; any process
still carrying its debugging port or profile is stopped, and its profile is
removed.

The browser's WebP encoder is lossy at every quality; the tool uses 90.

Run the tool again whenever a pictured page's layout or wording changes, a
sample record changes, or a figure's page, region or marks change.
`site/test/guide-figures.test.ts` fails until it is run: it holds the
positions file to each figure's page, region and targets, fetches all eight
files of every figure through the assets binding, finds no file that belongs
to no figure, and checks the drawn page and the stylesheet.

### On the page

The page draws both themes' pictures and the stylesheet shows the reader's
theme's (a lazy image that is not shown is never fetched), each with its
phone file below 700 px, with its width and height so nothing shifts. The
marks are the page's own, placed over the image in percent of it, so they
follow the theme and stay sharp: each is the field's own box, with a 2 px
emerald edge drawn 3 px out from the field, and its number in a 20 px square
to the left of the edge, its top level with the edge's top. The frame is
indented 8 px, so a square on a field at the image's left edge hangs into the
indent and the column's 16 px padding and stays 2 px clear of the column's
edge. The marks are hidden from screen readers, and the numbered legend under
the image says each mark's sentence as page text. The images are static
files and never reach the Worker.

## What a guide ends with

A guide may declare an `action`: the email list it is about (a kind and a
list page's address, as `interestFilter` in `site/src/pages/interest.tsx`
reads them) and one sentence in each language. For a reader not signed in,
while the accounts switch is on, the page draws it after the last section and
before the sources, the same for every such reader: a band
"Email Lists", the sentence with the link to `/alerts`, and the lists' own
form (`InterestBody`), which posts to `/interest` as on the list pages and
saves the list it was served with. Its line offering Pro is left out, since
a guide links no account page. With the switch off, or for a signed-in
reader, a guide is as it was. The sixteen guides: the bidding, evaluation, debriefing and bid challenge, tender notice,
trade agreement, Buy Canadian, Small Business Procurement Program, security, defence supplier cyber security
certification, supplier integrity and set-aside guides save every new tender notice; the ACAN guide and the guide on contracts awarded without competition the new notices of the type Advance
Contract Award Notice, and the standing offers guide those of the type Request for
Standing Offer, each while the open notices carry that type (otherwise
every new tender notice, as on the tender list); the three-records and
contract-end guides the contracts within 3 months of their end. A plain list
reads no file; a list of one type reads the open notices' facets.

## What a guide says

A guide explains the rules and the records. It never says how to win, never
recommends bidding or not, gives no legal advice, names no other commercial
service and criticizes no buyer or supplier. It may name what is free and
what is Pro in figures, in plain words, with no chip and no sales language.
Every guide ends with its sources, the day they were checked and the line
that the official sources govern.

## Where the section is linked

The rail's Browse group and the footer link the index, on every page. The
Worker writes `/sitemap-guides.xml` from `GUIDES`: the index and each guide
in both languages, each dated by its check, and the sitemap index names that
part, so a new guide needs no pipeline change. The views count each guide at
its own address.

The record and list pages link the guides that explain them, in one line at
their foot (`site/src/guide_links.tsx`): "Guides:" ("Guides :" in French)
and one to three guides by the titles the index gives them, a middle dot
apart, in the muted small type of the page's other closing notes. Each kind
of page has one rule, a pure function of fields the page has already read,
so the line adds no query and no file read. The most specific guide comes
first, no guide appears twice, and a guide the page already links in its
body is left out.

| Page | Guides, in order |
|---|---|
| Tender notice | Advance contract award notices, for a notice of that type; standing offers and supply arrangements, for a request for either; then reading a tender notice and bidding; then trade agreements when the notice names one and there is room |
| Award notice | Contracts without competition, when the page's competitive flag reads non-competitive; the three records of one contract; debriefings and bid challenges |
| PSPC contract history record | The same first two; when a contract ends, if its end date is on or after the data date and the record is not cancelled |
| Published contract | Contracts without competition, when non-competitive and the page shows no section 6 exception (that note links the same guide); Indigenous set-asides, for a set-aside under the strategy; the three records; when a contract ends, if its end date is on or after the data date and there is room |
| The radar, every view that lists contracts | When a contract ends; the three records |
| A standing offer or supply arrangement | Standing offers and supply arrangements |
| `/tenders` (any filter) and `/tenders/new` | Reading a tender notice; bidding |
| `/awards` and a year's list, `/awards/<year>` | The three records; debriefings and bid challenges |

A notice's type is read by the tender list's own type filter (`isNoticeType`
in `site/src/data.ts`), the filter the ACAN and standing offers guides save
their email lists by, so a notice gets its type's guide exactly when the list
filtered by that type holds it. The line sits after the page's last panel and
before its provenance or source line; on a list, after the table and its
pager and before the email list. A page with no record (not found, no data,
the records database loading or failing) shows none, and the profiles, buyer
pages, account pages, the landing page and the guides carry none. A guide's
address is one constant in `site/src/guides.ts`; the tests hold every rule's
result to the guides `GUIDES` lists (`site/test/guide-links.test.ts`).
