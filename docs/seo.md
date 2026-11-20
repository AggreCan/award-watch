# Search: how readers find the site

What a search engine sees of Award Watch, who searches for what the site
holds, and which page answers each search. The goal is plain: a person who
would pay for Pro should land on the page that does the job they searched
for, and the paid plan should be findable by name. Audited 2026-11-05.

## Audit

What was in place before this pass, and what it lacked.

**Titles and descriptions.** Every indexable page already carried a title,
a description, a canonical address, language alternates, Open Graph tags
and, on record pages, a breadcrumb trail as structured data. The fixed
pages' titles named the data rather than the task ("Open Federal Tender
Notices", "Organizations Receiving Federal Money"). Eight of the 38 fixed
titles (19 pages, two languages) ran past 60 characters, where a result list
cuts them: the buyers page at 74 in English and 76 in French, the French home
page at 80. Three descriptions ran past 155.

**French addresses.** A French page is the same path with `?lang=fr`; a
cookie remembers the choice for later visits. Each version names itself as
canonical (the plain address for English, `?lang=fr` for French) and lists
both, plus `x-default`, as alternates. Crawlers carry no cookie, so the plain
address always serves English to them. This is a crawlable scheme and it
keeps every existing link working. A `/fr/` prefix would double the routes
and give a crawler nothing it lacks today, so the scheme stays. The
language switch in the top bar is `nofollow`; crawlers reach the French
pages through the alternates and, from this pass, the sitemaps. On a page
that answers 200 the switch keeps the page's own query and changes `lang`
alone (a list's filters, the emailed sign-in link's token, `next` and
`follow`), and the tender list's script keeps it in step as the filters
rewrite the address; on any other answer it is the plain `?lang=`.

**Sitemaps.** The nightly export listed each page once, by its English
address, 50,000 to a file. No French address appeared in any sitemap. The
published contracts, which have had a page each since 2026-11-04 (about 1.3
million), were in none either. There was no page describing the paid plan.

**Structured data.** The home page named "Award Watch" as the publishing
organization, with no logo, and described the site without its search. The
Data page carried one Dataset for all the downloads. Nothing described Pro
or its price.

**Social cards.** Shared links showed the 180 px touch icon, with no Twitter
image and no alternative text.

**robots.txt and llms.txt.** Sound. Crawlers are kept off the API, the
search results, the account and operator pages, the analytics views and the
filtered query forms; training crawlers are refused; the sitemap is named.
Neither file needed a change beyond a line in llms.txt naming the Pro page.

**Home page.** The lead listed the sources rather than what a reader can do
with them.

## Who searches, and what for

From searches run on 2026-11-05 and the pages comparable services rank with.
Tender alerts on CanadaBuys itself are free, so a reader pays for what the
free feed lacks: notices the same day, contracts coming back to market with
their holders, and who wins in a field. The terms below are the reader's, in
both languages; the last column is the page that answers.

| Intent | English searches | French searches | Page |
|---|---|---|---|
| Find open federal tenders | federal tenders Canada, CanadaBuys tenders, government RFPs | appels d'offres fédéraux, avis d'appel d'offres AchatsCanada | `/tenders`, `/tenders/new` |
| Hear about a notice the day it is posted | CanadaBuys alerts, tender alerts by email | AchatsCanada alertes, alertes appels d'offres par courriel | `/pro`, `/tenders/same-day`, `/alerts` |
| See who won | who won a government contract, contract award notices | contrats attribués gouvernement du Canada, avis d'attribution | `/awards`, award pages, organization profiles |
| Contracts coming back to market | contracts expiring, federal contract renewals, recompete, incumbent | contrats qui prennent fin, renouvellement de contrats fédéraux | `/expiring` and its three windows, `/pro` |
| A competitor's or a supplier's record | supplier contract history, competitor contract awards | historique des contrats d'un fournisseur | organization profiles and their record tables |
| A department's spending and suppliers | department contracts, PSPC contracts, DND contracts | contrats d'un ministère, contrats de SPAC | `/buyers` and buyer pages, `/analytics` |
| Contracts over $10,000 | proactive disclosure contracts, contracts over $10,000 | contrats de plus de 10 000 $, divulgation proactive | published contract pages, buyer pages, `/data` |
| Work in one category | UNSPSC tenders, IT tenders, construction tenders | appels d'offres par catégorie | `/segments` and segment pages |
| Lobbying behind a supplier | lobbying registry search, lobbying communications | registre des lobbyistes, communications de lobbying | organization profiles |
| Data for analysis | federal procurement data CSV, contracts API | données d'approvisionnement fédéral | `/data` |
| A paid tool for all of the above | government procurement intelligence Canada | renseignement sur les marchés publics fédéraux | `/pro`, `/` |

Two limits on the words the site uses. The radar's pages describe end dates
and never advise, so they never say "opportunity" or "recompete" (the Pro
page alone may say "recompete", by the operator's ruling of 2026-11-05); their
titles say "contracts ending" and "incumbents", which cover the same
searches. And no other service is named anywhere on the site.

## What the site does now

**Titles and descriptions.** The home page and each section page name the
task in the result list, within 60 characters for the whole title and 155
for the description, in English and in French, and no two pages share
either. Examples: "Award Watch: Canada's Federal Tenders, Awards and
Contracts", "Open Federal Tenders from CanadaBuys", "Federal Contract Awards:
Who Won", "Federal Contracts Ending Within 12 Months". The page headings are
unchanged; only the result-list text moved.

Since 2026-11-08 the home page's description says what the site holds,
names both sources and says the site is free: "Every federal tender, award
and grant in Canada (CanadaBuys, open.canada.ca), in one place. Who won, and
what ends within a year. Free, updated nightly." (152 characters). The
French carries the same points in 155: "Appels d'offres, attributions et
subventions fédéraux (AchatsCanada, ouvert.canada.ca). Qui a gagné, ce qui
finit d'ici un an. Gratuit, mis à jour la nuit." Pages with no description
of their own (errors, the thank-you page) and the `WebSite` markup carry
the same text.

**The landing page.** Since 2026-11-08 the address `/` shows a reader
without a signed-in session (every crawler among them) the landing page
(`docs/landing.md`) and a signed-in reader the app home. Both carry the
same head: the title and description above, the canonical address, the
language alternates, the social card and the `WebSite` and publisher
markup, so the result-list text and the structured data for `/` are
unchanged; a test holds the two heads equal.

**The overview, `/overview`.** The original home is at `/overview` for every
reader, signed in or not. It is a section page in the result list: the
title "Today's Federal Tenders, Awards and Contracts Ending" ("Appels
d'offres, attributions et fins de contrat du jour"), a description that
calls it the day's overview (open tenders by province on the map, the
notices new today and closing soon, the newest awards and the contracts
ending within 3 months), its own canonical address and language pair, and
no structured data. It is listed in the sitemap with the data date, after
`/`.

**The Pro page, `/pro`.** What Pro includes, each line a feature the plans
grant; who it is for; what stays free; the price as the billing page prints
it (from the two price figures the site is configured with, taxes added at
checkout); four to six plain questions and answers; and the sign-in button.
While a checkout cannot be made, the page names no price. The page answers
only while accounts are open. The footer links to it on every page, and a
reader who is not signed in finds an "About Pro" button beside the sign-in
button of each tease panel. The side menu is unchanged.

**Structured data.**

| Page | Markup |
|---|---|
| Home | `Organization`: Award Watch, publisher, with the site's mark as logo and its British Columbia address region; `WebSite` with a `SearchAction` on the site search |
| Data | one `Dataset` for the whole site, with a `Dataset` part for each downloadable set (open tenders, award notices, PSPC contract history, published contracts and grants by year, organizations, buyers, contracts ending within 3 months), each with its files, its licence (Open Government Licence, Canada) and the government dataset it is read from |
| Pro | `Product` with one `Offer` a billing period, in Canadian dollars, taxes not included (only while the checkout is configured); `FAQPage` with the page's questions word for word |
| Record pages | `BreadcrumbList` (tenders, awards, PSPC history, published contracts, organizations, buyers, segments, directory pages) |
| Guides | `BreadcrumbList`, and an `Article` with the guide's title and summary, its language, the publisher as author and publisher, and the day the guide was last checked against its sources as `dateModified` |

Google retired the sitelinks search box in 2024 and shows FAQ results only
for a few government and health sites, so the `SearchAction` and the
`FAQPage` will not change Google's result layout. They stay valid markup that
other engines and assistants read.

**Language alternates.** Every indexable page lists `en`, `fr` and
`x-default`, and both versions name the same three addresses, so each pair
confirms the other.

**Social cards.** Since 2026-11-08 every page shares one 1200 by 630 card:
the wordmark, the line "Find your next federal tender. See who won the last
one." and the map of open tenders by province. The tags give its type, size
and alternative text in the page's language ("Award Watch: federal tenders,
awards and contracts in Canada"), and the Twitter card is the large-image
kind. The 512 px square mark stays the publisher's logo in the structured
data, where a square logo is wanted.

**Sitemaps.** Since 2026-11-20 `/sitemap.xml` is an index of parts in the
order a search engine should read them, because a young site gets few
fetches a day and what comes first is what gets crawled:

1. `/sitemap-open-tenders-<n>.xml`: every tender notice open on the data
   date, newest first, each dated by the night its newest version appeared.
   A notice leaves the part the night after it closes.
2. `/sitemap-pages-<n>.xml`: the home page, the overview, the lists, the
   rankings, the buyers, the segments, the award years, the radar's windows,
   the directory pages and the standing offers and supply arrangements. A
   list page is dated by the night what it shows last changed; the overview,
   the Pro page, the same-day page and the analytics index are listed with
   the fixed pages.
3. `/sitemap-guides.xml`: the guides' index and each guide, each dated by the
   day it was last checked against its sources. The site writes it from the
   guides themselves, so a new guide is listed without a change to the
   nightly export.
4. `/sitemap-active-organizations-<n>.xml`: the organizations with an award
   notice, a contract history record or a published contract dated within
   the last 24 months, the most recent first.
5. `/sitemap-other-organizations-<n>.xml`: every other organization.

An organization is dated by the night a figure on its profile last changed.
Each part holds 25,000 pages and serves every page twice, English then
French, each entry carrying the alternates of both, so a part holds at most
the protocol's 50,000 addresses.

The published contracts' 128 parts, `/sitemap-contracts-1.xml` to
`/sitemap-contracts-128.xml`, are no longer in the index: they were about 2.7
million of the 3.4 million addresses it offered, and readers from a search
arrive on organization and tender pages. The parts still answer at their
addresses, read from the records database (503 with a retry time during a
reload), and the contract pages are unchanged and linked from the
organization and buyer pages. Listing them again is a one-line change.

In all, about 0.67 million addresses, each language counted: about 2,000 for
the open notices, 12,000 for the site's own pages and 660,000 for the
organizations.

**Links into the guides.** The record pages (a tender notice, an award
notice, a contract history record, a published contract, a standing offer)
and the tender, award and radar lists end on one line, "Guides:", that links
one to three guides chosen by what the page shows: the notice type, the
competitive flag, a set-aside, an end date still to come. Most readers from
a search engine land on a record page; before the line, a guide was linked
only from the index, the rail, the footer and other guides. The line names
each guide by its own title, never links a guide the page already links,
and adds no query and no file read to the crawled pages. The guides page
of the docs holds the rules.

**Home page.** The lead says what a reader can do and how many
organizations have a page (from the nightly figures). Below the cards, a
short "What You Can Do Here" section has four lines, each led by its link:
watch tenders, find who wins, see what ends soon, and get it by email with
Pro.

## Profile titles

The first Search Console reading (2026-11-01 to 2026-11-13: 70 clicks, 3,719
impressions) showed where the site is found: of 262 queries Google named, 253
were the names of organizations, each landing on a profile. Nine were
descriptive searches, low on the fifth page or lower, and none held the
site's own name.

A profile's title therefore says what the organization holds, in the words
a person adds to a name when they want this page: "Federal Contracts" for a
supplier, "Federal Grants" for a recipient of grants and contributions,
"Federal Contracts and Grants" for an organization that is both (in French
"contrats fédéraux", "subventions fédérales", "contrats et subventions
fédéraux"). The name comes first and is never changed; a long name drops
the site's name, then the words, to stay within 60 characters. A buyer's
title is unchanged.

## The site's name

Checked 2026-11-15. A search for the site's two words returns another site,
long established and global in scope, whose name is one letter away and
whose subject is unrelated. That search is not one to win: the name is
theirs in most readers' minds. The searches that are this site's own are
the name with what it covers ("Award Watch Canada", "Award Watch tenders"),
the name written as one word, and the domain. Google's page on site names
says what it reads and what it does with two sites of one name:

- It takes the name from the home page: "add WebSite structured data to
  your home page", and it "will also consider content in `og:site_name`,
  `<title>`, heading elements, and other text on a home page. However,
  `WebSite` structured data is most important".
- "our system generally won't use the same site name for two different
  sites that are global in nature", and when the preferred name is not
  taken "it may sometimes generate site names using other sources or show a
  domain or subdomain name".
- "You can list more than one alternative name. Specify them in order of
  your preference, with the most important one listed first", and the
  domain, in lower case, may be the last: "Our system will strongly consider
  using it if your preferred name isn't selected."

So, since 2026-11-15:

- The home page's `WebSite` markup keeps `name` "Award Watch" and adds
  `alternateName`: "Award Watch Canada", then "AwardWatch", then
  "awardwatch.ca". If the engine sets the plain name aside, the next it is
  offered says the country.
- The English home title says the country beside the name: "Award Watch:
  Canada's Federal Tenders, Awards and Contracts" (59 characters). The
  French one already ended "du Canada". The contracts ending keep their
  place in the description, the overview's title and the radar's own pages.
- The About page's description says what the site is in one line ("a
  Canadian site of federal tenders, contract awards and grants, by
  organization"), since that page is the publisher's address in the markup
  and a likely result for the name with "Canada".

The publisher's markup names the site itself, since 2026-11-15:
`Organization` is Award Watch, with no `legalName` and no `sameAs`. Google's
page on that markup asks for the name the organization goes by, and every
page of the site goes by this one. The corporation that publishes the site
is named in the text of the About, Terms and plan pages, where a reader
looks for it, and nowhere in the markup.

What the markup cannot do: move the site above the other for the two words
alone, or make a new domain rank for the descriptive searches of the table
above. Google's starter guide: it "primarily finds pages through links from
other pages it already crawled", and "you likely want to wait a few weeks
to assess whether your work had beneficial effects".

## Left for the operator

1. Verify `awardwatch.ca` in Google Search Console and in Bing Webmaster
   Tools (one DNS record each, described in the search engines guide), then
   submit `https://awardwatch.ca/sitemap.xml` in both.
2. Expect most published-contract pages to sit under "Discovered, currently
   not indexed" for weeks. A new domain with 3.4 million addresses is crawled
   in proportion to the links and visits it earns; the parts make the pages
   known, not indexed.
3. Run Google's Rich Results Test on `/pro` and `/data` once the deploy is
   live, and the URL Inspection tool on one page in each language.
4. Done 2026-11-08: the 1200 by 630 card replaced the square mark as the
   shared image. Check one page in a card validator (or by sharing a link)
   once the deploy is live; platforms cache a card for days.
5. Done 2026-11-06: the Pro page says "recompete" (its "who it is for" line,
   a question, the description); the radar's pages still never do.
