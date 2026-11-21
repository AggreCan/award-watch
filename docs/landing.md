# The landing page

The address `/` answers in two ways. A reader with a signed-in session gets
the app home (`site/src/pages/home.tsx`): the map, the tiles and the day's
lists inside the railed Console shell. Anyone else, crawlers included, gets
the landing page (`site/src/pages/landing.tsx`), a document of its own that
says what the site holds and how to use it. `rootPage` makes the choice:
while the accounts switch is off, or without the session cookie, nothing is
read and the landing page answers; otherwise `readSession` decides, and a
session the accounts database cannot confirm during an outage gets the app
home. Both answers carry `Vary: Cookie` while the switch is on
(`varyOnCookie`), so a cache never hands one to the other's reader. The
landing page is cached publicly for 5 minutes, as other pages are.

The landing page carries the app home's head (title, canonical address,
language pair, social card, publisher and `WebSite` markup) with a
description of its own in the three description tags and the `WebSite`
markup (`seo.ts landingSeo`, since 2026-11-20): "Federal tenders, who won
them and the contracts ending soon, from CanadaBuys and open.canada.ca, read
nightly and joined by organization. Free to read." A crawler carries no
session, so this is the text a result list shows for `/`. The app home a
signed-in reader gets at `/`, and the pages with no head of their own, keep
the home page's description (`PAGES.home`).

The original home is at `/overview` for every reader (operator, 2026-11-08):
signed in or not, in both switch states, `overviewPage` answers with the app
home's body, cached as `/` caches it for that reader (public for 5 minutes
without a session, `private, no-store` once the shell names a signed-in
address, `Vary: Cookie` while the switch is on). Only its head differs: its
own title ("Today's Federal Tenders, Awards and Contracts Ending", "Appels
d'offres, attributions et fins de contrat du jour"), a description that
calls it the day's overview, the canonical address `/overview` with its
language pair, and no structured data; the `WebSite` and publisher markup
stays with `/`. The landing page's nav (first, before Tenders) and the
footer of every page link to it as "Overview" ("Vue d'ensemble"), the rail
group's own word (`rail.index`). The rail marks no item there, as at `/`. It
is in the sitemap with the data date, and the views count it as its own
route.

## What it shows, and what it reads

In order: the nav (the wordmark, Overview, Tenders, Awards, Contracts ending,
and with the switch on Analytics and Pro; the language and theme switches;
Sign in; "Track tenders free"), the hero (the claim, the search box, the Canada map
of open tenders), the scrolling band of forty organizations, four figures,
three feature bands each with a product shot, with the switch on a fourth on
matching notices, with `BUILDER_DEMO` and the builder's own switch on a band
on the analytics builder and the dashboard (below, *The builder's band*), the
three steps, the plan cards, the closing band and the site's footer links.

What the copy states is what the product does, and every figure in it is
read when the page is drawn, never typed into a string (the landing pass of
2026-11-20): the open count and the data date from `stats.json` (the map's
head, the tenders button, the closing band's heading "854 federal tenders
are open."), the plans' figures from `RULES` (the matching notices' line,
Free's watches beside the weekly email, Pro's years and watches), the
guides' count from `src/guides.ts` `GUIDES`, the radar's windows from
`EXPIRING_WINDOWS`, the nightly's hour and the same-day cadence from
`src/refresh.tsx`. The records are described as what they are: the
Government of Canada publishes them on CanadaBuys and open.canada.ca under
the Open Government Licence (the lobbying records on the Registry of
Lobbyists), and the site reads them every night and joins them by
organization. No source is called complete, the search box is not said to
search the records' text (it finds organizations and buyers), and nothing
behind a switch that is off (the analytics builder, seats) is named. The
bands link the guides (beside the tenders) and the monthly record (beside
the contracts ending).

| Part | Source |
|---|---|
| Map | `stats.json` `map.open`: a province's fill is one of four steps on the app home's scale (`mapStep`), its count is its label; the not-stated line is `map.open.not_stated` |
| Figures | `stats.json` `counts` (published contracts, grants, organizations, award notices, lobbying records, buyers) and `totals.awards_year`; a count from a million up shows as "1.34M" with the exact count as its title |
| New today | `stats.json` `new_tenders`, still open at the page's clock |
| Awarded, last 30 days | `stats.json` `recent_awards`, newest first, and `counts.awards_30d` |
| Ending within 3 months | `expiring/index.json` for the count, the first page of the 3-month window (`expiring/3m/1.json`) for the rows, soonest first |
| Profile shot | the profile of `stats.json` `top_organizations_year[0]`, the organization with the largest award value this year, cut from its shard (`loadProfile`) |
| Band | `site/src/landing_orgs.ts`: forty ids, names and domains |
| Matching notices' example | fixed sample values in `landing.tsx` (`SAMPLE_BLOCK`, `SAMPLE_NOTICE`), scored by `public/fit.js` at render; no file |
| Builder's band (`BUILDER_DEMO` and `BUILDER` on) | the builder's own view (`bandChoice`, the address `builder.ts buildLink` gives for one buyer): National Defence's published contracts, value by fiscal year, the eight fiscal years to the data date's, read with the builder's statements (`builder_sql.ts buildPlan`, `CUBE_META_SQL` first) in one batch of the records database; the buyer's name from `buyers/dnd-mdn.json` (`loadBuyer`) |

A missing `stats.json` gives the no-data page (503), as on the app home. Any
other missing file leaves its part out (the map card, a shot, the profile,
the builder's band) and the page answers 200. Without the builder's band the
page reads no database; with it, one batch of the records database. It reads
neither deep window of the radar (`test/landing.test.ts`,
`test/radar-gate.test.ts`).

The figures' note ("Counted on <data date>.") is on every form of the page:
the nightly's and the site-only deploy's smoke test fetches `/` without a
session and looks for tonight's data date there (`DATED_PAGES` in
`pipeline/awardwatch_pipeline/resilience.py`).

All copy is in `site/src/i18n.ts` under `landing.*`, in English and French.
The search box is a plain GET form to `/search` with the site's own wording.

## The accounts switch

With the switch off nothing is Pro and there are no accounts, so the page
leaves out the plan cards, the Pro lines under the feature bands, the hero's
"See the plans" and its note on accounts, the sign-in button and the nav's
Pro and Analytics links; the footer has no Pro or Analytics link either.
"Track tenders free" leads to the Atom feeds, the third step names the feeds
and the browser watchlist, and the profile shot shows the watchlist button.

With the switch on the page adds, after the companies' band, a band on
matching notices: name your organization in a free account and the site
ranks the open notices by what each has in common with its award notices
and contract history, every reason shown. Its one action, "Name your
organization", leads to `/account/sign-in?next=%2Faccount%2Forganization`; a
line states Free's and Pro's figures from `RULES` (matches listed, matches a
week by email). Its card is one match as `/account/matches` draws it (the
band, the points out of 100, each reason with its record counts and points)
for a made-up organization and notice, under the head "Example, with sample
values", with the matching notices' disclaimer. It reads nothing.

With the switch on the page adds the three plan cards: Free and Pro draw
every row of `PLAN_ROWS` in order, as the Pro page does, Pro with its price
from the checkout's figures (or "Not on sale yet"); Ultra, in sapphire with
the 2 x 2 tiles chip, reads "Price to be set" and "Coming soon", lists
"Everything in Pro" and Ultra's own lines with its figures (the saved views
by email among them since they shipped; the analytics builder's line only
while its switch is on, and no "planned" line since 2026-11-20), and ends on
a one-field form in place of a button (below).
Once Ultra is on sale (docs/accounts.md, *Ultra*) the card shows its monthly
figure large with the yearly beside it, "For people who follow a whole
market.", "Everything in Pro" and Ultra's own lines with its figures from
`RULES`, and Subscribe to Ultra, outlined in sapphire, through the sign-in
page to the billing page's Ultra panel; the form leaves the card, and the
addresses it kept stay for the Ultra message. The chips sit on the plan
cards only. Every piece the switch changes is
listed in `LANDING_SWITCH_PIECES` (`site/test/home.ts`); the switch guards
strip them and hold the rest of the page equal in both states.

On a phone (640 px and under) the three cards sit side by side and the
reader swipes from one to the next (the operator's ruling of 2026-11-20). A
card takes 86% of the width, so the next shows at the edge; the row scrolls
inside its own box and snaps to a card, and the page never scrolls sideways.
The line "Swipe to see each plan." (`landing.plans_swipe`) shows above the
cards on a phone alone. The plan cards wherever `PlanCards` draws them (the
Pro page, the billing page, the dashboard's and the seats page's offers)
swipe the same way at 699 px and under (`public/styles.css`, `.plan-cards`),
and a line of a narrow card wraps. `site/test/plans-swipe.test.ts` holds both.

Each row that scrolls is `position: relative`, so it is the containing block
of what is positioned inside it. The cards hold words for a screen reader
(`.visually-hidden`, `position: absolute`); placed by the page, each sat out
where its card is in the scrolled row and let a phone pan the whole page
sideways (found 2026-11-21, measured in a browser at 390 px). On the landing
page every card's lines wrap at every width: from 1001 px a card's text
column is narrower than the longest lines, which one line would cut with an
ellipsis (version 9).

## The builder's band

A band that shows the analytics builder and the dashboard at work, behind
its own switch: `BUILDER_DEMO` in `site/wrangler.jsonc`, read by
`builderDemoOn` in `landing.tsx`. It ships "on" since 2026-11-20 (the test
suites start it "off", `site/vitest.config.ts`), and the band shows only
with "on" and the builder's own switch on too (`plan.ts builderOn`: `BUILDER`
"on" with the accounts switch), so the page never pictures a builder a
reader cannot open. With anything else the page is byte for byte as it is
without the band, reads nothing more and names no builder. The band is where
the landing page shows the builder and the dashboard; no other part of the
page names either (operator, 2026-11-15 and 2026-11-20).

It sits after the band on matching notices and before the three steps: the
feature bands run from what a reader gets free to what a free account gets
to what Ultra adds, in the plans' order, and its link ("See what Ultra
holds", "Voir ce que comprend Ultra") leads to Ultra's card in the plan
cards below (`#ultra`). Left, as every feature band: the eyebrow "Analytics
builder" in Ultra's sapphire as plain words (no chip; chips stay on the
rail, the tabs and the plan cards), the heading "Build the view you need."
("Composez la vue qu'il vous faut."), a paragraph and three points. The
first point says what the builder's menus offer (`public/build-menu.js`
`MATRIX`): buyers, segments and organizations by fiscal year, buyers and
segments by quarter, province or method. The third point is the plan cards'
own dashboard line for Ultra (`PLAN_ROWS`, the row with `feature:
"dashboards"`, written by `planLine`) followed by "on Ultra" ("avec Ultra"),
so it states what Ultra holds whatever that line becomes. The band adds no
filled button.

Right, a picture of the builder (`BuildStage`), hidden from assistive
technology and followed by a visually hidden description in the page's
language. Every word in it is the builder's or the dashboard's own, read
from their keys: the builder's title, its form's menus in their order (Buyer,
Rows, Source, Show) and its Show this view button; the result's title (the
builder's `viewTitle`, "Value by fiscal year"), the buyer it is about, its
Add to dashboard, its table and its line on the source, the period and the
data date (`build.as_of`); the dashboard's title, its "Saved." status, the
heads of two other tiles (the Add a Tile kinds "Saved search: open notices"
and "Contracts ending") and the new tile's head, table and foot (the
source and period as `analytics.lead` writes them, "4 of 8", Open). One
timeline of 24 seconds, pure CSS (`public/landing.css`, the block "the
builder's band"), no script: the reader opens Source and picks Published
contracts, opens Buyer and picks the buyer (until then the result says
"Choose a buyer from the list to see its figures.", as the builder's does),
and the bars draw; opens Show and picks Line, then opens it again and picks
Table; the result's Add to dashboard puts the table on a dashboard as a tile showing
its first four rows, which is dragged by its grip to the top while the other
tiles move down, and widened from its corner; "Saved." The two other tiles
are placeholders with no figure.

A menu opens under its field at a click, and a click on an option closes it
with that value; a ring at the pointer's tip marks each click. An open menu
lists what the builder's own menu offers for the band's view, in the
builder's order: Source's from `sourcesFor` and Show's from `showsFor`
(`public/build-menu.js`, through `menuSources` and `menuShows`). Buyer's
lists the empty choice and the buyer by name (row `BUYER_ROW`) among rows
with no name, because the page reads one buyer's file and no list of buyers.
A highlight steps down the options with the pointer, from the value the
field holds to the row picked; the stylesheet's steps and the pointer's
stops are set to the rows in `MENU_ROWS`, and
`site/test/landing-builder.test.ts` holds those rows against the builder's
menus, so a change to what the builder offers fails there until the
stylesheet follows. Nothing in the picture is typed: the builder's Buyer,
Source and Show are menus (the builder's one typed field is an
organization's id, which the band's view does not use). `--scrub` (seconds) on `.bd` holds the
timeline at a moment and `.is-paused` stops it, for a test or a capture; a
reader who asks for reduced motion sees the finished dashboard as a still
(`--scrub: 23`).

The figures are the builder's own view of National Defence (`BUILD_BUYER`):
the address `builder.ts buildLink` gives for one buyer (the link a buyer's
analytics view opens in the builder), published contracts, value by fiscal
year, over the eight fiscal years (`BUILD_YEARS`) to the data date's, which
is the year to date. They are read as the builder page reads its view: the
same statements (`builder_sql.ts buildPlan`, here `BUYERS_YEARS_SQL` on the
cube), `CUBE_META_SQL` first, in one batch of the records database, and
written by the builder's own formatters (the axis in the short form, the
table in whole dollars with the records' count, newest first, the data
date's fiscal year marked "(to date)"). The buyer's name in both languages
comes from its buyer file. The chart's geometry is `site/src/landing_chart.ts`
(`buildChart`): one scale for the bars, the line and the three gridlines,
whose step is the smallest round figure that lets them reach the largest
bar. A year with no value in dollars draws no bar and is left out. A buyer
file that does not read (or is another buyer's), a records database that is
absent, loading or failing, a cube not filled yet (no `cube_meta` row), or
fewer than four such years (`BUILD_MIN_YEARS`) leaves the band out, and the
page is then as it is with the switch off.

With the band on the page reads one more file (about 90 KB in production on
2026-11-15, parsed once per isolate and kept by its ETag, as every file is)
and one records batch of three statements. The CPU budget
(`test/cpu-budget.test.ts`) times the landing page with the accounts switch
on and with the band, the buyer file at its production size and the records
answered from memory, both held to the bound "/" has (9).

The band's rules joined `landing.css` while the band is behind its switch,
so the page without it names `landing.css?v=LANDING_VERSION` and a page with
the band adds `&builder=1` (`BUILDER_STYLES`) to the address. The landing
pass of 2026-11-20 changed those rules (the Show menu, the result's Add to
dashboard, the tile's foot) and raised `LANDING_VERSION` to 7; the open
menus and the plans' swipe on a phone came the same day under version 8. When the band
is on for good, fold the mark into a new `LANDING_VERSION`.

**Switched on with the builder on 2026-11-20.** `site/wrangler.jsonc` holds
`"BUILDER": "on"` and `"BUILDER_DEMO": "on"`; the test pool holds both "off"
(`site/vitest.config.ts`), and `site/test/landing-builder.test.ts` holds
both facts. The band shows while the night's cubes are on the records
database. To take the band off, set `BUILDER_DEMO` back to "off" and deploy;
to take the builder off with it, set `BUILDER` to "off" as well.

## The Ultra card's form

One email field and the button "Tell me when Ultra opens" ("M'avertir à
l'ouverture d'Ultra"), with the honeypot every form carries (operator,
2026-11-08: the button became the box). It posts to `/interest` with
`kind=ultra`; `index.tsx` hands such a post to `ultraSubmit` in
`landing.tsx` after `readInterestPost` has refused another site's page, and
the form cap holds the route as it holds every interest post. The address is
normalized and checked as every email list checks it and kept as one row of
the forms database's `interest` table: kind `ultra`, empty `params` (no
filter), the label "Ultra" (the plan's name, the same in both languages),
the form's language and a token. Nothing else is stored, and nothing a
visitor types reaches a later message. The same address again stores
nothing and answers the same.

The answer puts the line "We will write to you when Ultra opens." ("Nous
vous écrirons à l'ouverture d'Ultra.") and the address as kept in the
form's place. `public/interest.js` (loaded inside the plan cards' section,
so it comes and goes with them) posts with the `x-interest-fragment` header
and gets the card's block alone; without the script the answer is the
landing page with the card in its new state, at the form's address
`/interest#ultra`, so the browser lands on the card. A bad address, the
honeypot or a database fault comes back as the form with a line and the
address as typed (400, 400, 503). With the switch off the card does not
exist and such a post is refused as unreadable (400), as an unknown kind is.

The row is not a saved search: an account's import passes it over
(`importInterest`), the accounts-open message neither counts nor names it,
the nightly's count of alert sign-ups leaves it out, and the page that takes
an address off the lists names it "Ultra: we will write when it opens". Its
one message is the Ultra message (docs/accounts.md, *The Ultra message*).

## The logos

Counsel's condition (2026-11-08): company logos may appear in the band as
long as the wording never says "trusted by" or anything like it, only that
the site holds records on these organizations. The band's heading, line and
footnote are fixed in the dictionary and held word for word by the tests:
"We have the records on the companies winning the biggest federal
contracts", "Click one for its awards, contracts, grants and lobbying, year
by year." and "Forty of the largest award holders in the public records.
Names and logos belong to their owners and appear here because the records
cover these organizations. No endorsement is implied." Each name links to
its profile.

The logos come from Brandfetch's Logo API. Its terms (docs.brandfetch.com,
Logo API overview, read 2026-11-08): the logo link is for embedding in an
`<img>` only; each request carries the client id and a Referer; fetching
programmatically or caching the images is not allowed; no attribution is
required; the free tier is 1,000,000 requests a month and 1,000 per 5
minutes per address. So the page embeds, per organization,
`https://cdn.brandfetch.io/domain/<domain>/w/80/h/80/fallback/lettermark?c=<client id>`
at 40 by 40 on a white tile with an empty alt (the name sits beside it).
The site never fetches, caches or stores a logo, and no logo file is in the
repository. The content security policy allows images from
`https://cdn.brandfetch.io` and nothing else from a third party;
Referrer-Policy stays `strict-origin-when-cross-origin`, which sends the
site's origin and no path. While the logos show, the privacy page says that
a visitor's browser fetches them from Brandfetch.

The client id is public by design (it is in each image address) but is
never written into the repository. It lives in the repository variable
`BRANDFETCH_CLIENT_ID`; both deploys (`deploy-site.yml` and the nightly)
pass it to the Worker as `--var BRANDFETCH_CLIENT_ID:<id>` when the variable
is set, and pass nothing when it is empty, in which case the band shows the
names alone. Both must pass it: a deploy without it drops the variable,
since `wrangler.jsonc` does not hold it.

## The stylesheet and the fonts

`site/public/landing.css`, linked with `?v=LANDING_VERSION` (bump the
constant in `landing.tsx` with every change to the file; the builder's
band's rules are keyed by their own mark while the band is behind its
switch, above). It keys light and
dark as `styles.css` does: `data-theme` on the root, set by `public/theme.js`
from the choice saved in the browser (shared with the app pages), else the
system setting. The hero and the closing band stay navy in both modes.

The nav's links show from 1241 px and wrap onto a second line inside the
bar's 64 px when the bar runs short. In French with the switch on, the six
links and four controls need 1,306 px (dark) to 1,327 px (light) against the
1,168 px the 1200 px column leaves (measured in Edge with Inter, 2026-11-08;
1,174 to 1,195 px before Overview joined them, already over), so there the
links take two lines; in English (1,118 px at most) and in French with the
switch off (1,068 px) they keep one.

Display type is Bricolage Grotesque, self-hosted beside Inter:
`site/public/fonts/BricolageGrotesque-Variable.woff2`, from the variable
file in the google/fonts repository (`ofl/bricolagegrotesque`), its width
axis pinned at 100 and its weights cut to 400 to 800 with fontTools, optical
size kept, subset to the same ranges as Inter. It is under the SIL Open Font
License 1.1; the licence travels as `site/public/fonts/BricolageGrotesque-OFL.txt`.
It is declared with `font-display: swap`, in `landing.css` and identically in
`styles.css`, where the app pages set their titles and tile figures in it;
every page preloads it. The static assets layer serves `public/` as it is;
no file there has a caching rule of its own.

## Tests

`site/test/landing.test.ts` holds the route (landing page or app home), both
languages and both switch states, the band's links and wording, the logo
addresses, the policy header, the map labels, the figures, the plan rows,
the search form, the head (the app home's, with the landing page's own
description), the no-data page, the shipped files and the Ultra card's form
markup; and, since the landing pass of 2026-11-20, every line of what the
page says in both languages, each figure following `stats.json` or the code,
and no name of the builder or of seats while their switches are off.
`test/interest-ultra.test.ts` holds the form's post and every reader of its
row. `test/landing-builder.test.ts` holds the builder's band: the switch
shipping "off" and the page byte for byte the same with it off, or on with
the builder's switch off, in both languages and both accounts states; the
band once in each language with every string; each word of its picture the
builder's or the dashboard's own; its figures what the builder's statement
answers (a records database answering from memory with test cells, the
buyer file's yearly figures set on fiscal years), the batch it reads, the
geometry, the fallbacks, the writing and the stylesheet's rules. `test/cpu-budget.test.ts` times the page with the 3-month
window's page at its production size, and with the accounts switch on with
and without the builder's band. The tests of the app home's content
reach it through `test/home.ts`. `test/overview.test.ts` holds `/overview`:
every reader in both languages and both switch states, its body equal to
the app home's for the same reader, its caching, its head, the nav and
footer links and its route in the views.
