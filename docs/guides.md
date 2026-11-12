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
  list (`terms`) or a table. Every piece of text carries its English and its
  French side by side.
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
7. Run the tests. `site/test/guides.test.ts` holds the two languages to the
   same sections, links and figures, requests every link inside a guide and
   finds its fragment, checks that every source is an https page on a
   government domain, and checks the result-list tags, the sitemap, the
   absence of account links and Pro marks, and the writing rules a test can
   check (no em-dash or en-dash, none of the banned words, no question).
   A link to a page the records database serves, such as a published
   contract, needs that row seeded in the test, as the guide on set-asides'
   example contract is.

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
