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
pages through the alternates and, from this pass, the sitemaps.

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
either. Examples: "Award Watch: Federal Tenders, Awards and Contracts
Ending", "Open Federal Tenders from CanadaBuys", "Federal Contract Awards:
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
| Home | `Organization`: Allwater Software Inc., publisher, with the site's mark as logo and its British Columbia address region; `WebSite` with a `SearchAction` on the site search |
| Data | one `Dataset` for the whole site, with a `Dataset` part for each downloadable set (open tenders, award notices, PSPC contract history, published contracts and grants by year, organizations, buyers, contracts ending within 3 months), each with its files, its licence (Open Government Licence, Canada) and the government dataset it is read from |
| Pro | `Product` with one `Offer` a billing period, in Canadian dollars, taxes not included (only while the checkout is configured); `FAQPage` with the page's questions word for word |
| Record pages | `BreadcrumbList` (tenders, awards, PSPC history, published contracts, organizations, buyers, segments, directory pages) |

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

**Sitemaps.** `/sitemap.xml` is an index of two kinds of part:

- the export's parts, now 25,000 pages each, served with every page twice,
  English then French, each entry carrying the alternates of both, so a part
  holds at most the protocol's 50,000 addresses; the Pro page, the
  same-day page and the analytics index are listed with the fixed pages;
- 128 parts for the published contracts, `/sitemap-contracts-1.xml` to
  `/sitemap-contracts-128.xml`, read from the records database. Each part is
  a fixed slice of the record key, so its address never changes and it holds
  about 10,000 contracts (20,000 addresses with French). The scheme has room
  for 3.2 million contracts before a part reaches 50,000 addresses. The
  index lists these parts only while the records database is ready; during a
  reload a part answers 503 with a retry time, and a crawler comes back.

In all, about 3.4 million addresses: 2.6 million for the published
contracts and 0.8 million for everything else, each language counted.

**Home page.** The lead says what a reader can do and how many
organizations have a page (from the nightly figures). Below the cards, a
short "What You Can Do Here" section has four lines, each led by its link:
watch tenders, find who wins, see what ends soon, and get it by email with
Pro.

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
