# Mail checks

Two checks cover the mail the site sends to readers, both apart from the
deploy and from the default test suite:

1. The mail suite, `site/test-mail/`: every message rendered in English
   and French through the log sender and held to the same rules. Local, run
   by hand with `npm run test:mail`.
2. The live mail check, `/admin/mail-check`: the deployed Worker sends
   one real message of each template to the operator's test inbox, through
   Cloudflare Email Sending, and answers with each send's result. Run weekly
   by `.github/workflows/mail-check.yml`, and by hand.

The live check never sends to a reader: its one recipient is the address in
`MAIL_TEST_TO`.

No workflow runs either test suite. The default suite (`npm test`) is local
too; the deploys run neither.

## The shell

Every message the site sends to a reader is laid out in one shell,
`site/src/account/mail_html.ts`: the sign-in code, the saved-search
deliveries, the records counts, the watch mail, the weekly briefing, the
weekly email, a saved analytics view, the accounts-open and Ultra messages
and the address-change notice. A new message
is built with it as well; no message writes its own `<html>`.

| Part | What it holds |
|---|---|
| Preheader | one hidden line, the one an inbox lists after the subject |
| Header | the wordmark linking the site, the host name linking the home page, an emerald rule under both |
| Body | the message's own pieces: `h1` (the message's title), `h2` (a section's heading in its band, below), `para` (muted for a note and for the line with a stop link), `list`, `button`, `inkLink`, `mutedLink` |
| Footer | why the message came, with its links (`whyLine`; the address-change notice has no such line; the weekly email adds the sender's name and mailing address on the next line), then the tagline and `contact@awardwatch.ca` |

The layout is design/email's (`design/email/build.py`): a 600 px column of
tables, every style inline, the site's palette, Inter with the system faces
behind it, and dark-mode overrides under `prefers-color-scheme`. The sign-in
code sits in a ruled band at 32 px in a monospace face. A change to the shell
belongs in `design/email/build.py` too, so the review sheet keeps showing
what is sent.

A section's heading opens its list on a band, as a panel on the site opens
on its head band. The messages with sections draw every heading with `h2`:
the weekly briefing's six sections, the records message's two parts, each
watch in the watch mail, the "Your organization" and matching notices
blocks (the watch mail and the weekly email), and a saved view's two parts
(its figures by fiscal year, its largest records). The weekly email's watch
lines and the site's figures sit under the message's title and have no
section heading.

| Part of the band | Light | Dark |
|---|---|---|
| Ground, the column's full width | `#e2e8f0`, 1.23:1 on the white card (the `bgcolor` attribute for Outlook and the inline style) | `#202d44` (`.sect`), 1.26:1 on the card `#111a2b` |
| Left edge, 3 px | the header rule's emerald `#0f7b4f`, 5.29:1 on the card | the same emerald, 3.29:1 on the card |
| Heading, 13 px bold capitals spaced 1 px (the site's 0.08em) | ink `#0f172a`, 14.48:1 on the band | `#e5edf7` (`.ink`), 11.70:1 on the band |

The capitals come from `text-transform`, so the words a screen reader reads
and a reader copies stay as written; a long name wraps inside the band
(`word-break: break-word`). The band has 20 px above it and 8 px below, as
the padding of a cell around it (Outlook keeps a cell's padding and drops a
table's margin), so it reads with the list under it and apart from the one
above. A row's title (15 px, weight 600, as written) is unchanged. The
plain-text part writes the heading in capitals on its own line after a
blank one (`h2Text`): "AWARDS THIS WEEK: 19".

The dark overrides recolour the text classes (`ink`, `ink2`, `muted`) and,
by name, the links inside each: a link carries its own inline colour, which
a rule on the paragraph around it does not reach. The section band's rule
(`.sect`) names its ground alone, so the emerald edge stays. Apple Mail and
iOS Mail apply them; Gmail inverts colours on its own.

What the shell keeps out, for Gmail's Promotions tab and for the reader:

- No image but the two wordmark PNGs from the site's `/brand/`, the same two
  files for every reader, so loading them says nothing about who opened a
  message. No tracking of any kind: no pixel, and no link that records a
  click. The only values that differ from one reader to the next are the
  tokens a sign-in link or a stop link needs to work.
- One button at most, dark ink on the white panel; no coloured background but
  the pale page around the panel and the slate grounds of the code's band
  and the section bands.
- The plain-text part goes with every message, and the list messages keep
  `List-Unsubscribe` with its one-click partner.

The mail suite holds every message to the shell (below).

## The mail suite

```
cd site
npm run test:mail
```

The suite has its own config, `site/vitest.mail.config.ts`, which takes
`test-mail/**/*.test.ts`, and the default config (`site/vitest.config.ts`)
leaves the folder out twice: its include takes `test/**/*.test.ts` only and
its exclude names `test-mail/**`. `site/test/mail-suite-apart.test.ts`, in the
default suite, reads both configs' include and exclude and fails if a mail
file could be picked by `npm test` or a default file by the mail suite. Both
suites run in the same Workers pool with the same bindings and setup file.

Every message goes through the log sender (`site/src/account/sender.ts`): the
path a local run uses, which writes the message to the `sent_mail` table of
the local accounts database. The suite reads the row back and checks what was
stored, so what is checked is what a sender was handed.

### What it renders

Each in English and in French.

| Message | Built from |
|---|---|
| The sign-in code | the sign-in page itself, `POST /account/sign-in` |
| A saved search's tender notices, daily and weekly | the delivery tests' fixtures (`site/test/mail-fixtures.ts`) |
| A saved search's contracts ending, weekly and daily | the same fixtures |
| An organization's new records, a segment's new records and notices | the records digest |
| The watch mail, with and without the "Your organization" block | the watch digest |
| The weekly briefing | the briefing digest |
| A saved analytics view, weekly and monthly, and with no record in its period | the view digest, `viewDigest`, from `viewInput` in `site/test/mail-fixtures.ts` (a buyer's published contracts over five fiscal years) |
| The weekly email: the watches' news (Free and Pro) and the site's week (nothing new on several pages, on one, following nothing, Pro), and with one figure left out | the weekly digest, `weeklyDigest`, from the fixtures in `site/test/mail-fixtures.ts` (a made-up mailing address) |
| The week's matching notices: in the weekly email (the figures and the watches' news, Free and Pro) and in the watch mail (after the "Your organization" block, alone, beside a watch) | `matchesInput` in the fixtures: 12 sample notices ranked by `public/fit.js` against a sample organization's block, drawn by `fit_mail.ts` `matchDigestBlock` |
| The accounts-open message | its console run, `runAnnouncement`, and with an https stop link |
| The Ultra message | its console run (kind `ultra`), and with an https stop link |
| The address-change notice | the console's notice |
| The live check's eleven messages | `site/src/account/mail_check.ts` |

The operator's own alerts (the daily check's email and the bug reports, both
through the `ALERTS` binding to the operator's address) are not reader mail
and keep their own tests.

### What each message is held to

- The subject is present, on one line, and under 100 characters, the live
  check's mark included. A briefing's or a records message's subject names
  the counts that fit, the last ones left out first (the French briefing with
  three counts reaches the limit); a subject built from a long saved filter,
  label or name is cut on a word with an ellipsis (`fitCounts` and
  `fitSubject` in `site/src/account/digests.ts`, `SUBJECT_MAX`).
- The text and HTML parts carry the same lines and the same links, checked
  both ways: each line of one part is found in the other. The few lines
  worded for one part by design (the sign-in message's lead beside its
  button, the text part's "Saved searches and delivery", the shell's tagline
  in the address-change notice, whose text part ends on its contact line)
  are named by their dictionary keys in `site/test-mail/checks.ts`, so the
  exception holds in both languages and covers nothing else. The header's
  link to the home page is the HTML part's alone. The HTML part is read as
  the reader sees it: a section's heading in capitals, so the text part
  must write it in capitals.
- Every `h2` is the first thing in its band (`bandProblems` in
  `site/test-mail/checks.ts`), and each band is checked in the light colours
  it carries inline and in the dark rules: the heading at 4.5:1 or better on
  the band, the band at 1.2:1 or better against the card, the `bgcolor`
  attribute the same colour as the inline ground, the left edge the header
  rule's emerald at 3:1 or better against the card, and the heading free to
  wrap inside the band (`word-break: break-word`, no `nowrap`).
- Every link that carries a colour is reached by a rule of the dark query:
  its own class recoloured, or a rule for the links inside a class around
  it (`linksLeftLight` in `site/test-mail/checks.ts`), so no link keeps the
  light ink on the dark card.
- The HTML part is in the shell: the header's wordmark linking the site, the
  footer's line with the tagline and the contact address, a preheader, at
  most one button, and no image but the two wordmarks.
- A list or watch delivery (the saved searches, the records, the watch mail,
  the briefing, the weekly email, a saved view, the accounts-open and Ultra
  messages) carries its stop link in both parts, the page that manages it
  (the saved searches page, the watches page, the saved views page, or the
  account page for the weekly email) where it has one, and the line saying
  why the reader received it.
- With an https stop link, the message carries `List-Unsubscribe` naming the
  contact address and that same link, and `List-Unsubscribe-Post:
  List-Unsubscribe=One-Click`. With an http link (a local run) it carries
  neither, since Email Sending takes https links only.
- No em-dash in the subject, the text or the HTML.
- A message that carries matching notices (the weekly email, the watch
  mail) lists its plan's figure of them (`RULES.free.match_mail`, 3, or
  `RULES.pro.match_mail`, 10), counts the rest with its link to
  `/account/matches`, gives a Free account the line with Pro's own figures,
  and carries, in both parts, the disclaimer with the Terms' No Warranty
  section as a full https address and the licence line.
- No address but the site's two role addresses, `contact@awardwatch.ca` and
  `alerts@awardwatch.ca`: never the reader's own and never another reader's.
  The accounts-open and Ultra runs send to several addresses at once, and
  each message is checked against the others.

`site/test-mail/caps.test.ts` holds the caps and their arithmetic:

| Cap | Figure | Held |
|---|---|---|
| Messages in one delivery run (saved searches, then watch mail, then briefings, then the weekly email, then saved views) | `RUN_MESSAGES_MAX`, 300 | `roomAfter`: each part gets the cap less what the parts before it sent or tried, never below zero (a part that did not run counts as none), and the five never pass 300 together |
| Weekly emails in one delivery run | `WEEKLY_RUN_MAX`, 100 | the weekly email's room is the shared room held to 100; the run stops there and the next hour (or the next data date of the week) goes on |
| Watches one weekly email names | `WEEKLY_LINES`, 5 | eight watches with news name five, one line each, and count three more on a line to the watches page |
| Matching notices one message lists | `RULES.free.match_mail`, 3; `RULES.pro.match_mail`, 10 | 2, 3 and 25 matches on Free list 2, 3 and 3; 9, 10 and 25 on Pro list 9, 10 and 10; the rest is counted in both parts only when there is one, and the subject counts every match |
| Rows in one delivery message | `ROWS_MAX`, 50 | a search with 120 notices lists 50 and counts 70 more in both parts; a segment's counts come first; the watch mail's 50 run across every watch, each kind's rest on its own line |
| Rows in one briefing section | `SECTION_ROWS`, 10 | 25 new notices list 10 and count 15 more |
| Largest records in one saved view's message | `VIEW_MAIL_ROWS`, 5 | nine records list five; a twenty-year view lists its twenty fiscal years, the newest first |
| Saved views one run reads | `VIEWS_RUN_MAX`, 1000 | the next hour reads the rest |
| Lists named in the accounts-open message | `LISTS_SHOWN`, 10 | twelve lists name ten and count two more |
| Messages in one accounts-open or Ultra run | `ANNOUNCE_MAX`, 300 | runs capped at 2 send at most 2 each, each address once; what waited less what a run sent is what waits after it; account holders are passed over (accounts-open only) |
| Sign-in codes an address may ask for in an hour | `CODES_PER_HOUR`, 5 | the sixth request answers 429 and sends nothing |
| Messages in one live check | one per template, 11 | all to the one address, nothing to any other; without `MAIL_ADDRESS` the weekly email is reported `stubbed` and not sent |

The last part plants each fault the checks look for (an em-dash, another
reader's address, a link or a line in one part only, the reason line or the
stop link removed, `List-Unsubscribe` missing or naming another link, a
subject of 100 characters, an empty subject, the shell's header or footer
left out, an empty preheader, a second button, an image of the message's
own; on a briefing, a heading out of its band, a band too faint on the
card, a band with no dark rule, an edge in a second hue, a heading in mixed
case in the text part) and checks that each one fails.

Run the suite before shipping a change to a message, to the shell, to a
string a message uses (`site/src/account/strings.ts`), to the sender, or to a
cap.

## The live mail check

`POST /admin/mail-check` sends one message of each template, through the
sender a reader's message goes through (`sendWithHeaders` in
`site/src/account/deliveries.ts`), to the address in the Worker variable
`MAIL_TEST_TO`:

1. the sign-in code
2. a saved search's tender notices (daily)
3. a saved search's contracts ending (weekly)
4. a segment's new records
5. the watch mail
6. the weekly briefing
7. a saved analytics view (weekly; a segment's award notices over three
   fiscal years, the last counted to date)
8. the weekly email (the site's week, as an account that follows nothing on
   Free gets it, with four sample matching notices for the organization it
   names, so the block, its line on Pro and its disclaimer can be read)
9. the accounts-open message
10. the Ultra message
11. the address-change notice

Each subject starts with `[mail check]`, the same tag in both languages, so
the message is never taken for a reader's and an inbox rule can file it. The
rows are fixed samples in `site/src/account/mail_check.ts`, dated on the day
of the run; nothing is read from a file or a database, so the check proves
the way out of the Worker and not the night's data. Every stop link names an
id and a secret of zeros, which match no row: a click or a mail client's
one-click post changes nothing.

The answer is JSON and names no address:

```json
{
  "ok": true,
  "sender": "provider",
  "language": "en",
  "results": [
    { "template": "sign_in", "result": "sent" },
    { "template": "tenders_daily", "result": "refused", "reason": "E_RECIPIENT_NOT_ALLOWED" }
  ]
}
```

| Result | Meaning |
|---|---|
| `sent` | the sender took the message (Email Sending on the site; the local outbox on a local run) |
| `refused` | Email Sending refused it; `reason` is its error code (`E_SENDER_NOT_VERIFIED`, `E_RECIPIENT_NOT_ALLOWED`, `E_DAILY_LIMIT_EXCEEDED`, ...) or `failed` without one |
| `stubbed` | the `MAIL` binding or `MAIL_FROM` is missing, so nothing could leave (`reason` is `not_configured`); or, for the weekly email alone, the Worker secret `MAIL_ADDRESS` is not set, so the message, which must carry the mailing address, is not built (`reason` is `no_mail_address`) |

A refusal does not stop the run: every template is tried, so the answer shows
which ones the mail service takes. Each run writes an audit row,
`operator_mail_check`, with its counts and who started it (`by <operator's
user id>` or `by token`), never an address.

The route answers:

- the site's 404 while the accounts switch is off, as every `/admin` address
  does, and to any request the gate below does not admit;
- 400 with `{"ok": false, "error": "no_test_address"}` when `MAIL_TEST_TO`
  is unset or is not an address, and sends nothing;
- 403 to a console post without the session's CSRF value or the site's
  `Origin`, as the other console actions do.

### Who can start it

- An operator, from the console: the "Mail check" button on `/admin`
  leads to `/admin/mail-check`, which says whether the test address is set
  (never the address), which sender would answer, and what is sent; its form
  posts with the session's CSRF value, through the console's gate (*Who gets
  in* in `docs/accounts.md`).
- The workflow, with a token: a `POST` to `/admin/mail-check` that
  carries an `Authorization` header is judged by that header alone, never by
  a session. It is admitted when the accounts switch is on,
  `OPERATOR_EMAILS` is set, the Worker secret `MAIL_CHECK_TOKEN` is set and at
  least 32 characters long, the header is `Bearer <token>` with that value
  (both are hashed and compared in constant time), and, while `ACCESS_AUD` is
  set, the request carries a token Cloudflare Access signed for the
  application (a service token's, which names no email, counts). No other
  address reads the header: the token on `/admin`, on the console's page or
  on any action is the site's 404. The token is never logged.

### The workflow

`.github/workflows/mail-check.yml` runs on Monday at 14:00 UTC, an hour
before the delivery runs and the weekly briefings start, and by hand from the
Actions tab, where the input `language` (`en` or `fr`) picks the messages'
language. It posts to `<SITE_URL>/admin/mail-check` with the bearer token and
the Access service token, writes each template's result to the run summary,
and fails when any result is not `sent`, so GitHub's failed-workflow email
goes out. It reads the secrets `MAIL_CHECK_TOKEN`, `CF_ACCESS_CLIENT_ID` and
`CF_ACCESS_CLIENT_SECRET` and the variable `SITE_URL`; it never sees the test
address.

| The run says | What to do |
|---|---|
| The secret MAIL_CHECK_TOKEN is not set | add it (setting up, step 2) |
| Cloudflare Access stopped the request | check the service token secrets and the Service Auth policy (step 3) |
| The site answered 404 | the switch is off, `OPERATOR_EMAILS` is unset, Access's token did not check out, or the repository's token is not the Worker's |
| The Worker has no test address | add the secret `MAIL_TEST_TO` and deploy (step 1) |
| n of 11 templates were not sent | read the run summary: a `refused` reason is Email Sending's code, `stubbed` means the binding or `MAIL_FROM` is missing, or for the weekly email that `MAIL_ADDRESS` is not set (`docs/accounts.md`, Weekly email) |

### Setting up

1. The test inbox. Pick an address the operator reads and no reader
   uses. Add it as the repository secret `MAIL_TEST_TO` (Settings, Secrets and
   variables, Actions). Both deploys (`deploy-site.yml` and the nightly) pass
   it to the Worker as `--var MAIL_TEST_TO:<address>` while the secret is set.
   It is a secret and not a variable because the run logs of a public
   repository are public and Wrangler prints each variable it deploys; a
   secret is masked. The next deploy (a site-only deploy is enough) carries
   it. Until the domain is onboarded for Email Sending, the address must be
   one of the account's verified destination addresses.
2. The token. Make a random value, for example `openssl rand -hex 32`.
   Set it on the Worker with `cd site && npx wrangler secret put
   MAIL_CHECK_TOKEN`, and add the same value as the repository secret
   `MAIL_CHECK_TOKEN`. A deploy keeps the Worker secret. To change the token,
   set both again; to stop the workflow's way in, delete the Worker secret.
3. Access. In Zero Trust, Access controls, Service credentials, create a
   service token, and add its Client ID and Client Secret as the repository
   secrets `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`. In the
   application in front of `/admin`, add a policy with the action Service
   Auth that includes that service token. A service token alone opens
   nothing on the site: the Worker still asks for the bearer token, on this
   one address only.
4. A first run. Start the workflow by hand, then read the inbox.

### What the operator does with the inbox

After each run, in the test inbox:

- Ten messages arrived, each subject starting with `[mail check]`, none in
  spam. A template the run reported `sent` that did not arrive is a delivery
  problem past Email Sending: look in spam, then at the address's
  suppression list in the dashboard.
- Each message reads well in the mail client, in light and dark mode, and
  its links point at the site.
- The list messages show the client's unsubscribe control (from
  `List-Unsubscribe`); using it on a mail check message changes nothing.
- "Show original" (or the client's equivalent) shows SPF, DKIM and DMARC
  passing for `awardwatch.ca`.
- Now and then, run it by hand with `language` set to `fr` and read the
  French messages.

Then delete them. An inbox rule on `[mail check]` can file them in a folder of
their own.

### Why it never sends to a reader

The recipient is the Worker's `MAIL_TEST_TO` alone: the route reads no
address from a database, hands that address to every template, and sets it
again on each message before the send. The answer names no address, the
audit row names none, and nothing logs it. `site/test/accounts-admin.test.ts`
("the live mail check") holds this: every message the binding is handed goes
to `MAIL_TEST_TO`, the answer holds no `@`, the route is absent while the
switch is off, and a wrong token, a token on any other address or a Worker
without `MAIL_CHECK_TOKEN` gets the site's 404 and sends nothing.
