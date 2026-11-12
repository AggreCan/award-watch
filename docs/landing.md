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
matching notices, the three steps, the plan cards, the closing band and the
site's footer links.

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

A missing `stats.json` gives the no-data page (503), as on the app home. Any
other missing file leaves its part out (the map card, a shot, the profile)
and the page answers 200. The page reads no database and neither deep
window of the radar (`test/landing.test.ts`, `test/radar-gate.test.ts`).

The figures' note ("Counted on <data date>.") is on every form of the page:
the nightly's and the site-only deploy's smoke test fetches `/` without a
session and looks for tonight's data date there (`DATED_PAGES` in
`pipeline/awardwatch_pipeline/resilience.py`).

All copy is in `site/src/i18n.ts` under `landing.*`, in English and French.
The search box is a plain GET form to `/search` with the site's own wording.

## The accounts switch

With the switch off nothing is Pro and there are no accounts, so the page
leaves out the plan cards, the Pro lines under the feature bands, the hero's
"See Pro plans" and its note on accounts, the sign-in button and the nav's
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
the 2 x 2 tiles chip, reads "Price to be set" and "Coming soon", lists its
planned scope and ends on a one-field form in place of a button (below).
Once Ultra is on sale (docs/accounts.md, *Ultra*) the card shows its monthly
figure large with the yearly beside it, "For people who follow a whole
market.", "Everything in Pro" and Ultra's own lines with its figures from
`RULES`, and Subscribe to Ultra, outlined in sapphire, through the sign-in
page to the billing page's Ultra panel; the form leaves the card, and the
addresses it kept stay for the Ultra message. The chips sit on the plan
cards only. Every piece the switch changes is
listed in `LANDING_SWITCH_PIECES` (`site/test/home.ts`); the switch guards
strip them and hold the rest of the page equal in both states.

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
constant in `landing.tsx` with every change to the file). It keys light and
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
the search form, the head the app home carries, the no-data page, the
shipped files and the Ultra card's form markup. `test/interest-ultra.test.ts`
holds the form's post and every reader of its row. `test/cpu-budget.test.ts` times the page with the 3-month
window's page at its production size. The tests of the app home's content
reach it through `test/home.ts`. `test/overview.test.ts` holds `/overview`:
every reader in both languages and both switch states, its body equal to
the app home's for the same reader, its caching, its head, the nav and
footer links and its route in the views.
