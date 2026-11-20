# Accounts

Accounts let a reader sign in with an email address, keep saved searches and
hold API keys. The module is built and switched off: until the operator sets
`ACCOUNTS_ENABLED` to `"true"`, every `/account` route answers the site's own
404 and no public page changes in any byte. The code is `site/src/account/`;
the schema is `site/accounts_schema.sql`; the tests are
`site/test/accounts-*.test.ts`.

## What it does

- **Sign-in by a code sent to the address.** No password exists anywhere. A
  reader types an address; the site sends a 6-digit code and a link; either
  one signs the browser in, once, within 15 minutes.
- **Saved searches.** The filters of the alerts form (tender lists, contracts
  ending, organizations, buyers, segments), kept on the account. A search is
  added with `Save this search` on a tender list, a list of contracts ending
  or a segment page (*Save this search*), or by pasting a page's address on
  the searches page; either way the site rebuilds the filter and writes its
  label, as the alerts form does. Requests made earlier through the alerts
  form are offered for import after sign-in.
- **Delivery by email.** On the Pro plan, any saved search can be sent
  daily or weekly: a tender list, a list of contracts ending, or the new
  records of an organization, a buyer or a segment (*Phase 2: delivery*).
  Every message carries a link that turns its delivery off without signing
  in.
- **Watches.** Any account follows up to 3 organizations, buyers,
  published contracts or open tender notices (Pro, 25; Ultra, 100) and sees what
  happened to each over the last 30 data dates; Pro gets one message a data
  date with those events (*Watches*).
- **Your organization.** Any account names the organization it is,
  privately and unchecked, and gets a page of that organization's records by
  fiscal year; Pro adds its records by segment, its share of a segment beside
  up to five organizations the account chooses, its contracts ending within
  12 months and the buyers it has won from, each as a CSV file (*Your
  organization*).
- **Weekly briefings.** Any account subscribes to a segment or a buyer from
  its page; Pro gets one message a week about it: the week's notices,
  awards and notable amendments, and the contracts ending next fiscal quarter.
  A public sample is built live at `/pro/briefing-sample`, the message as
  an inbox shows it, light or dark (*Weekly briefings*).
- **Weekly email.** Any account, Free or Pro, can turn on one message a
  week, with a box on the sign-in form or a control on the account page:
  what changed on the pages it follows, or the site's week in figures, and
  one line on what Pro adds for an account without it. No account is
  enrolled any other way (*Weekly email*).
- **Calendar feeds.** On the Pro plan, a saved tender search becomes an
  address a calendar app subscribes to, its open notices' closings as
  events (*Calendar feeds*). Every notice and contract page also offers its
  closing or end date as a one-event file, to any reader.
- **API keys.** Issued and revoked on the account; shown once, with a Copy
  button. An account's live keys each have their own name: a post naming a
  live key's name (the create form posted again by a reload) makes no key
  and says a key of that name exists. A key of a
  Pro account opens the keyed API under `/api/v1` (*The keyed API*); the
  keys page shows each key's requests today and over 30 days. The usage
  page, `/account/api` (linked from the keys page's head and the account's
  overview), shows a key's limits on the plan, today's requests of each key
  in use against the daily cap, and each key's requests a day over the 60
  days the counts are kept, as a chart and a table (*The usage page*). A
  plan without the keyed API is sent from it to the keys page.
- **Plans.** Each account is on a plan, Free or Pro, computed from the
  entitlements table. The plan sets how many saved searches the account
  keeps and whether delivery, API keys, filtered exports, same-day tender
  notices, the full 6- and 12-month windows of contracts ending
  (`radar_depth`) and the analytics views in full (`analytics`,
  `docs/analytics.md`) are open to it. A page learns the request's plan with
  `planOfRequest(c)` (`site/src/account/session.ts`) and checks a feature
  with `allowed({ plan }, feature)` (`site/src/account/entitlements.ts`).
- **Bug reports.** On the Pro plan, a form under the account stores a
  report and sends it to the operator's inbox (*Bug reports*).
- **Deletion.** The reader deletes the account from its own page.

Three kinds of message are sent by email: the sign-in message, the
saved-search deliveries a Pro account turns on, and, once, the message
telling the email lists' sign-ups that accounts are open (*The accounts-open
message*). All go out through Cloudflare Email Sending from the Worker's
own binding once the domain is onboarded (see *Sending mail* and *Operator
steps*). The watch mail, the weekly briefings and the weekly email any
account can turn on go the same way (*Watches*, *Weekly briefings*, *Weekly
email*).

## Data model

One D1 database, `awardwatch-accounts` (binding `ACCOUNTS`), apart from the
forms database on purpose. Every id is 32 random hex characters unless noted.
Every datetime is ISO in UTC.

| Table | Holds | Never holds |
|---|---|---|
| `users` | the address (lower-cased, unique), language, created and last-seen times, status `active` or `deleted`, the cached plan and its end | a name, a password, a postal address |
| `magic_codes` | one row per sign-in request: SHA-256 of the code (salted by the row id) and of the link's secret, created and expiry times, when used, wrong tries, a daily-salted hash of the requesting address | the code, the link, the IP address |
| `sessions` | one row per signed-in browser: SHA-256 of the cookie's secret, created, last-seen and expiry times, revocation time, the device class (desktop, mobile, tablet) | the cookie's secret, the user agent, the IP address |
| `saved_searches` | kind, filter (path and query as the site rebuilds it), the site's label, language, delivery (`daily`, `weekly`, `off`) | anything typed that the site did not rebuild |
| `api_keys` | the user's name for the key, an 8-character prefix, SHA-256 of the key, created, last-used and revocation times | the key |
| `entitlements` | plan, source (`manual` or `stripe`), start, end, revocation, a reference | an address, card details |
| `deliveries` | one row per delivery run of a saved search: the run's time, how many records matched, and `sent`, `failed` or `empty` | the message, the address |
| `delivery_tokens` | the secret of each delivered search's stop link, made on its first delivery | anything else |
| `delivery_marks` | for an organization, buyer or segment search: the records database's counts by source and fiscal year at its last delivery, and that database's data date then | the message, anything about the reader |
| `code_misses` | one row per wrong code or link tried for an address: the address and the time, for the hour's count | the code tried, the IP address |
| `audit` | user id, event name, time, a short fixed detail | an address, a code, a token, a key |
| `bug_reports` | one row per bug report from a Pro account: the page (a path on the site), what happened, what was expected, the time | the address |
| `api_usage` | one row per API key per UTC day it was used: how many requests the keyed API counted for it that day | a path, a parameter, an address, the time of a request |
| `watches`, `watch_mail` | the pages an account follows and its watch mail (*Watches*) | anything typed, a copy of a message |
| `briefings`, `briefing_deliveries` | the segments and buyers an account receives a weekly briefing about, and each briefing's runs (*Weekly briefings*) | anything typed, a copy of a message |
| `weekly_mail` | one row per account that turned the weekly email on: on or off, where (`sign_in` or `account`) and when it was last turned on, when it was turned off, the week its last message covered and whether it was sent, the week a message was refused, the unsubscribe link's secret (*Weekly email*) | anything typed, a copy of a message, the sender's postal address |
| `feeds` | one row per calendar feed: kind (`search`, `watchlist`, `all`), the saved search it follows, the address's secret, created and revocation times, the UTC day a calendar last read it | a time of reading, an address, a user agent |
| `org_claims` | one row per account that named its organization: the organization id, up to five organization ids to compare it with, the share block's segment, when it was chosen and last changed (*Your organization*) | anything typed, a name, any sign of which other accounts chose the same organization |
| `saved_views`, `view_deliveries` | the analytics views an account saved: the view's address as the site writes it, the name the reader gave it, its language and email cadence, a hash of the figures its last message carried, its stop link's secret; and each view's runs (*Saved views*) | anything typed but the name, a copy of a message |
| `seats` | one row per invitation to a seat and, once taken, the seat it became: the holder's and the member's ids, the invited address and SHA-256 of the link's secret while it is an invitation, the language, when it was sent, expires, was taken and ended, and why it ended (*Seats*) | the link's secret, a plan, a price, a count, a member's address |

Limits: at most 25 saved searches per account on Pro, 100 on Ultra (Free
keeps 3), at most 5 live API keys, at most 5 sign-in requests per address per
hour, at most 5 wrong codes per address per hour across all its requests, at
most 5 bug reports per account in any 24 hours, at most 600 keyed API
requests a minute and 20,000 a UTC day per key on Pro (50,000 on Ultra), at
most 10 saved analytics views on Pro and 50 on Ultra (Free keeps none).

Retention: sign-in requests and wrong tries are deleted after a day (and
with the account); sessions 90 days after they end; audit rows after 90
days; bug reports after 180 days (and with the account); the keyed API's
daily counts after 60 days (and with the account's keys, by the table's
cascade); a seat 30 days after it ends, and an invitation never taken 30
days after it was sent. The sweep runs with each sign-in request and once
a day from the Worker's 06:00 UTC cron, so the days hold when nobody signs
in.

## Sign-in flow

1. `POST /account/sign-in` with an address. The post is refused if its
   `Origin` names another site; a filled honeypot or an incomplete address
   is refused with a line on the form. The address is trimmed, lower-cased
   and length-checked.
2. The site counts the address's requests in the last hour (5 at most), then
   stores a row with a fresh 6-digit code and link secret, both from
   `crypto.getRandomValues` and both stored only as SHA-256 hashes.
3. The message goes out through the sender (*Sending mail*). The page that answers is
   the same for an address with an account and one without; no user row is
   made at this step.
4. `POST /account/check` with the address and the code, or with the link's
   token. `GET /account/check?token=...` (the link) shows a button that posts
   the token, so a mail scanner that opens the link uses nothing up. The
   hashes are compared in constant time. An address has five wrong tries
   an hour, across all its requests (a link with a wrong secret is one):
   after the third wrong code the page says two tries remain this hour,
   after the fourth one, and the fifth locks the address until an hour has
   passed since the first of them, when a code or a link answers "Too many
   wrong codes for this address. Try again in an hour." A new request
   during the lock is made and sent as usual and changes nothing about it.
   Each try is counted before it is compared, in one statement with the
   hour's count, so tries sent at the same moment cannot pass the five. A
   code or link is single use, and using one closes the address's other
   open requests.
5. On a match the site creates the user on first sign-in, creates a session
   and sets the cookie `__Host-aw_session` (`HttpOnly`, `Secure`, `SameSite=Lax`,
   `Path=/`, 30 days). The cookie holds the session id and a 32-byte
   secret; the row holds the secret's hash. The session is extended to 30
   days from the last use, at most once an hour. Any request that reads the
   session is a use, whoever reads it first: a public list, the app home, a
   profile, the dashboard, an account page (`session.ts` `readSession`). The
   cookie goes back on that request's answer once it is made
   (`refreshSessionCookie`, after the handlers and around the 304 check), and
   that answer is sent `private, no-store`, since the cookie carries the
   secret; an answer that sets the cookie itself (a new sign-in, a sign-out)
   keeps its own. A 304 carries the cookie with its tag unchanged, the tag
   being taken from the body. The page the address signed in from on its
   first sign-in sets the account's mail language (`users.lang`); a later
   sign-in leaves it, and the overview changes it (*Mail language*). The
   code field takes a pasted code with spaces around or inside it, which the
   check strips. The `__Host-` prefix makes
   a browser refuse the cookie unless it is `Secure`, on `Path=/` and
   without a `Domain`, so no other host under the domain can set or shadow
   it. A session the browser already held, for this account or another,
   is revoked when the new one starts.

   An account stays signed in on at most `SESSIONS_MAX` (3) browsers, on
   every plan: a desk computer, a laptop and a phone. `startSession` writes
   the new row and the cap in one batch, which D1 runs as one transaction:
   the insert, then an update (`SESSION_CAP_SQL`) that ends every live
   session of the account outside the 3 used most recently, by
   `last_seen_at`, then `created_at`, then `id`. The new session is ordered
   first, so a touch that another instance stamped a moment after this
   request's clock cannot end the session being handed out. A second
   sign-in at the same moment runs after the first and sees its row, so two
   at once still leave 3. When the update ended any, the audit gains one
   row, `signed_out` with the detail `cap <n>` (the count; no session id, no
   address), and a sign-in without `next` ends on `/account?m=capped`, whose
   line reads "This account was signed in on 3 browsers already, so the one
   used least recently was signed out." A sign-in with `next` goes there as
   before. No column or index was added: `idx_sessions_user` serves both
   statements.
6. `POST /account/sign-out` ends the session on this browser, or on every
   browser (`scope=all`). The overview's Account panel reads "Signed-in
   browsers: 2 of 3 browsers", and its panel "Signed-In Browsers" lists the
   account's live sessions, the one used most recently first: the device
   class, when it signed in and when it was last used (UTC), "This browser"
   on the reader's own row and a link-styled Sign out on each other one.
   That button posts to `POST /account/sessions/:id/sign-out` (`Origin`,
   session, CSRF; the `edit` bucket). Its statement is bound to the
   account's id and never ends the browser making the request, and the
   answer is the same redirect to `/account?m=session_out` whatever the id
   names (a live session of the account, one already ended, this browser's
   own, another account's, none at all), so the post tells nothing of a
   session that is not the account's. The audit row, written only when a
   session ended, is `signed_out` with the detail `other browser`.
7. A browser whose session was ended elsewhere (the cap, a sign-out
   everywhere, the panel's Sign out, the operator's console) learns it on
   its next account page: `lookup` finds the row revoked, the cookie's own
   secret matching and the account still active, and answers `ended`. The
   page clears the cookie and sends the reader to
   `/account/sign-in?m=ended`, with `next` as for any other page, where the
   line reads "This browser was signed out. That happens when the account
   signs out from another browser, or signs in on more than 3 browsers.
   Sign in again to continue." Why a session ended is not stored, so the
   line says when that happens and never which. A cookie with the right id and a
   wrong secret, a session that ran out and a deleted account's session go
   to the plain sign-in page. On a public page an ended session reads as
   signed out, the same page a reader without a session gets.

The sign-in page serves a first visit and a return with the same form: its
heading is "Create a Free Account or Sign In", its lead says an account is
free and needs no card or password, and beside the form from 1200 px
(under it below) the panel "What a Free Account Gives You" lists the Free
plan card's own lines for saved searches, watches, matching notices and the
week's matches by email (`PLAN_ROWS`, figures from `RULES`; the holder's
record stays on the plan cards), the weekly email while the form offers its box, and one line with
Pro's own figures linking `/pro`, worded as the plan rows word them ("Pro: 25 saved searches and briefings,
by email; 25 watches, each change by email; ...", `account.free_pro`). The line that a Follow or a briefing rides
along stays in the form's panel, above the list; the code step is unchanged.

Both sign-in posts count against `AUTH_LIMIT` (10 a minute per address) while
the switch is on. A sign-in is two posts (the address, then the code), so five
people behind one office address can sign in within the same minute; the five
codes an hour per email address and the wrong-code lock above are held in the
database and do not depend on it. Every signed-in form carries a CSRF value
derived from the cookie's secret, checked on the post. A post whose value is not the
session's, most often a form opened before this browser signed in again (a
sign-in revokes the session it replaces, and the open tabs keep its value),
does nothing and answers 403 with a page in the site's shell: "This form was
opened under an earlier sign-in, and nothing was sent." and a link to reload
the page the form was on (its `Referer` on this site, held to `safeNext`;
else the account page).

### Mail language

The overview's Account panel shows the language the account's own mail goes
out in (`users.lang`: the watch mail, the weekly email and a grouped message
of saved searches, briefings or saved views, *Phase 2: delivery*), with one
link-styled button that switches it between English and French (`POST
/account/mail-language`, `mail_lang=en|fr`, with the CSRF value; the audit
row `mail_lang` carries the language). A saved search, a briefing and a
saved view keep the language of the page each was saved from, as the line
under the row says; when more than five of an account's saved searches, or of
its briefings, or of its saved views, go in one message, that message is in
the account's language.

## The switch

`ACCOUNTS_ENABLED` in `site/wrangler.jsonc`, `"false"` as shipped. While it
is anything but `"true"` (or the `ACCOUNTS` binding is missing):

- every `/account` route answers the site's 404 page;
- no page links to an account, the rail shows nothing new, and the privacy
  page says the site has no accounts;
- the sign-in posts count as page requests;
- `requireApiKey` gates nothing;
- `planOfRequest` answers `free` for every request;
- nothing reads the accounts database or the mail binding, and the hourly
  delivery cron returns before reading anything.

`site/test/accounts-switch.test.ts` proves each point, rendering the public
pages with the switch off, with the module's bindings removed and with a
valid session cookie, and requiring the three to be identical byte for byte.
With the switch on, the rail's "Your lists" group gains one item (the
signed-in address, or "Sign in") and the privacy page's first section
describes accounts; a page that shows a signed-in address is sent
`Cache-Control: private, no-store`; and every HTML page carries `Vary:
Cookie`, since one address renders differently with a session and without
one. `/robots.txt` disallows `/account` whatever the switch.

The switch also starts the one paid gate on a public page, the radar's
depth (`radar_depth`, `site/src/plan.ts` `radarWindowLocked`). For a request
whose plan lacks it, `/expiring/6m` and `/expiring/12m` show the window's
count and total, its first 10 contracts and what Pro includes, with no
filters or pages; the files under `/data/expiring/6m/` and
`/data/expiring/12m/` answer the site's 404, and `/downloads/expiring-6m.csv`
and `/downloads/expiring-12m.csv` the download route's 404 (each file by its
own window's gate, the same rule for both). A Pro request gets the full pages
and the files (marked `private, no-store`); each window's full page links its
own CSV. The overview, the 3-month window, its CSV (`expiring-3m.csv`, which
the overview, the 3-month list and the free view link) and the feeds (which
carry the 3-month window only) stay free. `wrangler.jsonc` runs the Worker
first for those two folders and the 6- and 12-month CSVs so it can refuse
them; while the switch is off it passes them on as they are.
`site/test/radar-gate.test.ts` proves both states.

The analytics views (`/buyers/<id>/analytics`, `/organizations/<id>/analytics`,
`/segments/<nn>/analytics`, feature `analytics`, `site/src/plan.ts`
`analyticsAccess`) exist only while the switch is on: off, each address and
each of their CSV files is the site's 404 and no page links them. On, the
buyer, profile and segment pages link them with the word Pro marked, and a
request without the feature sees each view's first chart for the latest
three fiscal years and a line on each other chart, with a link to
`/account/billing` (signed out, `/account/sign-in`); the CSV files answer
404 to it. `site/test/analytics.test.ts` proves both states
(`docs/analytics.md`). Their index, `/analytics`, follows the same switch:
off, the site's 404 and no rail item; on, the rail's Browse group lists it
for every reader (`site/test/analytics-index.test.ts`).

While the switch is on, whatever leads to a page that comes with Pro
carries the Pro chip (`site/src/pro.tsx`), for every reader: the rail's
entries for the 6- and 12-month windows (each with its own count; the
"Contracts ending" parent has none), for `/tenders/same-day`, for the
analytics index (`/analytics`) and for the Email lists, the radar's 6- and 12-month tabs and overview tiles, and the
links to the 12-month list on profiles and buyer pages. The free view's
panel names the price from `PRICE_MONTHLY_CAD` and `PRICE_YEARLY_CAD`,
taxes added at checkout, and leaves the line out when the checkout would
offer no price. On the Data page the 6-month and 12-month files' rows carry
the chip and, for a request without the feature, lead to their own list's
free view (`/expiring/6m`, `/expiring/12m`); each file's own address still
answers 404. The 6-month row is listed once the export's list of downloads
names the file (`DOWNLOADS` `listed`), since a site deploy can land before
the nightly that first writes it. A Free account's overview
lists API keys, API usage and bug reports with the chip, and its saved
searches carry one-line notes at the cap and in the delivery column.
`site/test/pro-mark.test.ts` holds the placements and the chip's styles.

## Sending mail

Sign-in messages and saved-search deliveries go through Cloudflare Email
Sending from the Worker's `MAIL` binding (`site/wrangler.jsonc`). There is no outside mail service and
no key to store: the binding is the credential. `senderFor()` in
`site/src/account/sender.ts` picks the sender for each request, in this
order:

| Sender | Chosen when | What it does |
|---|---|---|
| log | `MAIL_SENDER` is `"log"` and the request came to a local host | writes the message to the `sent_mail` table of the local database |
| binding | the `MAIL` binding and `MAIL_FROM` are both set | hands the message to Email Sending |
| stub | neither of the above | records `mail_not_sent` in the audit trail; the page answers 503, "Sign-in by email is not available yet" |

The binding's message comes from `MAIL_FROM` (`alerts@awardwatch.ca`) under
the name Award Watch. Replies go to the contact address the site's
documents print, and the header `Auto-Submitted: auto-generated` keeps
out-of-office replies from coming back. Each message has a plain-text and
an HTML body, in the language of the page it was asked from; the code is in
both bodies and never in the subject or the preheader (the line an inbox
lists after the subject).

The template is `signInMessage()` in `site/src/account/sender.ts`, with its
English and French strings under `account.mail_*` in
`site/src/account/strings.ts`, laid out in the shell every message shares
(`site/src/account/mail_html.ts`; docs/mail.md, *The shell*). It mirrors the
sign-in prototype in `design/email/`: the same tables, inline styles and
dark-mode rules, the code in a ruled band (32 px, monospace), a button
carrying the link, and a footer with the reason for the message, the site's
tagline and the contact address. The prototype's plain-text file is the
shape of the plain-text part. A change to the message belongs in
`design/email/build.py` as well; running
`python design/email/build.py` regenerates the prototypes and the review
sheet (`design/email/prototypes.html`, not tracked), so the sheet keeps
showing what is sent.

The HTML loads no web font, no script and no image but the wordmark,
served from the site's `/brand/` as two PNGs at twice their displayed 142
by 20 pixels: `wordmark.png` (ink on a white ground) and `wordmark-dark.png`
(light ink on a transparent ground, which the clients that honour the dark
query swap in). Both live in `site/public/brand/` and are drawn from
`brand/wordmark.svg` by `python brand/make_wordmark_png.py`. On a local run
the images and the link point at the local server instead.

When the binding refuses a message (the domain is not onboarded, the
recipient is on the suppression list, the daily limit is reached), the
sender logs the error's code alone, never the address or the message; the
audit trail records `mail_failed`; and the page answers 503 with "The
message could not be sent. Try again in a few minutes."

The sign-in code and the delivery job share the binding and so the
account's daily quota. Cloudflare's Email Service limits page
(https://developers.cloudflare.com/email-service/platform/limits/) says new
accounts "start with a conservative daily quota and scale up over time
based on your sending behavior", that limits are "applied per account",
and that a higher one is asked for with the Limit Increase Request Form; it
gives no figure and no time at which the day resets. The Workers API's
error codes
(https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
name the refusal `E_DAILY_LIMIT_EXCEEDED`, "Daily limit exceeded", with the
cause "Daily sending quota reached". Sends to the account's verified
destination addresses are not counted. So that a busy day of deliveries
cannot spend the quota and leave sign-in codes refused, the delivery job
holds itself to a ceiling of its own: `MAIL_DAILY_QUOTA` less
`MAIL_DAILY_RESERVE`, two variables in `site/wrangler.jsonc` (`"1000"` and
`"40"` as shipped: the quota Cloudflare raised from 200 to 1,000 on
2026-11-20, and a reserve of 40 sign-in codes, so a ceiling of 960). It counts its sends for the UTC day from its
run log (`delivery_runs`, one query at the start of each run) plus what the
run sends, and once they reach the ceiling the run stops as a sending
limit's refusal stops it (`limited`), before claiming anything, and the rest
waits for the next UTC day (*Phase 2: delivery*, What it sends and writes).
Sign-in is neither counted nor held. A quota that is absent, empty or not a
positive whole number, a reserve that is not a whole number, or a reserve
as large as the quota means no ceiling (the run logs one line for the last
three); so does a database without `delivery_runs`, with one log line.
Cloudflare names no reset time, so the ceiling counts by UTC day. The job
sends only from 15:00 to 20:00 UTC, so a day that Cloudflare starts at any
hour outside those counts the same messages; if Cloudflare counts a rolling
24 hours instead, a day whose late runs sent much can leave less than the
reserve for the hours before the next day's runs. The console's bulk runs
(the accounts-open and Ultra messages, up to 300 a run) go through the same
binding, so they keep to the same ceiling: a run reads the day's room
(`dayRoom`) before it starts, stops before the next claim once it has sent
that many, and the console page says so (*The console page*, under *The
accounts-open message*); each run that sent or tried a message writes a row
of its own to the run log (outcome `console`, no data date, nothing due,
naming no address; `writeConsoleRun`), so its sends count against the
ceiling for the rest of the UTC day. Two runs at the same moment, one the
job's and one the console's, each read the room before the other's sends
are logged, so together they can pass the ceiling by what the later one
sends; the reserve is there for that too. The console's single messages
(the address-change notice, the live mail check) are not counted.

Every message the site sends is checked by the mail suite (`npm run
test:mail` in `site/`) and, on the live site, by the weekly mail check, which
sends one message of each template to the operator's test inbox and never to
a reader (`docs/mail.md`).

As shipped, `wrangler.jsonc` sets both the binding and `MAIL_FROM`, so the
binding answers on the site and the stub only answers if one of them is
removed. Until the domain is onboarded, Email Sending delivers only to the
account's verified destination addresses, and any other address gets the
"could not be sent" page. With the switch off, none of this runs.

## Operator steps

1. **Apply the schema** to the database (already created on the account):

   ```
   cd site
   npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
   ```

   Every statement is idempotent. Run it again whenever the file changes:
   phase 2 added the `delivery_tokens` table, and the records deliveries the
   `delivery_marks` table, both of which deleting a search or an account now
   clears, so the schema goes on before the code that names them is deployed
   (without `delivery_marks`, deleting a search or an account answers 503).
   The calendar feeds added `feeds` and its two indexes; until they exist
   the searches page shows no feeds and the console no feed counts, and
   deletion goes on without them. The dashboard's grid added `dashboards`
   and `dashboard_tiles` with their three indexes; until they exist an
   Ultra account can arrange its tiles on the page but not keep their
   places and sizes, and the page says so (*Dashboard*, *Operator step*).
   `npm run db:local` applies it to the local database, with
   `seed/accounts_dev.sql` (the development outbox, never applied on the
   account).
2. **Onboard awardwatch.ca for Email Sending.** In the dashboard: Compute &
   AI (Compute on some dashboards), Email Service, Email Sending, Onboard
   Domain; pick awardwatch.ca, review the records it lists and confirm with
   **Add records and onboard**. Or, from `site/`, with an API token that
   carries the Email Sending edit permission:

   ```
   npx wrangler email sending enable awardwatch.ca
   npx wrangler email sending dns get awardwatch.ca
   ```

   The onboarding adds the SPF and DKIM records itself, on the `cf-bounce`
   subdomain, apart from the MX and SPF records Email Routing keeps on the
   zone; `dns get` lists them. On a Cloudflare zone they usually settle
   within 15 minutes.
3. **Keep one DMARC record.** The onboarding adds a TXT record named
   `_dmarc` with the policy `v=DMARC1; p=reject;`. Keep it, and add none
   beside it: a domain with two DMARC records has no policy at all, since
   receivers stop reading when they find more than one. Reject is the right
   policy here, because every message from the domain leaves signed through
   Cloudflare; a message that claims the domain and is not is refused rather
   than filed as junk. If the onboarding added none, add that record by hand
   in the zone's DNS (Type TXT, Name `_dmarc`, Content `v=DMARC1; p=reject;`).
   Then watch the next daily check's message arrive in the inbox: it leaves
   through the same facility, and its arrival proves the policy and the
   signing agree.
4. **Prove sending works**, before the switch flips:

   ```
   npx wrangler email sending send --from alerts@awardwatch.ca --from-name "Award Watch" --to <an inbox you control> --subject "Award Watch sending test" --text "A test of Email Sending on awardwatch.ca."
   ```

   Send it to an inbox that is not one of the account's verified Email
   Routing destinations: those receive mail even before onboarding, so a
   delivery there proves less. In the received message's headers, SPF,
   DKIM and DMARC should each read `pass`. This goes through the same
   account and domain as the binding; the binding's own path is covered by
   `site/test/accounts-mail.test.ts` and shows on the first sign-in after
   the switch.
5. **Know the daily limit.** Email Sending caps each account's sends per
   day. A new account starts low and the cap rises on its own as the
   account builds a sending history; Cloudflare publishes no fixed figure.
   The API gives the account's current figure:

   ```
   curl "https://api.cloudflare.com/client/v4/accounts/<account id>/email/sending/limits" --header "Authorization: Bearer <token>"
   ```

   Each day's sends are on the dashboard under Email Service, Email
   Sending, the domain, **Analytics**. The Workers Paid plan includes 3,000
   messages a month for the whole account, billed per thousand after that;
   mail to the account's verified destinations is free and not counted. A
   send over the cap fails with `E_DAILY_LIMIT_EXCEEDED`: the reader gets
   the "could not be sent" page and the log shows the code. A higher cap is
   asked for through Cloudflare's limit increase form.

   Keep `MAIL_DAILY_QUOTA` in `site/wrangler.jsonc` at the figure the
   dashboard shows (200 on 2026-11-14, 1,000 since 2026-11-20) and deploy
   when it changes; the
   delivery job stops for the UTC day at that figure less
   `MAIL_DAILY_RESERVE` (40), which stays for sign-in codes (*Sending
   mail*). When the daily check says "The delivery job reached the day's
   sending ceiling", the day's deliveries did not all go: ask Cloudflare
   for a higher quota, then raise `MAIL_DAILY_QUOTA`. Emptying
   `MAIL_DAILY_QUOTA` removes the ceiling.
6. **Turn the switch on**: set `"ACCOUNTS_ENABLED": "true"` in
   `site/wrangler.jsonc` and deploy. Turning it back off hides everything
   again at once; the data stays. Before it, check:
   - `accounts_schema.sql` applied again on the account (step 1), so the
     tables added since the first application exist: `code_misses` (the
     hour's wrong codes; without it every code check answers "cannot be
     reached"), `delivery_tokens`, `delivery_marks`, `payment_customers`,
     `payment_events` and `payment_reversals`;
   - with payments set up (*Payments*, *Operator steps*): the webhook
     endpoint's seven events, `charge.refunded`, `charge.dispute.created` and `refund.failed`
     among them, and read access to Charges on the restricted key.
7. **Tell the email lists' sign-ups**, once the switch is on and sending
   works: add `notice_at` to the forms database's `interest` table, then
   run the accounts-open message from the console (*The accounts-open
   message*).

Local run with the switch on and the development outbox:

```
cd site
npm run data:local && npm run db:local
npx wrangler dev --port 8787 --local-upstream localhost:8787 --var ACCOUNTS_ENABLED:true --var MAIL_SENDER:log
```

`--local-upstream` keeps the request's own host: without it `wrangler dev`
hands the Worker the route's host, the site's domain, and the message goes
to the local stand-in for the `MAIL` binding, which prints the sender, the
recipient and the subject in the terminal and writes the bodies to
temporary files; no mail leaves the machine. The log sender writes each message to the `sent_mail` table of the local
database (`npx wrangler d1 execute awardwatch-accounts --local --command
"SELECT text FROM sent_mail ORDER BY id DESC LIMIT 1"`). It answers only on
a local host, so the variable set by mistake on the account sends nothing
to a table or a log.

### Granting a plan by hand

The plan is computed from `entitlements`: of the rows not revoked whose
window holds the moment, the latest recorded wins; none means Free. To grant
Pro to an address until a date (or `NULL` for no end):

```
npx wrangler d1 execute awardwatch-accounts --remote --command "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) SELECT lower(hex(randomblob(16))), id, 'pro', 'manual', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), '2027-12-31T00:00:00.000Z', 'manual grant', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM users WHERE email = 'reader@example.com' AND status = 'active'"
```

The address must have signed in once. To end a grant at once:

```
npx wrangler d1 execute awardwatch-accounts --remote --command "UPDATE entitlements SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = '<entitlement id>'"
```

The test suite runs this same insert (`MANUAL_GRANT_SQL` in
`site/test/accounts-helpers.ts`).

Ultra is granted from the operator console (the grant's Plan select,
*Operator console*), which writes the `entitlements` row and its
`entitlement_tiers` row in one batch (*Ultra*). By hand it is the insert
above with a chosen id, followed in the same command by
`INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES ('<that id>', 'ultra')`;
the console is the safer way, since its batch is one transaction.

## Security posture

- **No passwords.** The only credential is control of the inbox. Losing the
  address is the one case with no self-serve path.
- **Hashes only.** Codes, link secrets, session secrets and API keys are
  stored as SHA-256 hashes and compared in constant time. A copy of the
  database signs no one in and holds no usable key.
- **Short-lived, single-use codes.** 15 minutes, one use, 5 wrong tries an
  hour per address, whatever requests it holds.
- **Rate limits per address, per account and per email.** `AUTH_LIMIT` (10
  a minute per IP address) on both sign-in posts; 5 requests an hour per
  email in the database. The keyed API adds `KEY_LIMIT` (600 a minute per key, keyed by
  the key's id) on top of `API_LIMIT` (60 a minute per address), and a
  daily quota per key in the database (*The keyed API*). The dashboard's
  posts, the saved views' and the overview's Sign out on another browser
  count against `EDIT_LIMIT` (60 a minute per
  address, namespace 2012), apart from `FORM_LIMIT`'s 5, so a long
  rearrangement leaves the billing posts and the bug report their own
  count. Which requests are downloads is `bucketFor`'s decision (the Data
  page's files, the CSV files of the analytics views, the record tables,
  the radar's filtered windows, the standing offers and the claimed
  organization's blocks, and the one-event calendar files). A download
  whose session is signed in on Pro or Ultra counts against
  `PAID_DOWNLOAD_LIMIT` (30 a minute per account, namespace 2013), keyed
  `account:<user id>`, in place of `DOWNLOAD_LIMIT` (10 a minute per
  address), which every other download keeps: one buyer's analytics view
  offers 8 tables, so a Pro analyst takes three buyers' tables and most of
  a fourth in a minute, and colleagues behind one office address each have
  their own count. The limiter learns the account from the request's one
  session read (`readSession`, kept per request), which the route then
  reuses, so a paid file that reads the plan anyway costs no second read;
  a calendar file or a free Data page file reads no session of its own, so
  for a reader signed in there the limiter's read is the request's one
  read. A request without a session cookie reads nothing for it. A session
  that does not stand, a free plan, a database that cannot answer, and a
  session answered from the instance's memory through an outage are all
  counted by address. The account's refusal says "Too many downloads from
  this account." in place of the address's line. Cloudflare's counts are
  per location and approximate (the binding's page: limits "are local to
  the Cloudflare location", and "Requests can exceed your configured
  limit"), so an account whose requests reach two locations has 30 at each,
  and a burst can pass 30 before the count catches up. A refusal to a
  browser's navigation (a form post, or a page a
  browser asks for: `Sec-Fetch-Mode: navigate` or an `Accept` naming
  `text/html`) is a page in the site's shell, in the reader's language, with
  the line and a link back to the page the browser came from (its `Referer`
  on this site, held to `safeNext`; else the account page, or the home page
  while the switch is off), keeping the 429 and `Retry-After: 60`
  (`site/src/limit_page.tsx`). Any other request keeps the plain text line,
  and the API its JSON.
- **Cross-site posts refused.** Every POST checks `Origin`; the session
  cookie is `SameSite=Lax`; every signed-in form carries a CSRF value. A
  post without `Origin` (not a browser) is let through.
- **The Follow form on public pages.** A reader not signed in can ask for a
  sign-in message from any organization, buyer, notice or contract page
  (*Watches*), so the request form sits on every one of those pages, where
  crawlers read it. A post that carries `follow` must say it comes from the
  site's own page (`Sec-Fetch-Site` same-origin or same-site, else an
  `Origin` or `Referer` of the site; `api.ts` `fromOwnPage`), which every
  current browser does for a form post; one that does not sends nothing and
  answers the sign-in page with the address kept and `follow` dropped, and
  the console line `account sign-in: a Follow post without a page's
  headers` counts them. This stops a script that reads the form and posts
  it bare. Any client can send those headers, so the Follow posts of the
  whole site also have a ceiling: `FOLLOW_CODES_PER_HOUR`, 200 sign-in
  messages an hour (`signin.ts`), counted from the audit trail, where a
  Follow form's request is `code_requested` with the detail `follow`. Past
  it a Follow post sends nothing and gets the same sign-in page (console
  line `account sign-in: the hour's Follow requests are spent`). That page
  says to sign in there and press Follow after, and its own post is held to
  neither rule, so no reader is kept from signing in; a count that cannot be
  read lets the post through. The caps above stand beside it. The form never
  adds anything by itself: the watch is added only
  after the address's own code or link is verified, for the account that
  address signs in to, and only one watch on a page the data holds, within
  the plan's cap.
- **The Save this briefing link on public pages.** A segment or buyer page
  links a reader not signed in to `/account/sign-in?next=<page>&brief=<kind>:<subject>`
  (*Weekly briefings*), so a crawler that follows the link finds a sign-in
  form carrying `brief`. A sign-in post that carries `brief` is held to the
  same two rules as one that carries `follow`: it must come from the site's
  own page (console line `account sign-in: a briefing post without a page's
  headers`), and it counts against the same ceiling, `FOLLOW_CODES_PER_HOUR`,
  marked `code_requested` with the detail `brief` (console line `account
  sign-in: the hour's Follow and briefing requests are spent`). One ceiling
  for both keeps one bound on the messages the public pages can have the
  sender send in an hour. A post carrying both is marked `follow` and counted
  once. Past either rule the post sends nothing and gets the sign-in page
  with `brief` dropped and a line saying to sign in there and press Save
  this briefing after. The briefing is saved only after the address's own
  code or link is verified.
- **No account enumeration.** The sign-in page answers the same whether or
  not the address has an account, and the per-email limit applies to every
  address alike.
- **Sessions are revocable, and capped.** Sign out on this browser, on
  another from the overview's panel, or on all of them; deletion revokes
  every session. An account holds at most 3 live sessions
  (`SESSIONS_MAX`), whatever its plan: a fourth sign-in ends the one used
  least recently (*Sign-in flow*). One inbox shared by a team keeps 3
  browsers at a time, and each new one needs a fresh code from the inbox,
  at most 5 an hour an address. The audit counts each cap's sign-out
  (`signed_out`, `cap <n>`); nothing blocks an account for it.
- **Fail open to outages, closed to revocation.** When the database cannot
  be read, a session this Worker instance verified within the last hour
  keeps its last known state, its plan until the plan's own end; past that
  hour, or for a session the instance never verified, the request is
  treated as one the database cannot answer (the free view on a public page,
  since `planOfRequest` never throws; the "cannot be reached" page on an
  account page). A revocation made through another instance is therefore
  unseen for at most an hour. An API key this instance verified within the
  hour keeps its last known answer the same way; any other key gets a 503,
  since a key of the right shape proves nothing until the database has
  seen it. When the
  database says a session, a key or an entitlement is revoked or ended, it
  stops on that request. A response to a key is sent `private, no-store`.
- **Stop links.** Each delivered search has a 16-byte random secret, the one
  secret kept in clear, because every message carries it in its stop link.
  It can turn that one search's delivery off and nothing else; a wrong or
  stale link is the site's 404.
- **No PII in logs or audit.** Log lines and audit details name events and
  counts, never an address, a code, a token or a key. Workers invocation
  logs are off (`observability.logs.invocation_logs` in `wrangler.jsonc`):
  they record each request's URL, and the sign-in link's token and a
  delivery's stop secret travel in a query string. The console lines are
  kept.
- **Prepared statements only.** Every query binds its values.

## What is deliberately not stored

No names, postal addresses, phone numbers or passwords. No copy of a
delivered message: a delivery row keeps the time, the count and the status.
No IP addresses: a
sign-in request keeps, for one day, a hash of the address under a key that
changes every UTC day (and nothing without `VIEWS_SALT_KEY`). No user agents:
a session keeps the device class only. No codes, link secrets, session
secrets or API keys in clear. No payment details. No log of keyed API
requests: `api_usage` holds a number per key per day, and the Worker's
logs name no key.

## Deletion

`/account/delete` asks for a ticked box, ends the account's seats on both
sides (*Seats*: the seats it gives and its open invitations end `closed`
with their addresses cleared, the seat it holds ends `deleted`, and every
invitation to its address that was never taken is deleted), deletes the
account's dashboard
(every dashboard with its tiles, and its earlier panels), its saved views
(with their runs), its watches, its
claim of an organization, its briefings, its weekly email row and its
calendar feeds (statements of their own, so a database without those tables,
`seats` among them, still deletes the rest), then in one batch: revokes every
session; deletes the saved searches (with their delivery rows, stop links
and records marks), the API keys (their daily counts go with them, by the
cascade on `api_usage`), the bug reports, the watches and the watch mail row, and the address's sign-in requests; and marks the user row deleted with its
email replaced by `deleted:` and SHA-256 of a random salt and the address,
the salt thrown away. The row then proves nothing about which address it
was, and the address can sign up again as a new account. The address's rows
in the alerts form's table are deleted too. The entitlement rows stay, tied
to the user id alone, as the record of what was granted. Every subscription
that can still bill (the bound one, and any other a live Stripe row names)
is cancelled at Stripe before any of this, and the account is kept if
Stripe cannot confirm one (*Payments*). The page names the plan the
subscription pays for ("A subscription to Pro, if there is one, is
cancelled first ...", or Ultra; "A paid subscription, ..." for an account
with none), and, while the billing page offers Refund now, says so with a
link to it: "Refund now, on the Plan and Billing page, still returns your
first payment in full. Deleting the account refunds nothing." Deleting the
account inside the 14 days refunds nothing by itself.

A deleted account's rows, its address among them, stay in the copies of
the database until those copies are replaced: the weekly exports for up to
eight weeks and the database's own history for 30 days (*Backups*). The
privacy page says so.

**A payment that lands after the deletion.** A paid notice
(`checkout.session.completed` paid, or `invoice.paid`) can reach an account
no longer active: the reader deleted it with Stripe's checkout open in
another tab, or deleted it before a payment's notices landed. The webhook
then cancels the subscription at once and grants nothing, as before, and
the payment itself is refunded in full through Stripe (the operator's
ruling of 2026-11-14). The code is `cancelForDeleted` and `refundLanded` in
`site/src/account/billing.tsx`; the tests are
`site/test/recs-money.test.ts`. In order:

1. `DELETE /v1/subscriptions/<id>`; a cancellation Stripe cannot confirm
   answers 500, so the notice comes again.
2. The audit row `plan_changed` "stripe paid on a deleted account,
   cancelled <sub id>", written once.
3. The payment: the charge the invoice names, else the invoice the notice
   names (`GET /v1/invoices/<id>` with its payments, the charge found as the
   console finds it), else the subscription's newest paid invoice that took
   money (a checkout naming no invoice). A charge refunded in full already
   (by an earlier notice of the same payment, the console or Stripe's
   dashboard) counts as refunded and nothing is asked.
4. The refund: `POST /v1/refunds` with `charge=<id>` and no amount, under
   the header `Idempotency-Key: operator-refund-<charge id>`, the console's
   and Refund now's own key and parameters. The checkout and the invoice of
   one payment, a notice delivered again, and a retry after an answer lost
   on the way back make one refund: Stripe gives the first answer back
   under the key for at least 24 hours ("Retries with the same key return
   the saved response, including 500 errors",
   docs.stripe.com/api/idempotent_requests), and "Once entirely refunded, a
   charge can't be refunded again" (docs.stripe.com/api/refunds/create). A
   refund Stripe gives as `succeeded`, `pending` or `requires_action` is
   taken; otherwise the charge is read again, and refunded in full there is
   taken too.
5. The customer and the cancelled subscription are bound to the deleted
   account (`payment_customers`, status `canceled`), so the refund's own
   notices find it.
6. The outcome, a second audit row with the same words and then "refunded",
   or "unrefunded <reason>".

A refusal that asking again cannot change is recorded and the notice
answers 200, so a payment that cannot be refunded does not keep its notice
coming back: a disputed charge (Stripe: "You can't issue a refund outside the
dispute process while the dispute is open"; no refund is asked,
`charge_disputed`), a refund Stripe gives back `failed` or `canceled` (its
`failure_reason`), a refusal answered 400, 402 or 404 (Stripe's error
`code`, or `refused`; "Retrying a cached 400 response with the same key
returns the same error", docs.stripe.com/error-low-level), no invoice or
charge that took money (`no_charge`), and a charge of another customer
(`other_customer`, never refunded). Stripe's documentation names no age
past which a card payment cannot be refunded; a refusal for its age would
be one of those answers. Anything else (409, 429, 401, 403, a 5xx, no
answer, an `idempotency_error`) answers 500, and the notice comes again.

The refund's own `charge.refunded` records the charge in
`payment_reversals` once and ends nothing (the account has no live row);
`refund.failed`, if the card cannot take it, writes `refund_failed` under
the account's id as for any refund. The daily check reads the audit rows
(*Payments*, *Known limits*): "refunded in full", "could not be refunded
(<reason>)", or, while only the first row stands, "not confirmed yet".
A subscription that could still bill but reports no payment ("stripe live
on a deleted account") is cancelled and named as before, with nothing
refunded. The delete page's lines are unchanged: a late `invoice.paid` for
the subscription the deletion cancelled changes nothing, as before, so a
period paid while the account was open is not refunded by the deletion. The
one exception is under *Payments*, *Known limits*.

## Backups

Two copies of `awardwatch-accounts` exist outside the database itself.

- **D1 Time Travel**, Cloudflare's own history of the database: always on,
  30 days on the paid plan, restorable to any minute in that window. It is
  the first resort for anything noticed within 30 days, and it needs no
  file.
- **The weekly export.** The nightly's step "Weekly export of the accounts
  database" runs on Sundays (UTC) and exports the whole database with
  `wrangler d1 export awardwatch-accounts --remote`, gzipped, to the R2
  bucket `awardwatch-data` under `backups/weekly/accounts-slot-<n>.sql.gz`
  (the slot is the count of whole weeks since 1970-01-01 modulo 8, as the
  database snapshot beside it counts it, so each export replaces the one
  from eight weeks before) and `backups/weekly/accounts-latest.sql.gz`. It
  is the one copy outside the database's 30 days of history. The prefix is
  private: no route on the site reads it, and the files hold the accounts'
  email addresses, so nothing prints them and the runner's copies are
  removed when the step ends. A running export blocks the database's other
  requests, which is why it runs once a week and not every night. An export
  that fails is an item needing attention in the run (`accounts_backup:
  failed` in the run status), and the daily check's email says when the
  newest copy is more than 9 days old (`ACCOUNTS_BACKUP_STALE_DAYS` in
  `site/src/watchdog.ts`). Before the first Sunday after the step landed,
  there is no copy and the check says nothing of it.

Deleting an account removes its rows from the database at once; the copies
keep them until they are replaced (eight weeks for the exports, 30 days for
the history). The privacy page states both figures from `BACKUP_WEEKS` and
`HISTORY_DAYS` in `site/src/account/privacy.tsx`;
`site/test/accounts-switch.test.ts` holds `BACKUP_WEEKS` to the workflow's
`% 8`.

### Restoring by hand

The operator's step, from `site/` with a token that can edit D1 and read R2.

1. **Time Travel first**, for a fault within 30 days: find the moment before
   it (`npx wrangler d1 time-travel info awardwatch-accounts --timestamp
   <ISO time>` gives its bookmark), then `npx wrangler d1 time-travel
   restore awardwatch-accounts --bookmark <bookmark>`. The restore takes the
   whole database back to that moment; the command prints a bookmark to undo
   it.
2. **The weekly export**, for anything older, or a database that is gone:
   download a copy (`npx wrangler r2 object get --remote
   awardwatch-data/backups/weekly/accounts-latest.sql.gz --file
   accounts.sql.gz`, or a slot's key for an older week), `gunzip` it, and
   apply it to an empty database: a new one made with `npx wrangler d1
   create`, its id put in `site/wrangler.jsonc` in place of the old one
   (and in `intraday.yml`'s `ACCOUNTS_DATABASE_ID`), then `npx wrangler d1
   execute <name> --remote --file=accounts.sql`. The export holds the schema
   and the rows, so `accounts_schema.sql` is applied after it only for what
   the schema gained since. Everything written after the export (sign-ins,
   saved searches, payment notices) is lost; Stripe's dashboard holds the
   payments of that time.
3. Keep the downloaded file off any shared folder and delete it once the
   restore is checked: it holds every account's address.

## Bug reports

A Pro account can report a bug at `/account/bug` (feature `bug_reports`;
the code is `site/src/account/bugs.tsx`). The account overview has a row for
it and the footer of every page has a "Report a bug" link, both only for a
signed-in Pro reader, so public pages stay as they are for everyone else. A
Free account that opens the page is told the form is part of Pro, with the
link to the plans; its post is refused with a 403. The billing page lists
the form among what Pro includes.

The form asks for the page address (filled in from the Referer when it is
one of the site's own pages; optional; a path on the site, or a full
address on its host, at most 300 characters), what happened (required, at
most 2,000 characters) and what was expected (optional, at most 1,000). An
address under `/account` keeps its path alone, so a sign-in token or a stop
link's secret never lands in a report. The page says no reply is promised
and that fixes show up on the site, and points data questions to the
corrections page.

A post passes the usual guards (session, CSRF, `Origin`) and counts against
`FORM_LIMIT` with the other forms (`bucketFor` in `site/src/limits.ts`; while
the switch is off it counts as a page, as any unknown path does). It stores the row (at most 5 per account
in any 24 hours, counted inside the insert; a sixth answers the form with a
message, 429; the same page, text and expected from the same account within
ten minutes, the form posted again by a reload of the answer, is neither
stored nor sent, and answers the same "sent" page), then sends the operator a plain-text message through the
daily check's path: the `ALERTS` binding, from `ALERT_FROM` to
`ALERT_EMAIL`. `MAIL` is never used for it. The subject is "Bug report from
a Pro account"; the body (base64, since a report can hold accents and long
lines) carries the report's id, the page, the plan, the user id, the
language, what happened and what was expected, never the address. A
message that cannot be sent leaves the report stored and a log line with
the binding's error code alone. The audit row `bug_reported` records the
outcome as its detail: `sent`, `failed` or `not_configured`.

The `bug_reports` table must be on the remote database before the switch
is turned on with this code: deleting an account clears it in the same
batch as the rest, so without it the deletion answers 503. Re-applying
`accounts_schema.sql` adds it (*Operator steps*, step 1).

## Save this search

`site/src/account/search_control.tsx`. A signed-in reader sees `Save this
search` (`Enregistrer cette recherche`) on the tender list and on a window of
contracts ending, as the last row of the filter toolbar, outside the phone's
fold; and under the head of a segment page and the contracts ending
overview, as one line, the button beside the filter's label (the label the
email list's block shows). An organization's and a buyer's addresses are
saved searches too (`kindOfPath` in `site/src/pages/interest.tsx`), but their
pages keep `Follow` as their one control, since the two would ask a reader
the same thing there; their saved search is made with Add a Search on the
searches page. The button is always a flat one: each page keeps its
filled button on its own action (`Apply` on the lists). With the switch off,
for a reader not signed in and when the accounts database cannot be read,
nothing renders and the page keeps every byte; the Email Lists block is
unchanged. The form carries the session's CSRF value, so it renders only on
a page the layout sends `private, no-store`.

The states: the button; `Search saved` (`Recherche enregistrée`) and the line
`Manage your saved searches`, both links to `/account/searches`, as a saved
briefing reads, once the page's filter is saved; at the plan's cap, for
Free the searches page's own gate note (`account.cap_note`, with the Pro chip
and the link to the plans), for a paid plan what the account holds of its
figure, the briefings counted with the searches: "This account holds 25 of
25 saved searches and briefings. Ultra holds up to 100." while Ultra is on
sale above the plan's figure, "This account holds 25 of 25 saved searches
and briefings, the most an account keeps." otherwise (`searches.ts`
`paidCapLine`), with the searches page's link. One statement reads all of
it, the filter's row (its id and its email) by the table's unique key and
the account's count with its briefings, which share the cap (`searches.ts`
`searchState`).

A saved search is kept with its email off on every plan, and nothing turns
it on by itself. To a plan with delivery, a saved search whose email is off
reads so beside `Search saved`: "Its email is off." with `Email it daily`
and `Email it weekly`, link-styled buttons that post `deliver` to `POST
/account/searches/<id>` with `next`, this page, where the answer returns
(held to `safeNext`). On a toolbar they submit the row's detached form to
that address (`formaction`); under a head they are a form of their own. The
searches page says the same under each such search's delivery select.

A press is `POST /account/searches`, the searches page's own Add a Search
post, with one more field: `next`, the page to return to. The address in
`url` is rebuilt by `interestFilter` (an address that is not such a page, or
names nothing the data holds, is refused with the searches page's own line
and a 400; a window's organization, client department and holder's record
filters are not part of the rebuilt filter, so a saved search never keeps
them), the insert is held to the cap and stores a filter once
(`addSearch`), and `search_added` carries the detail `<kind> on its page`
(a pasted address keeps the kind alone). The answer is a 303 to `next`, held
by `safeNext` to a path on this site (an unsafe one is dropped for the
filter's own page), with `lang=fr` added for a French page whose address
lacks it. There the control reads saved, or shows the cap when nothing was
added; a filter saved already answers the same and stores nothing.

On the tender list the filters change in the browser. The toolbar is itself
the filters' form, so the row's button submits a form of its own placed
after the toolbar (`id="save-search"`, by the button's `form` attribute).
`public/tenders.js` writes the view's address into that form's `url` and
`next` after each draw, so a press saves the view shown; without the script
the toolbar is a plain GET form and the server writes the fields for the
address loaded. Whether a view is saved is known only for the view the page
was served with: `searchKey` in `public/tender-query.js` reduces a view to
what a saved search keeps (the filters, without the closing window, the
order and the page), and the saved state shows while the view's key is the
served one, the button (or the cap) otherwise. `site/test/tender-query.test.ts`
holds the key to the server's saved filter; the rest is
`site/test/accounts-save-search.test.ts`.

## Phase 2: delivery

The delivery job is `site/src/account/deliveries.ts`; the messages are
`site/src/account/digests.ts`, built on the approved designs in
`design/email/` (the daily digest and the radar digest; the records digest
uses the same shell and rows); the records side of the organization, buyer
and segment kinds is `site/src/account/records_deliveries.ts`; the tests are
`site/test/accounts-deliveries.test.ts` and
`site/test/accounts-records-deliveries.test.ts`, with the run log, the day's
sending ceiling and the order of the lists in `site/test/recs-ops.test.ts`,
and the grouped message, its stop link and the searches passed over in
`site/test/recs-group.test.ts` (its size and layout in the mail suite,
`site/test-mail/group.test.ts`), and a radar search's contracts first seen
since its last delivery in `site/test/recs-radar.test.ts` (the pipeline's
side in `pipeline/tests/test_expiring_first_seen.py`).

### When it runs

The Worker has four cron triggers (`site/wrangler.jsonc`): `0 6 * * *`, the
daily check; `0 15-20 * * *`, the deliveries; and two that start the nightly
and the same-day job through GitHub's API (`docs/site-deploy.md`, "What
starts the runs"). `index.tsx` routes each by its exact expression, the
hourly one to the job, and one it does not know runs nothing. The nightly
run publishes about 12:30 UTC (later on a retry), so the 15:00 run is
normally the one that sends, and the hours after it cover a late nightly, a
run cut short, or the rest after a sending limit.

Each run does nothing unless all of these hold, in this order:

1. `ACCOUNTS_ENABLED` is `"true"` with the `ACCOUNTS` binding, `MAIL` and
   `MAIL_FROM` are set, and `SITE_URL` is an https address (the stop link in
   `List-Unsubscribe` must be one).
2. `stats.json` reads, and its `data_as_of` is today's UTC date: the
   nightly has published today's files. A nightly that lands after the
   20:00 UTC run sends nothing that day; the next day's delivery covers
   both days.
3. For each saved search, those of accounts whose cached plan
   (`users.plan`) is paid first, then oldest first: delivery `daily` or
   `weekly` (every kind can be delivered, below), an active account whose
   plan allows `delivery` (`planFor`, so a lapsed or revoked plan stops at
   once), and due: not delivered for this data date (the date of
   `last_delivered_at` is earlier); for weekly, never delivered or last
   delivered seven or more days before. A search whose message failed for
   this data date waits for the next data date. The cached plan only orders
   the list, so the searches of accounts that moved down to Free come after
   the ones paid for; `planFor` decides at the send, and a stale cache only
   moves a search in the list. A search read and passed over because its
   account's plan has no delivery, or because it is past the plan's figure,
   is marked for the data date as a claim would mark it, with no
   `deliveries` row (`passedOver`, `PASSED_OVER_SQL`, 100 a batch, and none
   once too little of the query budget is left for a claim), so it leaves
   the list and is not read again every hour, as the watch mail, the
   briefings and the saved views pass theirs over. A plan restored that day
   sends from the next data date on (a weekly search, a week after).

The list is then taken account by account (`byAccount`: each account where
its first search stood, its searches in their own order, `created_at` then
id), and all of an account's due searches are read before any of them is
sent, so the run knows how many have news (*What it sends and writes*).

Every run that gets past the first check writes its row to the run log,
`delivery_runs`, whatever the way it ends (*What it sends and writes*), so a
nightly that did not land is a row as well: up to six small rows a day.

### What each kind delivers

For the tender and radar kinds the items are the records since the previous
delivery's data date, at most seven days back; a first daily delivery covers
the data date alone, a first weekly one the last seven days.

| Kind | Read from | Items |
|---|---|---|
| `tenders` | `tenders/new/<day>.json` for each day after the previous delivery's data date up to today's | the notices first seen on those days that match the saved filter, read by the same parser as `/tenders` (`readTenderQuery`, `filterTenders`), still open at the run's time, soonest closing first; a notice closing within 7 days of the data date shows its time left in amber |
| `expiring` | `expiring/<window>/index.json`, its pages read from the last page back, and its list of new rows (`expiring/<window>/new/<n>.json`) read from the first page | the window's contracts that entered it since the previous delivery's data date, each listed once: those whose end date is inside the window at today's data date and was outside it at the previous delivery's data date (the window's length is the radar's, 91, 182 or 365 days), and those inside it at today's data date that the site first saw after the previous delivery's data date, up to today's (*Contracts first seen since the last delivery*, below); filtered as the radar's form saved them (`readExpiringQuery`, `filterExpiring`), newest end first |
| `organization` | the records database (`RECORDS`): `records` through `records_org`, rows with `extra = 0` | award notices, PSPC contract history, published contracts and grants naming the organization: each source and fiscal year whose count rose since the last delivery |
| `buyer` | the records database: `rec_buyer_quarters` | the buyer's award notices, contract history and published contracts (its label names no grants), the same way |
| `segment` | the records database: `rec_segment_years`; and `tenders/new/<day>.json` as for a tender search on `/tenders?segment=<nn>` | award notices and contract history in the segment, the same way, and the segment's new tender notices, which its label names too |

A file that does not read (today's new-notice file, a window's index or
page, a page of its list of new rows) ends the run with one log line naming
it; the next hour tries again. An account's searches are all read before any
of them is sent, so the searches of the account whose file did not read wait
with it.

#### Contracts first seen since the last delivery

A contract enters a radar window in one of two ways: its end date comes
within the window's length of the data date, or the site first sees it while
it already ends inside the window. The second is a new award notice, a
month's PSPC contract history, or a week's published contracts (the
contracts stage reads its file once a week), ending for instance 40 days
after the data date. The radar page lists such a contract the night it
arrives, and a radar search mails it with the next delivery.

- The nightly writes the day the site first saw each radar row's contract
  as `expiring_contracts.first_seen` (`expiring.py`). A record's own day is
  the earliest `first_seen` of its versions for an award notice or a history
  record (set when the CanadaBuys loader first inserts a version and kept by
  every later upsert), or of its group's rows for a published contract
  (`contracts.first_seen`: the run date the row's department and reference
  first appeared in the table, carried over each time the weekly load
  rewrites the table whole). The row's day is the earliest of its record's
  and of the records the radar's duplicate rule dropped against it, so a new
  award notice for a contract a department published months ago is not new.
- A row has no day, and nothing about it is mailed as new, when one of those
  records has none or was read on its table's first night: an award notice
  or history record whose `first_seen` is its table's earliest (the first
  load saw every record of the files at once), or a published contract
  stored before the column existed or loaded into an empty table.
- Nor on or before the day the radar began keeping it, the meta value
  `expiring_first_seen_from`, set by the first build that has the field and
  again by any build whose previous table was empty. The night this first
  runs, and a night the database is rebuilt from nothing, therefore mail
  nothing beyond what the end-date rule mails.
- A build in which more than half of a window's rows, and more than 500
  (`NEW_SHARE_MAX`, `NEW_FLOOR`), would count as first seen in the last 7
  days is taken for records loaded again some other way: no row keeps a day,
  the day the radar began moves to that night, and the run log carries a
  notice.
- The export writes each window's rows first seen in the 7 days to the data
  date (`NEW_SPAN_DAYS`, equal to the delivery's `SPAN_DAYS_MAX`) as
  `expiring/<window>/new/<n>.json`: the window's row with `seen`, the day,
  beside it, newest day first, 500 a page, with `new_pages` and `new_rows` in
  the window's index. The window's own pages do not change.
- The delivery reads that list from its first page and stops at the first
  page that reaches back to the previous delivery's data date, so a
  delivery the day after the previous one reads the pages holding the data
  date's rows and one more at most.
  Each file is read once a run, however many searches name the window
  (`publishedFiles`). A window index without `new_pages`, written before the
  list, gives none, and its searches send what they sent before.
- The message keeps its lines: "3 contracts now within 3 months of their
  end" holds for both ways in.
- A database restored from an older backup loses the nights after it; their
  records are inserted again with the night they come back as their day, so
  a search may mail them a second time, as the new tender notices of those
  nights are listed again.

#### Organizations, buyers and segments

The records database holds one row per counted record with its source and
fiscal year, but no day the record was first seen, no title and no
reference, and no published file dates a record's first sighting either
(the radar's lists of new rows date only the contracts ending within 12
months, the past week's). So these kinds cannot list the records added since
the last delivery one by one. What the database can say exactly is how many records each source
holds in each fiscal year for one organization, buyer or segment, and that
is what is delivered:

- Each delivery reads those counts for the ten fiscal years ending with the
  data date's (one D1 batch: the state row, the counts and the name; every
  statement a constant in `records_deliveries.ts`, bound to a checked id and
  the fiscal years, ending in a `LIMIT` of 40, 30 or 20 rows, and read
  through `records_org`, `rec_buyer_quarters_buyer` or
  `rec_segment_years_segment`; the tests read each plan).
- It compares them with the counts its previous delivery kept, the search's
  row in `delivery_marks`, and lists each source and fiscal year whose count
  rose: by how many, the count now, and the counted value now, newest year
  first, each row linking the entity's analytics view on that source. The
  subject names how many new records in all ("{n} new records"). A count that fell (a record
  withdrawn) is not reported. A year the previous counts did not read (the
  window moved at the turn of a fiscal year) is not compared.
- A first delivery has nothing to compare with: it keeps the counts and
  writes an `empty` row; the next delivery reports what rose since. So does
  a delivery after the records' counting rules changed (`rec_meta.rules`),
  since a reload under new rules moves counts that were never new.
- A rise means a record was added to that source and year, or a correction
  moved one into it (a new buyer, organization, segment or date); the
  message's note says so and points to the page, which lists each record.
- The mark is written in the same batch as the `sent` or `empty` row. A
  `failed` row keeps the old mark, so the next delivery reports the same
  rise.
- A segment search also lists the segment's new tender notices since the
  previous delivery, as a tender search would; the message then has two
  parts, the notices first. A first delivery sends them. At most 50 rows in
  all: the counts (20 at most for a segment) first, then the notices, with a
  line linking `/tenders?segment=<nn>` for the rest.

An organization or a buyer the nightly merged into another (the aliases the
profiles and buyer pages redirect through, `watches.ts` `survivorOf`) is read
at the surviving id from then on (`deliveries.ts` `survivingEntity`); the
search's row and its label keep the id saved, and an account that also saves
a search on the surviving id keeps both. The first delivery read at the
surviving id has nothing to compare with: the merge moved records into it that
were never new, so it keeps the counts and writes `empty`, as a first delivery
does, and the next delivery reports what rose since. The mark then names the
id it was read at (a mark without one was read at the saved id). A tender or
radar search filtered on a merged buyer (`buyer=`, `client=`) or organization
(`supplier=`) reads and links the surviving id the same way
(`survivingParams`).

Until the records database is ready at today's data date, these searches
wait: no row is written, nothing is claimed, and the next hour reads the
database again. The run's report (`records`, `waiting`) and its log line
say why, once a run: no `RECORDS` binding (`absent`), a load under way
(`loading`), a statement that failed (`failed`, logged as a D1 code), a
database whose `as_of` is not the data date because tonight's sync did not
finish (`stale`), or an accounts database without the `delivery_marks`
table (`no_marks`). The tender and radar searches of the run go on as
usual. A nightly whose records sync fails leaves these searches undelivered
that day; the next day's delivery compares with the same previous counts,
so it covers both days.

### What it sends and writes

- Nothing new: a `deliveries` row `empty`, no message, and
  `last_delivered_at` moves to the run's time.
- Otherwise, when five or fewer of an account's saved searches have
  something to report in the run (`GROUP_OVER`, 5), one message per saved
  search, in the search's language, through the accounts sender
  (`senderFor`, the `MAIL` binding), with the subject, rows, button, note
  and footer of the design. A message lists at most 50 rows; past that, a
  line names how many more and links the page. A `deliveries` row `sent`
  (with the number of records matched; for the records kinds, the records
  added plus the notices) moves `last_delivered_at`; `failed` leaves it, so
  the next data date's delivery covers what this one missed.
- More than five: all of them in one message (`digests.ts` `groupDigest`),
  every kind together (tender, radar, organization, buyer and segment
  searches). The subject says how many have news and names the data date
  ("News on 8 of your saved searches, data date 2026-10-31"). Under the
  title and a lead that says why they came together, a section a search in
  the account's order (the searches page's): the search's label in its band,
  its count as a link to its list on the site ("3 new tender notices", "3
  contracts now within 3 months of their end", "1 new tender notice, 2 new
  records"), its newest rows as its own message lists them (the tender rows
  with their segment chips, the radar's rows, a segment's notices then the
  counts that rose), the line for the rest of its rows ("And 4 more on the
  site"), and its own stop link, "Stop this search's email". A band's
  heading is never a link (the mail suite holds every heading alone in its
  band), so the count under it carries the link. The rows of the whole
  message are held to `GROUP_ROWS_MAX` (30), at most `GROUP_SECTION_ROWS`
  (5) a section; a search reached once the 30 are listed is one line, its
  label linking its list and its count, under one band ("94 more saved
  searches with news") with a line saying why, so no search is left out.
  Those two figures, and not the single message's 50, keep the message
  under the size at which a webmail client clips it: 100 busy searches make
  about 71,000 characters of HTML in English and 76,000 in French, held
  under 100,000 by the mail suite. Then the button to the saved searches
  page, the notes of the kinds it carries (closing times, a contract's
  value, the records counts), and the footer: why it came, the saved
  searches page, and "Stop the email of these searches", the link that
  turns off every search in the message (*Stopping a delivery*). Plain text
  and HTML parts, the same shell, footer and headers as a single message,
  with `List-Unsubscribe` naming that link.
- A grouped message is in the account's mail language (`users.lang`, the
  overview's Mail language control), whatever the pages its searches were
  saved from: a label saved in the other language is written again in it, as
  the searches page writes it (`interestFilter`; an organization or buyer by
  the name the records database holds), and stays as saved when it no longer
  writes. Every link in it carries that language. Five or fewer go each in
  its own search's language, as before.
- Bookkeeping stays a search's own. Each search of a group is claimed on
  the same conditions as a single one (delivery on, not delivered for the
  data date), its statements in one batch, so a search stopped or delivered
  since the list was read drops out of the group and the rest go. After the
  send, each search's `deliveries` row, `last_delivered_at` and, for a
  records search, its mark are written in one batch (`afterSend`, tried once
  more on a fault). A send that does not go gives every claim of the group
  back in one batch, with each search's `failed` row when the mail service
  refused the message, or none at a sending limit, which stops the run. A
  group is sent whole or not at all.
- A group that its claims leave at five or fewer (stop links clicked between
  the run's read and its claims) is five or fewer with news, so each goes as
  its own message, in its own language, as five or fewer always do, on the
  claim already held: the first was taken up with the group, and each later
  one is held to the run's cap, the day's ceiling and the query budget as a
  message of its own. When one of them stops the run (the cap, the ceiling,
  the budget or a sending limit), the claims not yet sent are given back in
  one batch, so none is lost and none is sent twice.
- Counts. A grouped message is one message against the run's cap, the day's
  ceiling and the run log's `sent`, as the quota counts it; each search it
  carried has its own `deliveries` row, so the console's "Deliveries sent"
  counts a search a row, and its "Messages sent by the delivery job and the
  console's runs" counts the run log's messages. The run's report keeps both:
  `sent` and `failed` are messages, `groups` the grouped messages sent and
  `grouped` the searches they carried, so the searches sent in a run are
  `sent` less `groups` plus `grouped`. Its log line says "12 sent (1 of them
  grouped, carrying 8 searches)".
- An account whose searches are taken up across two runs (a cap, the
  ceiling, the query budget or a wait for the records database between
  them) may get them in two messages; no search is sent twice, since each
  keeps its own claim for the data date.
- At most 300 messages a run. A refusal with `E_DAILY_LIMIT_EXCEEDED` or
  `E_RATE_LIMIT_EXCEEDED` stops the run with no row for that search, and
  the next hour goes on from there. Any other refusal is a `failed` row.
- At most the day's ceiling in a UTC day, across every part and every run:
  `MAIL_DAILY_QUOTA` less `MAIL_DAILY_RESERVE` (960 as shipped; *Sending
  mail*). The run reads the day's sends from `delivery_runs` once
  (`DAY_SENT_SQL`), adds its own, and stops before the next claim once they
  reach it, as a sending limit's refusal stops it (`limited`, the reason
  "the day's sending ceiling of 960 messages (MAIL_DAILY_QUOTA 1000 less
  MAIL_DAILY_RESERVE 40)"). Nothing is claimed and left unsent; the later
  runs that day stop at their first message, and the next UTC day goes on.
- At most 850 database queries a run (`RUN_QUERY_BUDGET`, counted on the
  accounts and the records databases together, a batch as one). D1 allows a
  Worker invocation 1,000 queries on Workers Paid, a `db.batch()` counting as
  one, and fails every query past them ("Queries per Worker invocation",
  https://developers.cloudflare.com/d1/platform/limits/); each hourly run is
  one invocation. Once the run has made 850, no part takes up another search,
  account, briefing or view: the run stops as the message cap stops it
  (`capped`), and the next hour goes on from the claims. No item is claimed
  unless the claim and every write after it (`CLAIM_QUERIES`, 8) and the
  run log's row (`RUN_LOG_QUERIES`, 1) fit under 1,000, so the run never
  stops between a claim and its row and always has the query for its run
  log. Six runs a data date allow 5,100 queries a day. Measured under test:
  a saved search sent costs about 3 queries, an account's watch mail about
  9, an account passed over on its plan 1 (its plan, read once a run). A
  grouped message costs at most 4 queries from its claims to its last
  write, whatever its size (`GROUP_QUERIES`: one batch of claims, one for
  the stop secrets it lacks, then one batch of rows and marks tried twice at
  most, or one batch giving the claims back with the failed rows), measured
  at 3 for 6 searches and for 40, and inside the 8 every claim holds back,
  so the budget covers the whole group before any of it is claimed. Its
  reads come first (an organization, buyer or segment search 2 queries, a
  tender or radar search none but a merged id's); once the budget is spent
  while an account's searches are read, the account waits whole for the next
  run with nothing of it claimed but the searches with nothing new already
  written.
- A fault reading or writing the accounts database logs one line and ends
  the run. A second run in the same hour finds nothing due. Every message
  sent or refused before the fault, in whichever part, stays in the run's
  row: each part fills the run's report as it goes and counts a message
  before the writes that follow it, so a fault in those writes, in a grouped
  message's, or in reading the next item cannot take a message out of the
  count, and a later run of the day reads it against the ceiling.
- Each run that gets past the switch ends with one row in `delivery_runs`
  (`writeRunLog`), on every way out, a fault included: `at` (the run's
  time), `data_date` (the date `stats.json` gave; NULL when the run stopped
  before reading one), `outcome` (`done`, `capped`, `limited`, `fault`,
  `not_today`, `no_data`, `no_mail`), `sent` and `failed` (the messages sent
  and the ones the mail service refused, across the six parts (the sixth,
  the seat notices, only while the seats' switch is on), a grouped
  message once),
  `left_due` (the items still due when it ended: those that waited, and
  from the one a stop or a fault was at, the rest of that part's list whose
  plan would send them, by the plan read in the run or the cached plan;
  the parts the run never reached are not read, so not counted; 0 when it
  finished) and `detail` (why it stopped early or never began, at most 120
  characters of fixed words, dates and counts: a refusal's code, the cap,
  the budget, the ceiling, a fault's line, a missing setting, the data date
  it found, or the records database a wait was for; never an account or an
  address). The row is one batch with the deletion of the run log's rows
  older than 90 days. A row that cannot be written (no table, a fault) logs
  one line and changes nothing else. The console's bulk runs write rows to
  the same table with the outcome `console` (*Sending mail*); they count in
  the day's sends and in nothing else.
- `deliveries` rows older than 90 days go at each run, after the list of
  candidates is read, as the watch mail, the briefings and the saved views
  prune theirs. `deliveries` has no index on `sent_at`, so the statement
  (`DELIVERIES_PRUNE_SQL`) deletes by the key: the rows below the first one
  sent within the 90 days. Each row's id is above every earlier row's and
  its `sent_at` is its run's time, so those are the old rows; it reads them
  and one row more instead of the whole table. Nothing reads an older row:
  the run asks for a failed row of the data date, the searches page and the
  console's user page for each search's newest row and the account's last
  20, and the console's overview for the last 7 days. A search whose newest
  row is older than 90 days (its delivery off, or its account on Free, that
  long) shows no last delivery, as a search never delivered does. The
  privacy page says a saved search's delivery history is kept that long
  (`account.privacy_kept`, with `DELIVERY_ROW_DAYS`).
- The row after a message went (its `deliveries` row, `last_delivered_at`
  and, for a records search, the new mark) is written once more when the
  write fails (`afterSend`), so a passing fault does not leave the next
  delivery repeating what was sent. The batch is a transaction, so a failed
  one wrote nothing. A second fault ends the run as above.
- Each search is claimed for the data date before its message goes: one
  statement sets `last_delivered_at` to the run's time only while its
  delivery is on and no run has delivered it for that date, so two runs at
  the same moment (a trigger fired twice) send it once, and a stop link
  clicked after the run read its list stops that run's message. A send that
  does not go, or a fault after the claim, gives `last_delivered_at` back as
  it was.
- Log lines carry dates, counts and file names, never an address or a label.

### Stopping a delivery

Every message carries a stop link, in its footer ("Stop this delivery") and
in its headers:

```
List-Unsubscribe: <mailto:contact@awardwatch.ca>, <https://awardwatch.ca/account/stop?s=<search id>&t=<secret>>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

The secret is 16 random bytes in `delivery_tokens`, made the first time the
search is delivered and kept until the search or the account is deleted.

- `GET /account/stop?s=...&t=...` shows the search's label and one button;
  opening the link changes nothing, so a mail scanner that follows it
  stops nothing.
- `POST /account/stop` with the same two values turns the search's
  delivery off and says so. A run under way when it lands does not send
  that search: its claim holds only while the delivery is on.
- The same `POST` with the body `List-Unsubscribe=One-Click` (RFC 8058, as
  a mail client sends it) turns the delivery off and answers a line of
  text, with no page.
- A wrong, malformed or stale link (a deleted search or account) answers
  the site's 404. No session and no `Origin` are asked for: the secret is
  the proof, and it can only turn that one delivery off.
- Both methods count against `STOP_LIMIT` (20 a minute per IP address)
  while the switch is on: each request reads the database, and one-click
  posts come from the mail providers' servers.

A grouped message (*What it sends and writes*) carries each section's own
link as above, which stops that search alone, and one link for the whole
message, in its footer and in `List-Unsubscribe`:

```
List-Unsubscribe: <mailto:contact@awardwatch.ca>, <https://awardwatch.ca/account/stop?g=<user id>&t=<tags>>
```

- The tags are one a search, in the message's order: the first 6 bytes of
  SHA-256 over "stop group", the search's id and its stop secret, in
  base64url, 8 characters each (`group_stop.ts` `groupTag`). No table holds
  the group; nothing in the schema changed. The route reads the account's
  searches with their secrets, computes each one's tag and acts on those
  whose tag the link holds (`provenBy`).
- `GET` shows those searches' labels and one button and changes nothing;
  `POST`, or a mail client's one-click `POST`, turns off the delivery of
  each of them and answers as the single link does ("The deliveries are
  off."). The searches stay saved, and the searches page turns their
  delivery back on. The audit row is `delivery_stopped` with the detail
  `group_link` or `group_one_click`.
- What a forwarded link can do: turn off the email of the searches in that
  message, and nothing else. Each tag proves its search's secret, which only
  that search's messages carry; a tag changed or made up matches a given
  search once in 2^48, a link under another account's id matches nothing,
  and a link that proves no search, or is malformed (not a whole number of
  tags, more than 100, a character outside base64url), is the site's 404.
  It deletes nothing and shows nothing but the labels the message already
  showed. A search deleted since drops out and the link still works for the
  rest, for as long as they exist, as a single link does.
- Why tags and not ids: Email Sending takes a custom header's value up to
  2,048 bytes (`E_HEADER_VALUE_TOO_LONG`) and folds long headers at
  whitespace only, so the URI must also fit a line of RFC 5322's 998
  characters. A hundred 32-character ids make about 3,300; a hundred tags
  make 800, and the header with 100 searches is 914 bytes in French. The
  live mail check sends a grouped message whose link is that long, so a
  `sent` result proves Email Sending takes the header (docs/mail.md, *The
  live mail check*).

A grouped briefings message (*Weekly briefings*, The run) and a grouped saved
views message (*Saved views*, The email) work the same way, each with a
parameter of its own: `/account/stop?gb=<user id>&t=<tags>` for briefings,
`/account/stop?gv=<user id>&t=<tags>` for saved views. A tag is made over
"stop briefings" or "stop views" with the item's id and its stop secret
(`briefings.secret`, `saved_views.secret`), so a briefing's tag never stands
for a search's. The route reads the account's briefings or views that hold a
secret and acts on those whose tag the link holds: `GET` names them and shows
one button, `POST` or a one-click `POST` turns off the email of each one
("The briefings are off.", "The views' email is off."), the audit row is
`briefing_stopped` or `view_stopped` with the detail `group_link` or
`group_one_click`, and a link that proves none is the site's 404. Each section
keeps its own `?b=` or `?v=` link. A briefing or view the message did not name
(one with nothing new that run, another account's) has no tag in the link and
is never stopped by it.

A reply to the `mailto:` address reaches the contact inbox, where the
operator turns the delivery off by hand.

### The searches page

Each search shows its newest delivery under its delivery select: when it
ran and whether it was sent (with the number of records), found nothing new,
or could not be sent. Every kind has the select. The read
(`searches.ts` `LAST_DELIVERIES_SQL`) goes through `idx_deliveries_search`,
as does the job's question whether a search failed today; a test reads both
plans. Delivery rows are kept 90 days.

### Checking a run

```
npx wrangler d1 execute awardwatch-accounts --remote --command "SELECT substr(sent_at, 1, 10) AS day, status, COUNT(*) AS n, SUM(items) AS items FROM deliveries GROUP BY day, status ORDER BY day DESC LIMIT 20"
```

The Worker's logs hold one line per run: the data date and the counts sent
(and how many of them were grouped messages, carrying how many searches),
failed, with nothing new and not on a plan with delivery, and, when the
records database kept some waiting, how many organization, buyer or segment
searches wait and why.

The run log, the last two days:

```
npx wrangler d1 execute awardwatch-accounts --remote --command "SELECT at, data_date, outcome, sent, failed, left_due, detail FROM delivery_runs ORDER BY id DESC LIMIT 14"
```

The daily check (06:00 UTC, `site/src/watchdog.ts`) reads the previous UTC
day's rows while the accounts switch is on and adds a line to its email
when no run was recorded; when no run read that day's data, so nothing was
mailed (with the runs' outcomes, and what to set when the Worker lacks its
mail settings); when the day reached its sending ceiling (the day's sends,
the ceiling and its two figures, what waited, and the Limit Increase
Request Form); when the last run left items due (its time, outcome, count
and reason); and when any run faulted (how many, and the first one's
reason). A day that went well adds nothing. A database without
`delivery_runs` is one log line and no line in the email. A row of the
console's (outcome `console`) is not a run of the job: a day with only such
rows still says that no run was recorded, the last run named is the job's,
and the ceiling's line counts the console's sends in the day's total and
says how many of them came from the console.

The records kinds' marks:

```
npx wrangler d1 execute awardwatch-accounts --remote --command "SELECT as_of, COUNT(*) AS n FROM delivery_marks GROUP BY as_of ORDER BY as_of DESC LIMIT 10"
```

## Calendar feeds

Dates as calendar events (RFC 5545), in two forms. The file writer is
`site/src/calendar.ts`; the one-event files `site/src/pages/ics.ts`; the
feeds `site/src/account/feeds.ts`, with their routes in `routes.tsx` and
their panels in `pages.tsx` (the searches page) and `watch_pages.tsx` (the
watches page); the tests `site/test/calendar.test.ts`.

**One-event files, public.** `/tenders/<reference>.ics` holds a notice's
closing; `/awards/<reference>.ics`, `/history/<reference>.ics` and
`/contracts/<department>/<reference>.ics` a contract's end, as an all-day
event. Each page links its file ("Add to calendar", "Ajouter au
calendrier") beside the closing or the end date while that date is still to
come and the record is not cancelled, whatever the accounts switch says. The
file itself answers for any record the data holds: a cancelled one carries
`STATUS:CANCELLED`. It is cached `public, max-age=3600`, counts against the
download cap, takes `?lang=fr` (which a French page's link carries), and
carries no `X-WR-CALNAME` or refresh hints, so importing it makes no
calendar of its own.

**Feeds, Pro.** `/account/calendar/<feed id>.ics?t=<secret>`, under the
feature `delivery`: a feed is a delivery, as mail is. The searches page has a
Calendar Feeds panel: a row for each saved tender search and one for all of
them together with the watches (kind `all`), each with the address, a copy
button (`public/calendar.js`), "Rotate the address", "Remove", when a
calendar last read it and how many events it holds now; then the three
subscription routes and the refresh schedule. The watches page has a
Calendar Feed panel with the same cell for the watches' feed (kind
`watchlist`, named "Watches", "Suivis"). A Free account sees the Pro chip
and one line on either page; signed out, the pages do not exist. A search
feed lists every open notice its filter matches now, read from
`tenders/open.json` through `readTenderQuery` and `filterTenders`, soonest
closing first. `&lang=fr` on the address writes the feed in French;
`&alarm=1d` adds a display alarm a day before each event.

The watches' feed lists, soonest first and each record once whichever
watches reach it:

- each followed contract's end, whatever its date, read as its one-event
  file reads it: the detail file of an award notice or a history record, the
  rows of a published contract (`PUBLISHED_CONTRACT_SQL`), so the event
  matches the file's UID and `SEQUENCE`;
- the contracts each organization and buyer watch holds in the radar's
  window (`rec_expiring`), ending from the data date to the watch's horizon:
  12 months when it follows `ends_12m`, 6 months (182 days) when it follows
  `ends_6m` alone, none when it follows neither. An organization is matched
  on the row's organization, a buyer on the row's buyer or its client
  department (as the radar's buyer filter and the incumbents read one), a
  buyer narrowed to a segment on that segment's mark as well. A watch on an
  id the nightly retired reads the surviving id (`survivorOf`, the function
  `followAliases` moves watches with; the feed only reads, and the page or
  the next mail run writes the move);
- the standing offers and supply arrangements each organization watch that
  follows `instrument_expires_6m` holds and that expire from the data date
  to 182 days on (`docs/sosa.md`), one all-day event per instrument and
  organization, read by the surviving id as the radar rows are;
- each followed notice's closing while it is in `tenders/open.json`, as a
  search feed lists it.

Each end's title starts with the holder ("Ends: {holder} · {buyer} ·
{title}"), a person's record reading "Individual, name withheld". The radar
rows come from `WATCH_ENDS_SQL` in `feeds.ts`: the organization and buyer
watches of the account, each in a slot of three bound values (the target,
the segment mark, the horizon's last day; 25 slots, 77 values, within D1's
100), through `rec_expiring_end` over the window's dates, soonest first, at
most 500 rows, with `COUNT(*) OVER ()` giving how many matched, so the cap's
last event counts the rows past the ones read. An account with more than 25
such watches (Ultra) sends one statement per group of 25 in the same batch;
the groups' rows are merged by the row's key, so a row two groups reach is
one event, sorted again and cut at 500 (`mergeEnds`; see *Ultra, Its
figures* for the count past the cut). Single published
contracts add one `PUBLISHED_CONTRACT_SQL` each to the same batch. A records
database that is absent, loading or failing answers 503, never an empty
calendar; a watchlist with no date in its horizon is a valid calendar with no
event. The searches page counts the `all` feed and the watches page the
watches' feed as the feed reads them.

- UID `notice-<reference>@awardwatch.ca` with the amendment number as
  `SEQUENCE`, so an amendment that moves a closing moves the event;
  `contract-<kind>-<reference>@awardwatch.ca` with the amendment count for
  an end. Times in UTC, converted as `closing.ts` converts a closing; the
  description repeats the closing as published, "Eastern time".
- A timed closing has no `DTEND`: RFC 5545 requires `DTEND` to be later than
  `DTSTART`, and a start without one ends when it starts. An all-day end's
  `DTEND` is the next day.
- Bounds: 500 events a feed, the 500th an all-day event on the data date
  saying how many more ("Award Watch: 312 more closing dates, see the site";
  "end dates" for a feed of contract ends alone, "dates" for both kinds) and
  linking the search's list, the watches page or the searches page;
  descriptions cut at 1,000 characters; 5 live feeds an account, one per
  search, one of the watches and one `all` (held inside the insert and by a
  unique index; the posts answer on the page the feed's row is on); 20
  reads a minute per IP address (`CALENDAR_LIMIT`, namespace 2010, only
  while the switch is on). The Atom feeds keep `FEED_LIMIT`.
- The file is `private, no-store`. A wrong, rotated or removed secret, a
  deleted search or account, a plan without `delivery` or a blocked account
  is the site's 404 on that read. A database outage serves a feed this
  instance verified within the hour from its last known state, its plan
  held to the plan's own end (the searches and the watches it lists are read
  with the feed's row, so they are held too); any other read then, and a
  `tenders/open.json` or a records database that does not answer, is a 503
  with `Retry-After`, never an empty calendar, which a client would read as
  every event gone.
- Kept: the row and `last_read_day`, written at most once a UTC day. The
  secret is kept in clear, as a stop link's is, since the page shows the
  whole address; the page says that anyone holding it reads what the feed
  lists. The file names no account and no address.
- A cancelled notice drops out of `tenders/open.json`, so it leaves a search
  feed, and a subscribed calendar removes its event on the next read. No
  published file lists the notices cancelled since a date, so a feed cannot
  keep them 30 days marked `STATUS:CANCELLED`. A followed notice leaves the
  watches' feed the same way. A followed award notice or history record
  that was cancelled keeps its event, marked `STATUS:CANCELLED`, as its
  one-event file does; the radar's rows carry no cancellation.
- An instrument's expiry comes from a second statement in the same batch,
  `WATCH_INSTRUMENTS_SQL`: the organizations' numbers in 25 slots (27 bound
  values; one statement per group of 25 organizations, merged and cut as the
  ends are), one row per instrument and holder organization with its regions'
  names, soonest first, at most 500, with `COUNT(*) OVER ()` for the cap's
  last event. The statement reads the instruments ending in the window
  through `rec_instruments_expiry (expiry)` (CROSS JOIN keeps them the outer
  table) and each one's holders through `rec_holders_instrument`. UID
  `instrument-sosa:<agreement>:<organization id>@awardwatch.ca`, so two
  followed organizations on one instrument are two events; `SEQUENCE` 0,
  since the records database does not carry the count of file publications
  that moved an expiry (`sosa_instruments.expiry_changes` stays in the
  pipeline); title "Expires: {agreement} · {type} · {holder}" ("Expire :
  ..."); the description gives the number, type, description, holder,
  regions, end user, start, expiry, active holders and the instrument's page;
  `CATEGORIES:Award Watch,Instrument expiry`.

The console's overview counts live feeds by kind and feeds read in the last
7 days; the user page lists the account's feeds (kind, created, revoked,
last read), never the secret. Deleting a search deletes its feed; deleting
the account deletes them all.

Operator step at landing: apply `accounts_schema.sql` again (*Operator
steps*, step 1), which adds `feeds`; `CALENDAR_LIMIT` deploys with
`wrangler.jsonc`.

## The accounts-open message

The Email lists page and the privacy page promise each address on the email
lists one message when accounts open, with a link to leave the lists. That
message is a job the operator starts by hand from the console, at
`/admin/announce`; nothing sends it on a schedule. The code is
`site/src/account/announce.tsx` (the run, the message and the leaving
link) and `admin.tsx` (the console page); the tests are
`site/test/accounts-announce.test.ts`.

### Who gets it

Each address in the forms database's `interest` table with a row not
unsubscribed and no row marked `notice_at`, in address order, counting only
the rows that are not the landing page's Ultra card's (kind `ultra`; *The
Ultra message* below): those are never claimed, marked, counted or named by
this message, and an address with only such a row does not get it. An address
that holds an active account (`users` in the accounts database, the same
lower-cased address) is passed over: its lists were offered to it when it
signed in. A run sends at most 300 messages and stops there; the next run
goes on from the addresses still waiting, so the job is run again until
the page's count of addresses that have not had it is down to the account
holders. An address is sent the message once:

- Before its message goes, the address is claimed: one statement sets
  `notice_at` on its rows only while none of its rows has it, so two runs at
  once (a second press) send it once.
- A send that does not go gives the claim back. A refusal for that address
  alone (a suppressed address) is counted as not sent and the address
  waits for the next run; `E_DAILY_LIMIT_EXCEEDED` or
  `E_RATE_LIMIT_EXCEEDED` ends the run there, and the page says so.
- A list the address joins after its message went does not bring the
  message back: the address has a marked row.

### The message

A plain-text part and an HTML part in the mail shell (docs/mail.md, *The
shell*), in the language of the address's first sign-up, through the
accounts sender (the `MAIL` binding; the log sender on a local run):
accounts are open; the lists the address
signed up for (their labels as the site wrote them, ten at most and a line
for the rest); that signing in with the address offers each list to the
account as a saved search, and that email delivery of a saved search is
part of Pro (no price); the sign-in page's address (the button in the
HTML part); that this is the only message about the lists, with the link to
leave them; why it came, the tagline and the contact address. The preheader
is the line about saved searches. The links are the site's (`SITE_URL`, or
the request's own origin locally). With an https link the message carries
the same `List-Unsubscribe` pair as a delivery, naming the leaving link.

### Leaving the lists

`/interest/stop?t=<token>`, the token being that of the address's first
row. It works whatever the accounts switch says.

- `GET` shows the address's lists and one button, and changes nothing, so a
  mail scanner that opens the link removes nothing.
- `POST` with the token (or the one-click body `List-Unsubscribe=One-Click`
  from a mail client, the token in the address, answered with a line of
  text) marks every row of the address unsubscribed and replaces the
  address on them with `removed:` and SHA-256 of a random salt and the
  address, the salt thrown away: the rows still count in the nightly's
  totals, prove nothing about whose they were, and are no longer offered to
  an account. Any row's token takes the whole address off.
- A token that matches no row, or is not 32 hex characters, answers the
  site's 404. No session and no `Origin` are asked for: the token is the
  proof, and it can only take that one address off.
- Both methods count against `STOP_LIMIT` while the switch is on.

### The console page

`/admin/announce`, linked from the overview, behind the console's guards.
It shows how many addresses have not had the message (account holders
included, since telling them apart reads the accounts database address by
address) and how many it went to, what a run does, the confirm box and
button, and the message in English and in French as an address with one
list would get it. While `MAIL_DAILY_QUOTA` sets a ceiling it also says how
many messages the day's ceiling still allows ("Messages the day's sending
ceiling, shared with the delivery job, still allows today (UTC): 37. A run
stops there."). The page offers no form while mail cannot leave (the
stub sender) or while the `interest` table has no `notice_at` column. A
run writes the audit row `operator_announced` with no user id and the
detail `by <operator's user id>, <n> sent, <n> not sent, <n> holding an
account, <n> left` (and ", stopped at the day's ceiling" when it did), and
the page shows the same figures after it, with the ceiling's line when the
run stopped there: "The run stopped at the day's sending ceiling of 960
messages (MAIL_DAILY_QUOTA 1000 less MAIL_DAILY_RESERVE 40, the rest kept for
sign-in codes), shared with the delivery job; the addresses left wait for
the next UTC day." Its sends are a `console` row of the run log (*Sending
mail*).

### Operator steps

1. Add the column to the forms database, once (the schema file has it for
   a new database; on the existing one the statement is not idempotent, and
   a second run only answers "duplicate column name"):

   ```
   cd site
   npx wrangler d1 execute award-watch --remote --command "ALTER TABLE interest ADD COLUMN notice_at TEXT"
   ```

2. With the switch on and sending proved (*Operator steps* above), open
   `/admin/announce`, read the preview, tick the box and send. Run it again
   until no address but the account holders is left.
3. Check what went:

   ```
   npx wrangler d1 execute award-watch --remote --command "SELECT COUNT(DISTINCT email) AS sent FROM interest WHERE notice_at IS NOT NULL AND kind <> 'ultra'"
   ```

## The Ultra message

The landing page's Ultra card keeps an address for one message when Ultra
opens (docs/landing.md, *The Ultra card's form*): a row of the `interest`
table with kind `ultra`, empty `params` and the label "Ultra". The message
is the same job as the accounts-open message, of its own kind: the operator
starts it from `/admin/announce?kind=ultra` (the overview links it as
"Ultra message"), at most 300 messages a run, and runs it again until no
address is left; nothing sends it on a schedule. Send it only once Ultra can
be bought: the message says Ultra is open. The console refuses it until then
(`ultraMessageAllowed`, which is `ultraOnSale`, *Ultra*): the page says "Ultra
cannot be bought yet, so the message was not sent." and offers no form, and
a post sends nothing.

- Who gets it: each address with an `ultra` row not unsubscribed and no
  `ultra` row marked `notice_at`, in address order. An address holding an
  account is not passed over, since it asked for this message on the card.
- The claim, the give-back on a refused send, the stop at a daily or
  rate limit and the stop at the day's sending ceiling, with its run log
  row, work as for the accounts-open message, on the address's `ultra` rows
  alone: one message never marks the other's rows, so an address on the
  lists and on the card gets each message once.
- The message, a plain-text part and an HTML part in the mail shell, in the
  language the address was entered in: Ultra, the plan above Pro, is open;
  the address asked to be told (also the preheader); "Ultra includes
  everything in Pro, with these figures:" and the Ultra card's own lines
  with Ultra's figures on the day it is sent (saved searches, watches,
  analytics, the keyed API); "Plans and prices" with
  the link to `/pro` (the button in the HTML part); that this is the only
  message about Ultra, with the link off the lists
  (`/interest/stop?t=<token of the address's first ultra row>`, also in
  `List-Unsubscribe` with its one-click partner); why it came, the tagline
  and the contact address. No price and nothing a visitor typed.
- The console page: the count of addresses that have not had it, how many
  it went to, the confirm box and button (the form carries `kind=ultra`),
  and the message in English and in French. The accounts-open page and form
  are unchanged and name no kind. A run writes the audit row
  `operator_announced_ultra` with no user id and the detail `by <operator's
  user id>, <n> sent, <n> not sent, <n> left`.
- Check what went:

  ```
  npx wrangler d1 execute award-watch --remote --command "SELECT COUNT(DISTINCT email) AS sent FROM interest WHERE notice_at IS NOT NULL AND kind = 'ultra'"
  ```

The code is `site/src/account/announce.tsx` (`runAnnouncement` with the kind
`ultra`, `ultraOpenMessage`) and `admin.tsx`; the tests are in
`site/test/accounts-announce.test.ts` (*the Ultra message*).

## Phase 3: payments and the metered API

Payments are built: see *Payments* below. The metered API is built: see
*The keyed API*. The existing `/api` endpoints stay open without a key.

## The keyed API

JSON under `/api/v1` for the API key of an account whose plan allows `api`
(Pro). The routes are `site/src/api_keyed.ts`; the endpoint list, page
sizes and limits are `site/src/api_keyed_spec.ts`, which the Data page's API
section (`site/src/pages/keyed_api.tsx`, shown only while the switch is on)
and the keys page both read; the count is `site/src/account/api_usage.ts`;
the tests are `site/test/api-keyed.test.ts`.

### The usage page

`GET /account/api` (`site/src/account/api_usage_page.tsx`), behind the
session like every account page; a reader signed out goes to the sign-in
page, and a plan without `api` is sent to `/account/keys` (303), whose gate
note says what the plan lacks. From the top:

- Four tiles: a key's requests a day and a minute on the plan
  (`keyQuota(plan)` in `site/src/api_keyed_spec.ts`, the one place a plan's
  figures come from), the requests of every key today, and over the 60 days.
- Today against the cap: one bar a key in use, filled to its share of the
  daily cap, with the count, the cap and the share as text.
- Requests a day over the 60 UTC days ending today, one panel a key, with
  every key's total first when there is more than one key. A revoked key
  with requests in those days keeps its panel, named as revoked; a day
  without a row is 0. Each panel's axis runs to a round number at or above
  its largest day (at least 10), so a key making a few hundred requests a
  day stays readable beside one making thousands. A key's daily cap
  is a dashed line on its panel only when that axis reaches it (the total
  has none), and a line under the chart states the cap otherwise. Each
  mark's exact count is its tip, and the table under the chart lists every
  day, newest first, a column a series. The total and five keys fit a
  700 px window; the page can show up to five keys in use and five revoked
  ones beside the total, and where a window holds fewer columns (six below
  1280 px, ten below 1440 px) the keys with the fewest requests over the
  window rest. A resting key's count shows on a line under a day only on a
  day it made requests; while the read holds five keys with requests, the
  keys that rest are the ones that made none, so no line appears. All keys
  (the total's panel, the table's first column and the two request tiles)
  is every key's requests, shown or not: when more than five keys made
  requests in the window, the page draws the keys in use and the ones
  revoked most recently, and a line under the table says how many revoked
  keys have no chart or column of their own and that their requests are
  counted in All keys ("1 revoked key made requests in these days and has
  no chart or column of its own; its requests are counted in All keys.").
  With five or fewer there is no line.
- The chart has two forms, chosen by two tabs in its panel's head. Bars,
  the page's own form: a bar for each day with a request, with the fade the
  site's other amounts wear, and today's bar in the pale step, since the
  day is still under way (a line under the chart says so on a day that has
  one). Lines (`/account/api?chart=lines`): a line a panel over its wash,
  with a mark on every day, the days at 0 included. The choice is the
  address, so nothing is stored, and any other value of `chart` is the
  bars. The scale, the cap's line and the table are the same in both.

It reads the account's keys and two statements in one batch, so both count
the same moment, from `site/src/account/api_usage.ts`: `DAILY_SQL`, the
day's rows of at most 5 keys with requests in the window (the live ones
first, then the ones revoked most recently), at most 300 rows through the
primary key; and `TOTAL_SQL`, each day's requests summed over every key of
the account with the number of keys that have a row in the window, one row a
day and at most 60 (`LIMIT 60`), each key's days read through the primary
key and the keys through `idx_api_keys_user`. When either cannot be read
the page still answers 200 with the limits, an empty chart and the line
saying the counts cannot be read. The tests are
`site/test/api-usage-page.test.ts`, which read both statements' plans.

### Endpoints

| Endpoint | Reads | Parameters | Bounds |
|---|---|---|---|
| `GET /api/v1/tenders/open` | `tenders/open.json`, filtered as the tender list filters it, at the start of the data date (*Paging the notice lists*) | `category`, `segment`, `province` (each repeatable), `national`, `code`, `buyer`, `type`, `method`, `closing`, `q`, `sort`, `page` | 100 rows a page; `q` at most 100 characters, matched in memory |
| `GET /api/v1/tenders/new` | `tenders/new/<day>.json`, in the file's order with the notices closed at the start of the data date last | `day` (one of the 30 days to the data date, the newest by default), `page` | 100 rows a page |
| `GET /api/v1/expiring/{3m,6m,12m}` | the window's index and one page file | `page` | 100 rows a page, inside one 500-row file; the deeper windows also need `radar_depth` |
| `GET /api/v1/search` | the hosted search's own statements (`site/src/search_db.ts`) | `q` (required, at most 200 characters, folded to eight words), `page` (1 to 200) | 50 organizations a page; buyers on page 1 |
| `GET /api/v1/organizations/{id}/records` | the records database (`ORG_RECORDS_SQL`) | `source` (required: `awards`, `history`, `contracts`, `grants`), `year`, `page` (1 to 50) | 100 rows a page; the ten fiscal years ending with the data date's, or the one asked for; through `records_org` |
| `GET /api/v1/buyers/{id}/records` | the records database (`BUYER_RECORDS_SQL`) | as above | as above, through `records_buyer` |
| `GET /api/v1/me` | nothing past the checks | none | the key's prefix, plan, plan end, the day's count, the limits: `per_minute` and `per_day` for the key, `per_minute_per_address` (60, `API_LIMIT`) for the address every request meets first |

A parameter an endpoint does not take, a single-valued one given twice, or a
value it cannot use is a 400 whose message names no value from the request.
A page past the last is a 404. A retired organization or buyer id on a
records endpoint answers 301 to the id that took its records, as the open
API's profiles do. The records statements are constants with `?N`
placeholders, each ending in `LIMIT 101 OFFSET ?5`, ordered by the index
itself (the plan test checks that no temporary sort is made), and read
`extra = 0` rows only; `next_page` says whether another page follows, in
place of a count that would read the whole range. Records carry the fiscal
year and quarter, segment, value (dollars, with `value_note`), the
competitive flag and the method, with the organization or the buyer they
are paired with.

### Paging the notice lists

`/api/v1/tenders/open` and `/api/v1/tenders/new` keep one order for the
whole data date, so a script that pages either list gets each notice once.
Each request filters and sorts the night's file again, and until
2026-11-14 it did so at its own time: a notice whose closing time passed
between two pages (many close at 14:00 ET) moved to the end of the list,
every later row moved up a place, and the crawl skipped one row and read
the closed notice twice. Now the closing states and the closing window are
taken at the start of the data date, 00:00 Eastern (`site/src/closing.ts`
`dayStartClock`, `listClock` in `site/src/api_keyed.ts`), whatever the
time of the request:

- `sort=closing` (the default): soonest closing first by the closing time
  as published, then the reference; a notice with no closing date last. The
  night's open file holds only notices whose closing day is the data date
  or later, so none has passed at that instant, and a notice keeps its
  place after its closing time passes.
- `sort=published`: newest published first, then the reference; a notice
  with no published date last. This order never read the clock.
- `closing=7` and `closing=30` keep the notices whose closing day falls
  within that many days of the data date.
- `/tenders/new`: the file's own order (newest published first, then the
  reference), the notices closed at the start of the data date last (the
  file writes their status as of the data date).

Both orders are the ones the `sort` parameter has always promised, so the
spec (`site/src/api_keyed_spec.ts`) keeps its parameters and the Data page
its `sort` line (`keyed.p_sort`); only the moment the closing states are
read changed, and the Data page's `closing` line (`keyed.p_closing`) now
says the window counts from the data date. The reference alone would have
broken the default order scripts rely on. The website's own tender list
keeps the reader's clock and still moves a notice whose closing time has
passed to the end.

Every page carries `data_as_of`, the data date it was cut from. Pages with
the same `data_as_of` are slices of one list. If `data_as_of` changes
between two pages, the nightly run has published a new list and the
earlier pages came from the old one: start again from page 1. The Data
page's API section says the same (`keyed.answers`). A second export on the
same data date (a nightly run started again by hand) would keep the same
`data_as_of` while its file may differ; `total` changing between pages
shows most such cases.

### Checks, in order

1. The switch: while `ACCOUNTS_ENABLED` is not `"true"` every `/api/v1`
   address answers the open API's own 404 (`{"error":"not found"}`, public
   for five minutes) and nothing is read.
2. `API_LIMIT`, the per-address cap every `/api/` request meets
   (`site/src/limits.ts`).
3. `requireApiKey("api")`: 401 for a missing, malformed, unknown, revoked or
   blocked account's key; 403 for a key whose account's plan lacks `api`;
   503 when the accounts database cannot say (*Security posture*).
4. `KEY_LIMIT` (namespace 2009, 600 a minute), keyed `key:<key id>`: a
   429 with `Retry-After: 60`. A limiter fault lets the request through.
5. The day's count in `api_usage`: one statement inserts the key's row for
   the UTC day at 1 or adds one while the count is under the holder's plan's
   figure (`keyQuota`: 20,000 on Pro, 50,000 on Ultra), which it binds. At
   the cap no row comes back and nothing is written: a 429 with
   `Retry-After` set to the seconds left until 00:00 UTC, its text naming
   the plan's figure, as `/me`'s `limits.per_day` does. A write that fails
   lets the request through uncounted (fail open), and `/me` then reports
   `requests: null`.

While the switch is on, every answer under `/api/v1`, a refusal included,
is sent `Cache-Control: private, no-store` with `Vary: Authorization,
X-Api-Key`. Errors are `{"error": "..."}` in English.

### Limits, and why these

At 600 a minute and 20,000 a day, an ordinary script (the open notices, the
day's new notices, the three radar windows, the records of a few hundred
organizations) fits in a few thousand requests a day, and a key makes at
most 600,000 requests a month against the 10 million the Workers plan
includes. A records page reads at most 5,001 rows of one index range, plus
the further-segment rows it passes over, so a key spending its whole day on
the deepest pages reads about 100 million rows: some 3 billion in a month,
an eighth of the 25 billion D1 includes. The per-address cap (60 a minute)
still applies, so 600 a minute matters only for a key used from several
addresses; the keys page's note and `/me` state the 60 beside the 600, so a
script pacing itself from one machine paces to the 60. Ultra's 50,000 a day serves one machine's steady script (one
address is held to 86,400 a day); its five keys at the cap make 7.5 million
requests a month, inside the Workers plan's 10 million.

### Operator step at landing

Apply the schema again, which adds `api_usage` and its index and changes
nothing else:

```
cd site
npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
```

Until it is applied, every request is let through uncounted and the keys
page says the counts cannot be read. The `KEY_LIMIT` binding deploys with
`wrangler.jsonc`.

## Payments

Pro is sold as a subscription through Stripe, monthly or yearly, and so is
Ultra once it is on sale (*Ultra*, below, has what differs for it), under
Stripe's Managed Payments: Link, operated by Stripe, is the merchant of
record, selling on behalf of Allwater Software Inc., which provides the
service. The site never sees a card: the
user pays on Stripe's Checkout page and manages the subscription on Stripe's
customer portal, and Stripe tells the site what happened through a signed
webhook. The code is `site/src/account/stripe.ts` (the Stripe calls and the
signature), `site/src/account/billing.tsx` (the pages, the webhook and what
each notice does to the entitlements) and `site/src/account/payments.ts`
(the interface between them). There is no Stripe SDK: the Worker calls
Stripe's API with `fetch`, a Bearer key, form-encoded bodies and a pinned
API version (`STRIPE_VERSION`, `2026-10-28.endive`).

### Routes

| Route | Guards | What it does |
|---|---|---|
| `GET /account/billing` | session | The plan today. Without a subscription: what Pro includes, a monthly and a yearly button with the configured prices and "Taxes added at checkout". With one: its status, the end of the period paid and a button to Stripe's portal (while a cancellation is set there, the end reads "Ends, does not renew" with a line saying the plan continues until then: *A cancellation set in the portal*, below), and, while the account is offered it, the Refund of the First Payment panel (*Refund of the first payment*, below); `?refund=confirm` shows that panel's confirmation step. Without the keys or the prices: "Paying for Pro is not available yet." |
| `POST /account/billing/checkout` | session, CSRF, Origin | Creates a Checkout Session and redirects (303) to it, under an `Idempotency-Key` naming the user, the choice (the plan, the interval, the page's language) and the ten minutes the request falls in: two checkouts of one choice started together get the one session, and another choice (back from Stripe's page by its back link, then the other interval or plan) starts its own at once. For a returning customer the other open sessions of the customer are then expired, so only the new one can be paid (*Checkout and its way back*, below). A request Stripe is still handling after three tries, or the same key with other details, gets "A checkout started from this account a moment ago is still being prepared at Stripe. Try again in a minute, or in ten minutes if this message comes back." (409). A user whose subscription can still bill is sent to Stripe's portal instead (a billing page left open from before the subscription would otherwise start a second one). |
| `POST /account/billing/portal` | session, CSRF, Origin | Creates a portal session for the stored customer and redirects (303) to it. |
| `POST /account/billing/change` | session, CSRF, Origin | A move between Pro and Ultra, opened on Stripe's portal at the move itself (*Ultra*, *Moving between the plans*). |
| `POST /account/billing/refund` | session read from the database (not one remembered through an outage), CSRF, Origin; `FORM_LIMIT` | Refunds the first payment in full and cancels the subscription at once, from the confirmation step with its box ticked (*Refund of the first payment*). |
| `POST /account/billing/webhook` | Stripe's signature; `WEBHOOK_LIMIT`, 120 a minute per address, while the switch is on (Stripe retries a 429) | Takes Stripe's notices. |

All six are the site's 404 while the accounts switch is off. The overview
(`/account`) shows "Pro, paid until <date>" when a live Stripe row decides
the plan, the date being the end of the period paid: the row's own end less
the 3 days of grace (`billingLine`). A row is written and extended only by a
paid notice, so the date never names a period not paid yet; the
subscription's `current_period_end` moves forward at the renewal, before
its payment is taken, and the billing page shows it only as "Current period
ends". While a cancellation is set for the end of that period the overview
reads "Pro, ends on <date>" (or Ultra) with the same date. The overview
links the billing page in either case.

While a subscription can still bill (`liveSubscription`) the billing page
draws no Subscribe panel, since a checkout would go to the portal: the plan
cards' link that would lead there leads to the subscription's own panel
(`#subscription`, "Manage the subscription", plain), on Pro's card only.
That covers a Free reader whose subscription is `past_due` past its grace,
`unpaid`, `incomplete`, or had a payment refunded or disputed. When the plan
has ended that way, the overdue note reads "The last renewal payment did not
go through, so Pro has ended. Update the card on Stripe's page to get Pro
back." (the plan the subscription last paid for, Pro or Ultra), in place of
"... to keep Pro".

#### Checkout and its way back

The Checkout Session is `mode=subscription` with the chosen price and
quantity 1, `client_reference_id` and `subscription_data[metadata][user_id]`
set to the user id, the user's address in `customer_email` (or, for a
returning subscriber, the stored `customer`), `success_url`
`/account?billing=done&session={CHECKOUT_SESSION_ID}`, `cancel_url`
`/account/billing`, `locale` `en` or `fr-CA` from the page language, and
`expires_at` (below). No
`automatic_tax` and no `customer_update[address]`: under Managed Payments
the service computes and collects the tax itself from the address Checkout
asks for, and its documentation lists both among the parameters an
integration must not send. The portal session names the stored customer,
returns to `/account/billing` and opens in `en-CA` or `fr-CA`.

`{CHECKOUT_SESSION_ID}` is Stripe's template, sent as written: Stripe puts
the session's id in its place when it sends the payer back
(docs.stripe.com/payments/checkout/custom-success-page). On that return the
overview reads the session (`GET /v1/checkout/sessions/<id>`) and, when it
was made for this account (`client_reference_id`) and is `complete`, reads
its subscription and binds the customer, the subscription and its status as
the checkout notice does (`bindReturn`; audit "stripe checkout return,
bound"). Nothing is granted there: the plan waits for the signed notices.
So a payer whose first notices fail (Stripe retries them for up to three
days) sees the subscription and Manage on the billing page, and a Subscribe
press opens the portal instead of a second checkout. An id of another shape,
another account's session, a session not complete, or a read that fails
binds nothing, and the page answers as before.

The idempotency key names the choice, so a reader back from Stripe's page by
its back link can choose the other interval, plan or language at once. For a
returning customer (the session names the stored `customer`) the site then
lists the customer's open sessions (`GET
/v1/checkout/sessions?customer=<id>&status=open`) and expires every one but
the session just made (`POST /v1/checkout/sessions/<id>/expire`), before the
reader is sent on; an expiry Stripe refuses answers "could not be reached"
(503) and sends the reader nowhere, and a list that cannot be read leaves the
others open. A first buyer's open session cannot be found that way: a
session made with `customer_email` has no customer until it completes, and
Stripe's list filters by customer, not by `client_reference_id`. Its earlier
session stays open until its own `expires_at`; paying both within that time
would make a second subscription, which the daily check names (below).

Every session is therefore made with `expires_at`, so it stays payable
about an hour instead of Stripe's day ("The Epoch time in seconds at which
the Checkout Session will expire. It can be anywhere from 30 minutes to 24
hours after Checkout Session creation. By default, this value is 24 hours
from creation", docs.stripe.com/api/checkout/sessions/create). The value is
in seconds: 60 minutes (`CHECKOUT_EXPIRES_MS` in
`site/src/account/stripe.ts`) after the start of the ten minutes the
session's idempotency key names, so 50 to 60 minutes after the session is
made. It follows the key's ten minutes because Stripe refuses one key with
other parameters: a second press of the same choice inside those ten
minutes sends the same value and is given back the first session, with its
original expiry. A reader who comes back to an expired session finds
Stripe's page saying so ("customers loading the Checkout Session see a
message saying the Checkout Session is expired",
docs.stripe.com/api/checkout/sessions/expire) and can pay nothing there.
Stripe's documentation does not say where that page links; its back button,
when Checkout shows one, is `cancel_url` ("customers will be directed to
this URL if they decide to cancel payment and return to your website"),
the billing page, where Subscribe starts a new session. The success address
is reached only by a session that completed, so an expired one binds
nothing there.

The site's Content-Security-Policy keeps `form-action 'self'` on every page,
except that the billing pages also allow `https://checkout.stripe.com` and
`https://billing.stripe.com` while the switch is on and the keys are set: a
browser applies `form-action` to the redirect after a form post, so without
them the 303 to Stripe would be blocked. A custom Checkout domain in Stripe
would need its host added there (`site/src/account/stripe.ts`); a session
URL on any other host is refused with the "could not be reached" page.

#### A cancellation set in the portal

A subscriber who cancels on Stripe's portal keeps the plan to the end of
the period paid, and the site says so. Stripe marks such a subscription in
one of two ways: `cancel_at_period_end` ("Whether this subscription will
(if status=active) or did (if status=canceled) cancel at the end of the
current billing period") or `cancel_at` ("A date in the future at which the
subscription will automatically get canceled",
docs.stripe.com/api/subscriptions/object). The portal sets the flag under
classic billing mode and only `cancel_at` under flexible billing mode
("`cancel_at_period_end` is set to `false` and `cancel_at` is set to the
maximum `current_period_end` across all subscription items",
docs.stripe.com/billing/subscriptions/billing-mode/compare), the default for
subscriptions made through the API from version `2025-09-30.clover` on
(docs.stripe.com/billing/subscriptions/billing-mode). `readSubscription`
reads either: the flag, or a `cancel_at` no later than the current period's
end. A `cancel_at` further off is left alone: the subscription renews into
the period that holds it first, and that update then reads as ending.

`bind` writes the result to `payment_customers.cancel_at_period_end` from
the checkout notice's read of the subscription, the paid invoice's read and
every update notice's snapshot (the way back from checkout too); a notice
with no read keeps the stored value. While it is 1 for a subscription that
can still bill, the billing page shows "Ends, does not renew" with the
period's end in place of "Current period ends", and the line "The
subscription was cancelled and is not charged again. Pro continues until
<date>, and Stripe's page can undo the cancellation until then." (Ultra for
an Ultra subscriber); the overview and the billing page's lead read "Pro,
ends on <date>". Undoing the cancellation on the portal sends an update
with neither set, and the usual lines come back. The flag changes no plan:
`customer.subscription.deleted` ends the row at the period's end, as for
any cancellation. The console's subscription panel reads it the same way
("Ends at the period end").

A database made before the column still works: each read and the write
that name it fall back to the row without it, the flag reading 0, and one
log line per isolate says so (`missingFlag`); no notice and no page fails
for it. The column is added once by hand (step 8 of *Operator steps*).

### What each notice does

Every change goes through the `entitlements` table, source `stripe`, the
reference being the subscription id; `planFor` then brings the cached plan
on `users` up to date. `payment_customers` (one row per user: Stripe's
customer id, the latest subscription id, its status and the end of the
period paid) records only which subscription belongs to whom. Each change
writes an audit row, event `plan_changed`, with a fixed detail ("stripe
checkout, granted", "stripe renewed, extended", "stripe ended, canceled",
"stripe status past_due"); no amount and no address.

| Event | Effect |
|---|---|
| `checkout.session.completed` | Binds the customer and subscription to the user named by `client_reference_id`, reads the subscription from Stripe for its status and period end, and, when the session is paid and the subscription active, writes a Pro row from now to the period end plus 3 days of grace. A session still unpaid (a bank debit clearing) grants nothing; its `invoice.paid` grants. An account deleted while Stripe's page was open has the new subscription cancelled at once; a paid session's payment is then refunded in full through Stripe and named by the daily check (*Deletion*, below). |
| `invoice.paid` | Extends the subscription's live row to the paid period's end plus 3 days (never shortening it), or writes a row when none is live (a first period whose checkout notice has not arrived, a renewal paid after a lapse). The status recorded is the one Stripe gives on the read this notice makes for the plan, never the one held before it, so a checkout or an update taken while the read was on its way is not written over. Nothing for a subscription already canceled or expired, nor for a payment already reversed: its charge is in `payment_reversals`, or the customer has a reversal made at or after the invoice was paid (a notice delayed past its refund names no charge in current API versions). A checkout made before a reversal of its customer grants nothing either; one made after it grants. On a deleted account the subscription is cancelled, nothing is granted, the payment is refunded in full through Stripe, and the daily check names it (*Deletion*, below). |
| `customer.subscription.updated` | Records the status, the period end and whether a cancellation is set for that end (*A cancellation set in the portal*, below). `canceled`, `unpaid` or `incomplete_expired` sets the live row's end to now. `past_due` changes nothing: Pro runs to the end of the grace while Stripe retries the card. A `canceled` or `incomplete_expired` status of the bound subscription is never replaced: Stripe calls canceled "a terminal state that can't be updated", so an update saying otherwise was sent before it. On a deleted account, a subscription Stripe says can still bill is cancelled and named by the daily check ("stripe live on a deleted account, cancelled <sub id>"). |
| `customer.subscription.deleted` | Sets the live row's end to now. |
| `charge.refunded` | When the charge is refunded in full (`refunded` true, or `amount_refunded` reaching `amount`): records the charge in `payment_reversals` at the reversal's own time (the event's `created`, Stripe's whole seconds; the time the notice is taken when it has none) and ends now every live Stripe row of the account bound to the charge's customer that existed at that time. A row written after it is kept when Stripe made its subscription after the reversal (a subscription bought after a Refund now, on the same customer, whenever the refund's notice lands), and ends otherwise (a payment notice delayed past its own refund); its subscription is read from Stripe for that, and a failed read answers 500. A partial refund changes nothing. The notice of a refund made for a deleted account (*Deletion*) records its charge once and ends nothing, the account having no live row. |
| `charge.dispute.created` | The same as a full refund, for the account bound to the disputed charge's customer (the charge is read from Stripe for it; a failed read answers 500 and the notice comes again). |
| `refund.failed` | A refund Stripe took that failed later (a pending refund the balance did not cover within 45 days, a closed card). No plan changes: the plan ended with the refund's notice, and what follows is the operator's decision. An audit row `refund_failed` holds the charge's id and Stripe's `failure_reason` under the account's id (the customer is the refund's, or the charge's, read from Stripe), and the daily check names the account. That covers a refund made for a deleted account too: its customer is bound to the deleted account when the refund is made. |
| any other type | Recorded and answered 200; nothing changes. |

The user is found by the subscription or customer already bound, and
otherwise by the `user_id` in the subscription's metadata, so notices may
arrive in any order (Stripe does not keep one). A notice for no known
account changes nothing and is logged without detail.

Every notice is checked before anything in it is read: the `Stripe-Signature`
header's `t` and each `v1` (HMAC-SHA256 under the endpoint's signing secret,
over `t`, a full stop and the raw body), compared in constant time, with `t`
within 5 minutes of the Worker's clock. An unverified post answers 400 and
writes nothing. A verified notice is claimed in `payment_events` by its
event id before it is applied, so a notice delivered twice (Stripe retries
until it gets a 2xx) answers 200 the second time and changes nothing.
`payment_events` and `payment_reversals` rows go after 90 days.

### Fail open, fail closed

- **Outages fail open.** A notice the database cannot take, or one whose
  subscription cannot be read from Stripe, answers 5xx with its claim
  released, and Stripe sends it again for up to three days. The 3 days of
  grace past each paid period cover a renewal whose notice arrives late. A
  session already verified keeps its last known plan through a database
  outage (`planFor`, unchanged). The overview shows the plan without the
  billing line if the payment tables cannot be read.
- **Ends fail closed.** `canceled`, `unpaid`, `incomplete_expired` and every
  deletion end Pro on that notice, and a late `invoice.paid` for a
  subscription already ended grants nothing. A full refund or a dispute
  ends the account's Stripe Pro on its notice. Neither cancels the
  subscription: cancel it in the dashboard when it should not bill again,
  since its next paid invoice grants Pro again. A dispute that is won does
  not bring Pro back; grant the rest of the period by hand (*Granting a
  plan by hand*).
- **Deleting an account cancels its subscriptions first.** `POST
  /account/delete` cancels every subscription that can still bill
  (immediately, no refund) before anything is deleted: the bound one, then
  every other one a live Stripe row names (`endForDeletion`); if Stripe
  cannot confirm one, the account is kept and the page says to try again. A
  subscription whose notices had not landed yet is cancelled when its first
  paid or subscription notice lands on the deleted account, which then
  grants nothing; a payment that notice reports is refunded in full
  through Stripe, and the daily check names it either way (*Deletion*).
- **A refund from the billing page fails closed.** Anything Stripe refuses,
  or any read it does not answer, refunds nothing and cancels nothing, and
  the reader is sent to the contact address (*Refund of the first payment*).

### Refund of the first payment

The Terms promise a full refund of the first payment, taxes included, if
the reader asks within 14 days of it, once per account. The billing page
makes it without the operator: a panel titled Refund of the First Payment
with one line ("Refund now returns your first payment in full, taxes
included, and ends Pro at once.") and a Refund now link, which is not the
page's filled button. The code is `site/src/account/refund.ts` (the press)
and `site/src/account/billing.tsx` (`refundState` and the panel); the Stripe
calls are the console's, in `site/src/account/admin_stripe.ts`; the tests are
`site/test/accounts-refund.test.ts`.

**Who is offered it.** The page reads the site's own rows only and asks
Stripe nothing (`REFUND_FACTS_SQL`, one statement). The panel shows when all
of these hold:

- Pro comes from a live Stripe row now (a manual grant written after it
  decides the plan instead, and hides the panel);
- `payment_customers` binds a subscription whose status is `active`;
- every `entitlements` row of source `stripe` the account has ever had names
  that subscription, so no earlier subscription was paid for;
- no `plan_changed` audit row reads "stripe renewed, extended" (a second
  payment on the same subscription);
- the first of those Stripe rows was written at most 14 days ago (it is
  written when the first payment's notice arrives);
- no `refund_made` audit row for the account, and no `payment_reversals` row
  for its customer (a refund or a dispute from anywhere: the console, Link,
  Stripe's dashboard).

"Once per account" needs no new table. Entitlement rows are never deleted,
not even with the account, so an account that was refunded and subscribes
again has a Stripe row naming the old subscription, and is never offered the
refund again. The audit and `payment_reversals` keep 90 days, which covers
the 14. Stripe's own lists (below) decide again at the press, and Stripe
keeps every charge.

**The confirmation.** Refund now leads to `/account/billing?refund=confirm`,
the same page with the panel in its second step: "This cannot be undone.
Your first payment is refunded in full, taxes included, to the payment
method used, and the subscription is cancelled at once. Pro ends when Stripe
confirms the refund, usually within a minute.", a box to tick ("I want my
first payment refunded and Pro ended now."), Refund my first payment, and
Keep Pro. The box makes it two deliberate acts: a double click on Refund now
cannot land on the confirmation. A post without the box ticked shows the
step again ("Tick the box to confirm.", 400) and asks Stripe nothing.

**The press** (`POST /account/billing/refund`). Nothing the form sends is
read but the box and the language; the subscription, the customer and the
charge are the ones bound to the signed-in account. In order:

1. The site's rows again, as the page read them. Past the window: "The 14
   days after your first payment have passed, so nothing was refunded" (409).
   Refunded before: "A payment of this account has been refunded already, so
   nothing more was refunded." (409). Not offered for any other reason: "This
   account's first payment cannot be refunded from this page, so nothing was
   refunded. Write to (the contact address)..." (409). None of these asks
   Stripe anything.
2. An audit row `refund_requested` with the subscription's id.
3. The subscription (`GET /v1/subscriptions/<id>`): it must be `active`, its
   customer the bound one, and the `user_id` in its metadata, when there is
   one, this account.
4. The customer's paid invoices (`GET /v1/invoices?customer=<id>&status=paid&expand[]=data.payments`)
   and charges (`GET /v1/charges?customer=<id>`), 10 of each, and the charge
   behind the oldest invoice that took money, found as the console finds it
   (the invoice's payments, then `GET /v1/charges?payment_intent=<id>`).
   Stripe's figures must say (`refundVerdict`): exactly one paid invoice
   took money and exactly one charge succeeded, both lists read to their end,
   and that charge is the invoice's; the invoice was for the bound
   subscription; no charge of the customer was refunded in any part or
   disputed; the charge names the bound customer; its amount and currency are
   the invoice's (so a full refund of the charge is the first payment and no
   more); and its `created` time is at most 14 days (14 times 24 hours)
   before the press. Otherwise the press stops with the matching line above
   (409).
5. The refund: `POST /v1/refunds` with `charge=<id>` and no amount, under
   the header `Idempotency-Key: operator-refund-<charge id>`, the
   console's own key and parameters. A double submit, a retry or a press
   beside the operator's on the same charge gets the first refund back from
   Stripe (within its 24 hours), never a second; after those 24 hours the
   charge reads refunded and step 4 stops the press. Stripe never refunds
   more than a charge. A 409 (the same key still in flight) is asked again
   up to three times, a call with no answer once. A refund Stripe gives as
   `succeeded` or `pending` is taken; anything else, or no answer, reads the
   charge again (`GET /v1/charges/<id>`), and a charge refunded in full there
   counts as taken ("refund confirmed").
6. `refund_made` with the refund's status ("refund succeeded").
7. The cancellation at once (`DELETE /v1/subscriptions/<id>`, the payment
   source's `cancel`, as account deletion does), then the stored row reads
   `canceled` and `plan_changed` "stripe cancelled with the refund".

The entitlement is not written by the press. Stripe's `charge.refunded`
notice ends the account's Stripe Pro (*What each notice does*), and
`customer.subscription.deleted` would too.

What the reader sees:

| Path | Status | The page |
|---|---|---|
| Refund and cancellation went through | 303 to `/account/billing?refund=done` | "Your first payment is being refunded in full, taxes included, and the subscription is cancelled. Pro ends when Stripe confirms the refund, usually within a minute. Reload this page to see it." Until the notice arrives, the lead still reads "Pro, paid until (date)"; the subscription and refund panels are gone (the stored row reads `canceled`), and the Subscribe and Earlier Receipts panels show, as after any cancellation. Once the notice arrives the plan reads Free. |
| Refund went through, cancellation did not | 303 to `/account/billing?refund=sent` | "Your first payment is being refunded in full, taxes included. The subscription could not be cancelled at Stripe just now; the site's operator is told and cancels it by hand. Pro ends when Stripe confirms the refund, usually within a minute." The audit row `refund_cancel_failed` carries the subscription's id, and the daily check names it (below). |
| Stripe refused the refund, or could not be reached at any step | 503 | "The refund did not go through, so nothing was changed: Pro and the subscription continue. Write to (the contact address) from your account's address to ask for the refund." `refund_refused` "stripe refused" or "stripe unreachable". Nothing is cancelled and nothing is recorded as refunded; the panel stays, so the reader may press again. |
| Refused by the rules (window, refunded, not the first payment, another account, figures) | 409 | The matching line of step 1; `refund_refused` with the reason. |

Every line is in English and French. The audit rows hold no amount and no
address: `refund_requested` (the subscription id), `refund_refused` (a fixed
reason: "window", "refunded already", "not offered", "stripe unreachable",
"subscription", "another account", "no payment", "refunded", "not first",
"disputed", "figures", "stripe refused"), `refund_made` ("refund
succeeded", "refund pending", "refund confirmed"), `refund_cancel_failed`
(the subscription id), then the webhook's own `plan_changed` rows.

**The daily check.** Its message (`site/src/watchdog.ts`,
`REFUNDS_TO_CANCEL_SQL`) carries one item needing attention per account
whose refund went through while its subscription can still bill:

```
A refund of a first payment pressed on the billing page went through, but its subscription can still bill: account <user id>, subscription <sub id>. Cancel it at once in the operator console (the account's page, Cancel the subscription, At once) or in Stripe's dashboard.
```

An account is named when a `refund_cancel_failed` row names its bound
subscription, or when a `refund_requested` row does and a full refund of the
customer's charge was recorded in `payment_reversals` after it (a refund
whose answer never reached the site, or one the operator made after a press
that failed), in both cases while `payment_customers` still binds that
subscription with a status other than `canceled` or `incomplete_expired`.
A reversal is recorded at the refund's own time in Stripe's whole seconds
and the press's row at the site's clock, so "after it" allows the minute
before the press. The item repeats each morning until the subscription is
cancelled: from the console at once (the stored row then reads `canceled`),
or in Stripe's dashboard, whose `customer.subscription.deleted` notice does
the same. It names the account id and the subscription id and nothing
else, at most 20 accounts, over the audit's 90 days. A fault reading it is
logged, as the count of paid plans is, and never a line of its own.

**A refund that fails later.** A refund Stripe gives as `pending` counts as
taken at the press (the reader is told it is on its way, and the
subscription is cancelled). Stripe holds a card refund pending while the
balance does not cover it and fails it after 45 days, or fails it when the
card cannot take it, and "notifies you using the `refund.failed` event"
(docs.stripe.com/refunds). The webhook takes that event: it changes no plan,
writes `refund_failed` with the charge's id and Stripe's reason, and the
daily check names the account (*Known limits*, the daily check's money
items). Refund the person another way, or grant the plan by hand.

**Keys.** The press uses the restricted key's Subscriptions write, Refunds
write, and Invoices and Charges read (*Stripe key permissions*).

#### After the first real refund

Stripe's documentation does not say how a refund behaves when Link is the
merchant of record. After the first refund made from the billing page,
check in Stripe's dashboard and on the site:

1. The payment shows refunded in full, the amount being the whole first
   payment with its taxes, and its Payment breakdown says whether Stripe kept
   the sales tax and the Managed Payments fee (the refund itself returns the
   tax to the customer).
2. The subscription reads canceled, with no further invoice.
3. The webhook took `charge.refunded` and `customer.subscription.deleted`
   (Workbench, the endpoint's deliveries), and the console's user page shows
   the plan Free, the stored row `canceled`, and the audit rows
   `refund_requested`, `refund_made`, `plan_changed` "stripe cancelled with
   the refund" and "stripe ended, refunded".
4. Link sent the reader a refund notice (ask the reader, or preview it from
   Receipt history).
5. In the invoice the press read, the subscription sat under
   `parent.subscription_details`, the charge came through `payments`, and the
   charge's amount and currency equalled the invoice's `amount_paid` and
   currency. If any of these differs under Managed Payments, every press stops
   at "figures" or "not first" and readers are sent to the contact address:
   refund those by hand in the console and adjust `refundVerdict`.

### What is kept

`payment_customers` holds Stripe's ids, the subscription's status, the
end of the period paid and whether a cancellation is set for that end;
`payment_events` holds Stripe's event ids and types;
`payment_reversals` holds the charges refunded in full or disputed, with
their customer ids and the time the refund or dispute was made (the event's
own `created`; the column's comment in `accounts_schema.sql` still says
"when the notice was taken", which is what it held before).
No card details, billing address, tax number or amount is kept on the site;
Stripe holds those as the payment processor. The rows stay when an account
is deleted, tied to the id alone like the entitlement rows.

### Operator steps

1. **A Stripe account in the merchant's name.** Allwater Software Inc., a
   British Columbia corporation: business details, the payout bank account,
   and the statement descriptor (statements read LINK.COM followed by it).
   Under Managed Payments, Link sends the receipts, invoices and refund
   notices itself, so the dashboard's customer-email settings do not apply,
   and the support email in the dashboard is where Stripe reaches the
   business for product input, not an address shown to customers. The site
   sends no billing mail of its own.
2. **The product and its two prices.** One product, Award Watch Pro, with
   a software-as-a-service tax code, and two recurring prices in CAD:
   CA$18.99 monthly and CA$189.99 yearly, each with tax behaviour "exclusive"
   (taxes added at checkout). Note the two price ids (`price_...`).
3. **Taxes.** Under Managed Payments Stripe calculates, collects, files
   and remits the indirect taxes on these sales, Canadian GST/HST included,
   as the merchant of record; no Stripe Tax registration is needed for them.
   The corporation's own filings are its accountant's call.
4. **The customer portal** (Settings, Billing, Customer portal): allow
   updating the payment method, viewing invoice history, switching between
   the two prices of the one product, and cancelling at the end of the
   billing period (not immediately). Add the site's Terms and Privacy
   addresses.
5. **The webhook endpoint** (Workbench, Webhooks, Create an event
   destination): your account, payload **Snapshot**, API version
   `2026-10-28.endive`, the events `checkout.session.completed`,
   `invoice.paid`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `charge.refunded`,
   `charge.dispute.created` and `refund.failed`, endpoint URL
   `https://awardwatch.ca/account/billing/webhook`. Reveal the signing secret
   (`whsec_...`). On an endpoint made before `refund.failed` was read, add
   that event to the endpoint's events in Workbench, Webhooks (Stripe: "You
   can change the events that a webhook endpoint receives in the Dashboard",
   docs.stripe.com/webhooks).
6. **The two secrets**, from `site/`:

   ```
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

   A restricted key (`rk_live_...`) with write access to Checkout Sessions,
   the customer portal and Subscriptions, and read access to Charges (a
   dispute and a failed refund name their charge, which is read for the
   customer), is enough, and holds less than the account's full secret key.
   Write includes read ("any key that can write an API resource can also
   read that resource", docs.stripe.com/keys/restricted-api-keys), so
   Checkout Sessions write also covers reading a session on the way back
   from checkout, listing a returning customer's open sessions and expiring
   them. The operator console, the billing page's refund and the webhook's
   refund of a payment that lands on a deleted account (*Deletion*) need
   Refunds write and Invoices read as well (*Stripe key permissions*).
7. **The four variables** in `site/wrangler.jsonc`: `STRIPE_PRICE_MONTHLY`
   and `STRIPE_PRICE_YEARLY` (the price ids), `PRICE_MONTHLY_CAD` `"18.99"` and
   `PRICE_YEARLY_CAD` `"189.99"` (shown on the billing page as CA$18.99 and
   CA$189.99, with a decimal comma in French). A figure is digits with optional cents; anything
   else, or any of the four left empty, keeps the page at "not available
   yet". The figures must match the Stripe prices; nothing checks that for
   you.
8. **Apply the schema** again (the payment tables are at the end of
   `accounts_schema.sql`; every statement is idempotent):

   ```
   npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
   ```

   A database made before `payment_customers.cancel_at_period_end` takes
   the column once (`CREATE TABLE IF NOT EXISTS` does not add a column to a
   table already there); until then the site reads the flag as 0 (*A
   cancellation set in the portal*):

   ```
   npx wrangler d1 execute awardwatch-accounts --remote --command="ALTER TABLE payment_customers ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0"
   ```

9. **A test in Stripe's test mode, locally.** Never put test keys on the
   deployed site: with the switch on, anyone could take Pro with a test
   card. In `site/.dev.vars` (git-ignored) set `STRIPE_SECRET_KEY` to the
   sandbox's `sk_test_...` key, and the four variables to the sandbox's
   price ids and the figures. Run `stripe listen --forward-to
   localhost:8787/account/billing/webhook` with the Stripe CLI and put the
   `whsec_...` it prints in `.dev.vars` as `STRIPE_WEBHOOK_SECRET`. Start
   the site as in the local run above, sign in, open `/account/billing`,
   subscribe with the card 4242 4242 4242 4242, and check: the overview
   says "Pro, paid until" a month ahead; an `entitlements` row with source
   `stripe` exists; the portal opens and a cancellation there leaves Pro to
   the period end; cancelling the subscription in the dashboard ends Pro at
   once; deleting the account cancels its subscription. Two notes from the
   first run of this test (2026-11-03): the sandbox honours
   `managed_payments[enabled]` (the page says "Sold through Link", the tax
   is computed from the address, the invoice carries GST and PST lines), and
   without the Stripe CLI the events can be read from the sandbox's
   `/v1/events` and posted to the local webhook with a signature made from
   the `.dev.vars` secret (`t=<unix time>,v1=<HMAC-SHA256 of "t.payload">`).
   The test runner reads `.dev.vars` too, so delete the file before running
   the suite: with the keys present, the "without the keys" tests fail.
10. **Before live payments:** the paid-tier Terms (`docs/terms-paid-draft.md`
    after review), About, Terms and Privacy naming Allwater Software Inc. as
    publisher and Link, operated by Stripe, as the merchant of record, and
    the Privacy page saying that payments are processed by Stripe; then the
    live keys, then the switch.

Removing either secret turns payments off at once: the billing page says
Pro is not available yet and the webhook refuses every notice (Stripe keeps
retrying for three days). Entitlement rows already written keep running to
their end.

### Known limits

- Two checkouts of one choice started together share one session through
  the idempotency key, once a subscription is bound the checkout button
  sends the user to the portal, and the way back from checkout binds it
  even when its notices fail. Two subscriptions can still come from a first
  buyer who pays two open sessions of different choices within the hour
  each stays payable (the earlier one cannot be found to expire; its own
  `expires_at` ends it 50 to 60 minutes after it was made), or from
  checkouts started either side of a ten-minute boundary before either
  notice or return was taken. The second
  is bound only if the first has ended; the audit records "stripe second
  subscription", and the daily check names the account (below). Cancel the
  extra one in the dashboard, then refund it. A Stripe failure is kept under
  the same key, so a checkout that failed answers the same way until the
  ten minutes have passed. A full refund ends every Stripe row of the
  account bound to the charge's customer that existed when it was made,
  whichever subscription the charge paid for: when both subscriptions share
  the customer, grant the rest of the paid period by hand afterwards.
- **The daily check's money items** (`site/src/watchdog.ts`,
  `MONEY_ITEMS_SQL`, one statement), each naming ids and nothing else, at
  most 20 of each kind, the newest first:

  ```
  An account is billed by more than one Stripe subscription: account <user id>, subscriptions <sub id> and <sub id>. Each bills every period: cancel the extra one in Stripe's dashboard and refund what it took.
  A payment landed on a deleted account: account <user id>, subscription <sub id>. The subscription is cancelled, nothing was granted, and the payment was refunded in full. No action is needed; a refund that fails later has a line of its own.
  A payment landed on a deleted account: account <user id>, subscription <sub id>. The subscription is cancelled and nothing was granted, but the payment could not be refunded (<reason>). Look at the payment in Stripe's dashboard. A disputed payment is settled through its dispute; for any other reason, refund the person another way.
  A payment landed on a deleted account: account <user id>, subscription <sub id>. The subscription is cancelled and nothing was granted. The refund of the payment is not confirmed yet; the site asks again each time Stripe resends the notice, for up to three days. If this line is still here after that, refund the payment in Stripe's dashboard.
  A subscription that could still bill reached a deleted account: account <user id>, subscription <sub id>. It is cancelled and nothing was granted. Check in Stripe's dashboard whether it took a payment after the deletion.
  A refund failed after Stripe took it: account <user id>, charge <charge id> (<reason>). The site changed no plan; the money is back in the Stripe balance. Refund the person another way, or grant the plan by hand.
  ```

  The first stands while two live Stripe rows of the account name two
  subscriptions, so cancelling the extra one (its notice ends its row)
  clears it. The others are audit rows (`plan_changed` "stripe paid on a
  deleted account, cancelled <sub id>", the same followed by "refunded" or
  "unrefunded <reason>", "stripe live on a deleted account, cancelled <sub
  id>", and `refund_failed`), which nothing clears: each repeats for 14 days
  (`MONEY_ITEM_DAYS`). A payment's first row reads "not confirmed yet" until
  its outcome row is written, which then stands in its place
  (`readMoneyItems`); a row written before the refunds existed reads the
  same way, and asks for the refund by hand. The reasons are Stripe's
  error codes or `failure_reason` (`charge_disputed`,
  `refund_disputed_payment` and so on), or the site's own `no_charge` and
  `other_customer` (*Deletion*). A fault reading the statement is logged
  and never a line of its own.
- **A refund for a deleted account that Stripe answers 500.** Stripe keeps
  that answer under the charge's key for at least 24 hours and gives it to
  every retry, so the notice answers 500 until the key is pruned; Stripe
  resends a notice for up to three days, so a later delivery makes the
  refund. A refund that is still not made when Stripe stops is the "not
  confirmed yet" line, for the operator.
- **A paid checkout notice that lands after the deletion is refunded** even
  when the site had bound its subscription before (the way back from
  checkout binds it while the notices still fail, or a notice that granted
  the plan failed afterwards and came again), since `checkout.session.completed`
  on a deleted account always cancels and refunds. The delete page's "the
  period already paid is not refunded" does not hold for that payment.
- **The cancellation flag follows the last notice taken**, as the status
  does: an update notice delivered after a later one (Stripe keeps no
  order) can show the older state until the next notice. It decides no
  plan.
- Prices change in Stripe (a new price, then the variables); existing
  subscriptions keep their price until moved in the dashboard.

## Ultra

Ultra is the plan above Pro: every Pro feature, with figures of its own
(*Its figures*). It is built to deploy inert. Nothing offers it, and no
public page or account page changes in any byte, until the operator sets
its five Stripe variables and applies the schema; an account the operator
grants Ultra by hand uses its features, its figures and sees its labels
before then. The one line that changed for every reader is the paid cards'
API row, which names the keys as well as the day ("API: 5 keys of 20,000
requests a day" on Pro). The code is `site/src/account/entitlements.ts`
(the plan, the tier table and the figures), `payments.ts` (`ultraOnSale`),
`stripe.ts` and `billing.tsx` (the payments), `site/src/pro.tsx` (the
cards and the chip); the tests are `site/test/ultra.test.ts`,
`site/test/accounts-ultra-billing.test.ts` and
`site/test/ultra-limits.test.ts` (the figures), with the twenty fiscal
years in `site/test/analytics.test.ts`.

### Its figures

| Figure | Free | Pro | Ultra | Where it lives |
|---|---|---|---|---|
| Saved searches (briefings share them) | 3, on the site | 25, by email | 100, by email | `RULES.<plan>.saved_searches`; `SAVED_SEARCH_MAX` is the ceiling, Ultra's |
| Watches | 3 | 25 | 100 | `RULES.<plan>.watchlists`; `WATCH_MAX` is the ceiling, Ultra's |
| Matching notices listed | 5 | 200 | 500 | `RULES.<plan>.matches` |
| Matching notices mailed a week | 3 | 10 | 25 | `RULES.<plan>.match_mail` |
| Keyed API | none | 5 keys of 20,000 requests a day | 5 keys of 50,000 a day | `KEYS_MAX`; `KEY_PER_DAY`, `KEY_PER_DAY_ULTRA` through `keyQuota(plan)` |
| Analytics | first chart, 3 fiscal years | every view, 10 | every view, 20 | `planYears(plan)`: `FREE_YEARS`, `MAX_YEARS`, `ULTRA_YEARS` |
| Dashboards | none | none | 5, of 24 tiles each | `RULES.<plan>.dashboards` and `.dashboard_tiles`; `DASHBOARDS_MAX` and `TILES_MAX` are the ceilings, Ultra's |

Unchanged on Ultra: the holder's record's windows (3 and 12 months), the
organizations compared (5, held by the `org_claims` CHECK) and the keyed
API's 600 a minute (one rate-limit binding; the per-address cap of 60 a
minute applies anyway). Every line that prints a figure reads it from there:
the plan cards (each plan its own), the Pro page's Ultra section, the
landing page's Ultra card and the Ultra message (`ultraLines`), the keyed
API's 429 and `/me`, the keys and usage pages.

**The watch statements in groups.** D1 binds at most 100 values to a
statement (`D1_BINDS_MAX`), and SQLite holds an expression to a depth of 100
(the calendar feed's slots are an OR). The events statements bind 30 days
and one value a subject, the contracts ending three values a watch, the
instruments one an organization: 26 subjects fitted them, 101 do not. So
each statement takes at most `TARGET_CHUNK` (25) subjects (55, 77 and 27
bound values), and a reader with more sends one statement per group in the
same batch:

- `readEvents` (the watches page, the watch mail, the weekly email, the
  tender notices' sweep): each subject is in one group only, so its rows and
  counts come from one pair of statements and are filed under it whole, in
  the statement's order. Its name and signature are as before.
- `watchEnds` (the calendar feed): the contracts ending of every group are
  merged by the row's key (read as text, a 64-bit integer a JavaScript
  number cannot hold), so a row two groups reach is one event, sorted again
  by end date and key and cut at 500 (`mergeEnds`). A group reads 500 rows at
  most, so every row one statement over all the slots would keep is read by
  its group. When no group was cut the count past the 500 is exact; when one
  was, a row two groups both reach past their cuts counts twice, so the
  feed's last event can then say more than one statement would, never less.
  The instruments' rows name their holder, so they never repeat across
  groups and their totals add up exactly (`mergeInstruments`).

`site/test/ultra-limits.test.ts` holds every statement the modules build to
100 bound values with 100 watches of each kind, and holds the groups to one
statement over every subject on a fixture (the values written into it, since
D1 binds no more than 100), the events and the feed's rows alike.

**Analytics.** A view reads at most the reader's plan's fiscal years
(`planYears`); `choosePeriod` takes that figure, and a longer span keeps
its latest and says so ("At most 20 fiscal years are shown at once"). Every
statement's LIMIT is bound by `ULTRA_YEARS` and each still filters `fy
BETWEEN` the period. The records database already holds every fiscal year
its sources publish (the nightly writes no window: published contracts and
grants reach back to the mid-2000s, notices to 2012, history to 2009), so
twenty years needed no pipeline change. The period tabs read 3, 5, 10 and 20
years; the 20 is offered to a reader whose plan gives it and, while Ultra is
on sale, to every other with the Ultra chip, leading to the view at the
reader's own period, whose head then says "Periods of up to 20 fiscal years
are part of Ultra." Off sale a reader without Ultra sees no 20 and no line,
and `?years=20` reads as `?years=10` did. A chart over more than 12 years
draws every other fiscal year's label (and the first), so a label keeps the
room a ten-year axis gives it (`chart.tsx fiscalAxis`).

**After a move to a smaller plan** nothing is deleted. Saved searches,
briefings and watches past the plan's figure are kept and listed. The
deliveries cover the first ones by creation date up to the figure: the saved
searches' run and the briefings' run count the account's searches and
briefings made before each one (`madeBefore`, the order the shared cap
counts them in) and pass over the rest; the watch mail, the weekly email,
the calendar feed's watches and the watches page's events cover the first
watches by creation date up to the figure, the claimed organization's watch
beside them (`withinCap`, `coveredWatches`). The pages say how many wait:
"This account holds 27 saved searches, past the 25 of its plan. The first
25 are sent; remove some to choose which." and the watches' own line, on a
plan that sends them; a Free account, sent nothing, reads its figures in its
foot's own line ("This account holds 4 of 3 saved searches. ..."). The
calendar feeds of saved searches (a search's own, and the searches in the
"all" feed) keep reading their searches whatever their place: an account
keeps five feeds at most (`FEEDS_MAX`) anyway. While Ultra is on sale a Pro
account's searches, watches and usage pages give Ultra's figure beside its
own, with "Plans and prices".

### The tier table

Both CHECKs that name the plans (`users.plan`, `entitlements.plan`) hold
`free` and `pro`, and neither can change on D1 without rebuilding its
table. An Ultra entitlement is therefore a `pro` row of `entitlements`,
which Ultra includes, with a row of its own in `entitlement_tiers`:

| Table | Columns | Rule |
|---|---|---|
| `entitlement_tiers` | `entitlement_id` (the `entitlements` row), `tier` (`ultra`) | Written in the same batch as its row, never alone (`entitlementWrites`); never deleted, as the entitlement rows are not |

- `planFor` reads each row's plan through its tier
  (`COALESCE(t.tier, e.plan)`), and the newest live row decides as before.
- The cache on `users` holds Ultra as `pro` (`cachedPlanOf`), and is
  compared the same way, so an Ultra account's cache is not rewritten on
  every request. Through an accounts-database outage an Ultra account is
  served as Pro (`lastKnownPlan`); nothing is granted that was not paid for.
- `LIVE_PRO_SQL` (the same-day gate and the daily check) counts `pro` rows,
  so it counts Ultra unchanged.
- Every gate asks `allowed()` for a feature, never for a plan, so every Pro
  gate opens for Ultra. The pages that named a plan now read it by plan:
  the overview's and billing page's plan line ("Ultra, no end date",
  "Ultra, until (date)", "Ultra, paid until (date)"), the subscript after
  the wordmark (`ultra`, in sapphire), the matching notices' cap
  (`matchCap(plan)`), and the email lists' line offering a plan with
  delivery, which an Ultra reader is not shown.
- Until the table is on the database: `planFor` reads without it (an Ultra
  row then reads as Pro) and logs one line per isolate, "entitlement_tiers
  missing"; nothing offers Ultra; an Ultra grant's batch fails whole, so a
  webhook answers 500 (Stripe sends it again) and the console says which
  file to apply; the console's pages read Ultra as Pro and leave out the
  Ultra counts.

### On sale

`ultraOnSale(env)` is true when the accounts switch is on, the payment
source offers Pro, all five Ultra variables are set and in form, and
`entitlement_tiers` answers (`SELECT 1 FROM entitlement_tiers LIMIT 1`; a
true answer is kept for the isolate's life). The cheap checks come first,
so a site without the variables never reads the database for it. While it
is true:

- the plan cards are three, wherever they are drawn (the tease panels, the
  Pro page, the billing page): Ultra's card framed in sapphire, its chip in
  the card's head, every row with Ultra's own wording and figure;
- the Pro page gains the section on Ultra after Who It Is For, the answer on
  moving between the plans, the refund's answer naming both plans, and a
  Product "Award Watch Ultra" with its two offers in the page's markup;
- the landing page's Ultra card shows the price, Ultra's lines and Subscribe
  to Ultra through the sign-in page, in place of the waitlist form;
- the Terms' paid-plan section covers Pro and Ultra, with Moving Between
  Plans after the renewal (the Pro terms stay word for word until then);
- the Privacy page's Payments section names both plans in its first
  paragraph ("Pro and Ultra are paid for on Stripe's own pages", sold
  through Link), as its accounts section adds what a dashboard keeps;
- the billing page offers Ultra's checkout and the moves; and the Ultra
  message may be sent from the console (*The Ultra message*).

### Buying

`POST /account/billing/checkout` takes `plan` (`ultra`, or `pro`, which a
form naming none means) beside `interval`; anything else is a 400. Ultra is
sold only while it is on sale; otherwise the post returns to the billing
page and asks Stripe nothing. The session is Pro's with Ultra's price; it
returns to `/account?billing=done_ultra&session={CHECKOUT_SESSION_ID}`
("Thank you. Ultra starts once Stripe confirms the payment") and, cancelled,
to `/account/billing?plan=ultra`. The idempotency key names the plan with
the user, the interval, the language and the ten minutes, so the page's own
"Subscribe to Ultra instead" after Stripe's back link starts a checkout at
once (*Payments*, *Checkout and its way back*). The billing page's Subscribe panel shows one plan's
two buttons, Pro by default and Ultra at `/account/billing?plan=ultra`
(where Ultra's card leads), with a line to the other plan.

### Moving between the plans

`POST /account/billing/change` with `plan` reads the bound subscription for
its one item (`GET /v1/subscriptions/<id>`: the item's id, its price, the
price's product and its interval) and creates a portal session at the move
itself:

| Parameter | Value |
|---|---|
| `flow_data[type]` | `subscription_update_confirm` |
| `flow_data[subscription_update_confirm][subscription]` | the subscription |
| `flow_data[subscription_update_confirm][items][0][id]` | its item |
| `flow_data[subscription_update_confirm][items][0][price]` | the other plan's price of the same interval |
| `flow_data[subscription_update_confirm][items][0][quantity]` | `1` |
| `flow_data[after_completion][type]` | `redirect` |
| `flow_data[after_completion][redirect][return_url]` | `/account/billing?move=sent` (up) or `?move=down` |

Stripe's page shows the amount due before the reader confirms and handles
the card's authentication. When Stripe refuses the flow (any 4xx: a price
the portal's configuration does not list, a subscription it cannot
update), the plain portal opens instead, as Manage does, so the reader is
never left on an error; so it does when the subscription has no single
item or its price is one the site does not know. A move up is offered only
while Ultra is on sale; the billing page shows it to a subscriber whose
plan comes from a live Stripe row (Move to Ultra, plain, the Manage button
staying the filled one), and the move down to an Ultra subscriber. Nothing
is written by the route: the webhook changes the plan.

The plan a subscription pays for is its product's (`planOfSubscription`):
Ultra when its one item is on `STRIPE_PRODUCT_ULTRA` or one of the two
Ultra prices, Pro otherwise. Mapping by product keeps a subscriber on an
older Ultra price on Ultra after a price change; a product the site does
not know grants Pro, never Ultra.

| Notice | With two plans |
|---|---|
| `checkout.session.completed`, paid | The subscription is read already; the plan granted is its product's |
| `invoice.paid` | The subscription is read for its plan (unreachable: 500, nothing written). Active or trialing with no pending update: the plan is granted, the live row switched when the plan differs. A pending update naming Ultra: 500, so the notice comes again once it is settled. Any other status never raises the plan. A subscription Stripe no longer knows keeps the live row's plan |
| `customer.subscription.updated` | As before, and when the subscription's plan ranks below its live row's (a move down), the row is switched down at once, keeping its end, once a read of the subscription confirms it (a notice delivered late, from before a move up, changes nothing). Never raises a plan |
| `.deleted`, `charge.refunded`, `charge.dispute.created` | Unchanged, whichever plan: `.deleted` ends the subscription's live row; a full refund or a dispute ends every Stripe row of the account that existed when it was made (*What each notice does*) |

A switch is one batch: the live row's end set to now, and a row of the new
plan (with its tier row for Ultra) from now to the later of the old row's
end and the paid period's end plus the grace; the audit reads "stripe moved
to ultra" or "stripe moved to pro". A move up: Pro continues until a paid
notice shows the Ultra product on an active subscription; if the payment
fails, the account keeps Pro. A move down: Ultra continues to the end of
the period paid; at the renewal Stripe applies Pro, the update switches the
row keeping its end, and the renewal's `invoice.paid` extends it.

### Refunds

The refund of the first payment covers the account's first payment, Pro or
Ultra (*Refund of the first payment*). A move from Pro to Ultra is a second
paid invoice, so the press already refuses it; the page stops offering the
refund after any move (`REFUND_FACTS_SQL` counts the `plan_changed` rows
reading "stripe moved ...", and any one reads "none"), so it never offers
a refund the press would refuse. The audit keeps 90 days, longer than the 14.

### Operator steps

1. **Apply the schema** (any time before the variables; it adds
   `entitlement_tiers` and changes nothing else):

   ```
   cd site
   npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
   ```

2. **The product and its prices.** A product "Award Watch Ultra", the same
   software-as-a-service tax code as Pro, and two recurring CAD prices with
   tax behaviour exclusive. Note the product id (`prod_...`) and both price
   ids.
3. **The customer portal** (Settings, Billing, Customer portal): add the
   Ultra product and its two prices to plan switching beside Pro's; upgrades
   prorated and invoiced at once; downgrades at the end of the billing
   period; cancellation at the period's end as today.
4. **The webhook and the key:** no new event type, no new permission (portal
   sessions and subscription reads are granted already).
5. **A test in the sandbox, locally**, with test clocks: buy Ultra; buy Pro
   and move to Ultra; move with a card that attaches but fails its charges
   (4000 0000 0000 0341) and check the subscription stays Pro and active;
   move down and advance the clock past the period's end; refund an Ultra
   first payment; check the proration invoice carries tax under Managed
   Payments. Done on 2026-11-12 (*The sandbox run*).
6. **The five variables** in `site/wrangler.jsonc`:
   `STRIPE_PRODUCT_ULTRA`, `STRIPE_PRICE_ULTRA_MONTHLY`,
   `STRIPE_PRICE_ULTRA_YEARLY`, `PRICE_ULTRA_MONTHLY_CAD` and
   `PRICE_ULTRA_YEARLY_CAD` (digits, cents optional; they must match the
   Stripe prices, which nothing checks), then a deploy. Any one empty or out
   of form keeps Ultra off sale.
7. **One live purchase of Ultra** by the operator, then Refund now from the
   billing page, as for Pro.
8. **The Ultra message**, last (*The Ultra message*): the console refuses it
   until Ultra is on sale.

### Known limits

- **The console's refund after a move.** Refund the latest payment refunds
  the newest paid invoice's charge, which after a move up is the proration
  invoice, and Stripe's `charge.refunded` notice then ends every live Stripe
  row of the account, Pro included. Refund a move only together with a move
  back to Pro and a manual Pro grant to the period's end.
- **Removing Ultra's variables** while Ultra subscribers exist makes their
  next paid notice grant Pro, and an update notice lower them to Pro: the
  product is then unknown to the site. Keep the product id set while any
  Ultra subscription bills.
- **Not covered by the sandbox run:** the yearly prices, the French
  checkout, and a move that changes the billing interval (monthly Pro to
  yearly Ultra).

### The sandbox run

Operator step 5, run on 2026-11-12 against a sandbox that copies the live
account (the
same products, prices and portal settings), with the site on the local
machine and Stripe's events replayed to the local webhook. Monthly prices,
a British Columbia address, test clocks for the passing of time.

| Check | What Stripe did | What the site did |
|---|---|---|
| Buy Ultra | CA$38.99 plus CA$4.68 tax, paid | Ultra on the paid notice |
| Buy Pro, then move to Ultra in the portal | A proration invoice of CA$20.00 plus CA$2.40 tax, paid at once | Pro until the proration's paid notice, then Ultra; Refund now no longer offered |
| The same move with a card that attaches and fails its charges (4000 0000 0000 0341) | The charge declined; the subscription stayed on Pro's price and active, with a pending update; the update lapsed and its invoice was voided | Pro throughout |
| Move down to Pro | The change held to the period's end, then a Pro renewal billed | Ultra to the period's end, Pro from the renewal |
| Refund now on an Ultra first payment | CA$43.67 refunded, the subscription cancelled | Free |
| Tax on a proration invoice | Charged, as on a first invoice | no part |

Three things the run showed:

- A price whose tax behaviour is left unspecified is charged as exclusive
  under Managed Payments (tax added on top), the same as a price set to
  exclusive.
- Managed Payments refuses a change to a subscription's default payment
  method through the API; a card is replaced in the portal, as a customer
  does it.
- The portal's return addresses are built from `SITE_URL`, so a local run
  returns to the address that variable names.

## Seats

A seat is one named person with an account and a sign-in of their own, who
takes the plan of the account that subscribes while the seat is live and
that plan holds it (the operator's rulings of 2026-11-16). Pro has 1 seat,
the subscriber's; Ultra has 5, the subscriber's (the holder's) and 4 the
holder gives by invitation (`PLAN_SEATS`). When the holder's plan stops
covering a seat, the seat stays and gives no plan; what its member keeps
stays theirs.

What is built is the table, the plan read through a seat, deletion, the
sweep, the console's read, the pool at the inserts (*The pool*), the pool
in service (*In service*), and, behind a switch of their own that ships off
(*The seats' switch*), the invitation and its message, the invitation's page,
the Seats page of a holder and of a member, leaving a seat and removing a
member, the plan cards' seats row, `/pro`'s and the landing card's lines, the
Terms' Seats section, the privacy page's paragraph, the lines a control reads
where the subscription is full, the delete page's line, and the console's
actions on a seat (*What the seats say elsewhere*), and the seat notices by
email with the billing and refund pages' lines on the seats a holder gives
(*The seat notices*). While that switch is off
nothing creates a seat: there is no route under `/account/seats` or
`/account/seat` and no line about seats on any page, and with no seat row
every page, post, feed, API answer and email reads as before. The code is `site/src/account/entitlements.ts`
(`planFor`, `withSeats`, `seatsReady`), `site/src/account/seats.ts`,
`site/src/account/seats_pages.tsx`, `site/src/account/seats_lines.tsx`,
`site/src/account/seats_strings.ts`, `site/src/account/seat_mail.ts`,
`site/src/account/pool.ts` and
`site/src/account/pool_lines.tsx`; the tests are `site/test/seats.test.ts`,
`site/test/seats-unchanged.test.ts`, `site/test/seats-pool.test.ts`,
`site/test/seats-service.test.ts`, `site/test/seats-switch.test.ts`,
`site/test/seats-invite.test.ts`, `site/test/seats-words.test.ts` and
`site/test/seat-mail.test.ts`.

### The table

| Table | Columns | Rule |
|---|---|---|
| `seats` | `id`, `holder_id`, `email` and `token_hash` (an invitation's address and SHA-256 of its link's secret), `lang`, `invited_at`, `expires_at`, `member_id`, `joined_at`, `ended_at`, `ended_why` (`declined`, `cancelled`, `left`, `removed`, `deleted`, `closed`, `operator`), `told` and `told_at` (what the seat notices last said) | One row is an invitation and, once taken, the seat it became: taking it writes the member and clears the address and the hash. The holder's own seat has no row. One live seat a person (`idx_seats_member_live`); a member always has a join date (a CHECK) |

Its three indexes: `idx_seats_member_live` (`member_id`, live seats only),
which every plan read probes; `idx_seats_holder` (`holder_id`, `ended_at`,
`joined_at`), a holder's seats; `idx_seats_email` (`email`, `invited_at`,
invitations only), an address's invitations. A row names no plan, price,
subscription or count: the plan is read from the holder's own entitlements.

### The plan through a seat

`planFor` keeps its signature and still sends one statement
(`PLAN_ROWS_SQL`, the account's id bound once), now in three halves:

- the account's own entitlements, as before;
- the holder's own entitlements when the account holds a live seat, with the
  holder's id and address, whether the holder is active and not blocked,
  and the seat's id (a holder with no entitlement still gives one row, with
  no plan);
- the group's live seats: the holder's when the account holds one, else the
  account's own as a holder.

From those rows:

- A **member** takes the plan the holder's own rows give, with the holder's
  end, while its seat is covered: the holder is active and not blocked, and
  the seat is among the first `PLAN_SEATS[plan] - 1` of the holder's live
  seats by join date, then id. A fifth live member on Ultra is not covered.
  Its own plan wins when it is as high (an Ultra the operator granted by
  hand: no plan is above Ultra, the one plan with member seats), and the
  account is then in no group. An uncovered member reads its own plan.
- A **holder** whose plan covers at least one seat leads a group.
- `PlanState.seat` (the seat's id, the holder's id and address, covered or
  not) is present for an account holding a live seat; `PlanState.group`
  (the holder's id, the ids of the holder then the covered members by join
  order, the account's place) for an account in a group. `Account` (the
  session read) carries both, remembered with the rest for an outage; a
  plan that has ended through the outage takes its group with it.
- The cache on `users` is written as before: a covered member's says `pro`
  with the holder's end, so through an outage a member is served as an Ultra
  holder is.
- For every other account the answer is the three fields it always was,
  from the same rows: the statement's first half is today's statement, and
  the other two are one probe of `idx_seats_member_live` and two more
  (that index, then `idx_seats_holder`) that find nothing. The session read,
  the keyed API, the calendar feeds, the delivery run's parts, the console
  and the webhook's cache refresh all call `planFor` as before, so none of
  them sends a statement more.
- `LIVE_PRO_SQL` (the same-day gate and the daily check) counts entitlement
  rows; a member has none, so a subscription with seats counts once, its
  holder.

The one place a member sees this is the overview's plan line: "Ultra, a
seat on the subscription of (the holder's address)" in place of "Ultra,
until (date)", the end date being the holder's billing; and for a seat that
gives no plan now, "You hold a seat on the subscription of (address), which
gives no plan now. Your account is on Free." (the account's own plan line in
place of Free). A member reads nothing else of the holder, and a holder
nothing of a member.

### The pool

Every counted figure of a subscription with seats is the subscription's
(the operator's ruling of 2026-11-16, "one shared pool"): it is counted over
the group, the holder and the members its plan covers, inside the insert
that holds it. The figure is the plan's, as for an account alone; a
member's plan is the holder's, so the figure is the holder's plan's.

| Figure (Ultra) | Held in | Counted over the group |
|---|---|---|
| 100 saved searches and briefings | `addSearch` (and `importInterest`, which adds through it), `addBriefing` | both tables; while `briefings` is not on the database, the searches alone, the fallback having a group's form of its own |
| 100 watches | `ADD_WATCH_SQL` | every watch but each person's own claimed organization's, the claim read for each row's account; the one place more is still for the adder's own claim |
| 50 saved views | `ADD_VIEW_SQL` | every view |
| 5 dashboards | `NEW_BOARD_SQL`, and `BOARD_INSERT_SQL` (the first, written with an account's first change) | every dashboard; a new one's place among the tabs is the account's own |
| 5 API keys | `createKey` | the live keys; a key's name is each person's own |
| 5 calendar feeds | `createFeed` | the live feeds; a search's feed still needs the account's own search |
| 5 bug reports a day | the bug form's insert (`bugs.tsx`) | the day's reports; the same report again is the account's own repeat |
| 30 downloads a minute | the limiter (`limits.ts`, `PAID_DOWNLOAD_LIMIT`) | one key for the group, `account:<holder id>`, where an account alone has `account:<user id>` |

Not pooled: a dashboard's tiles (each dashboard's own figure, so
`ADD_TILE_SQL` and the move to another dashboard are unchanged), the keyed
API's day (per key, `KEY_PER_DAY_ULTRA`), and every figure that is each
person's (analytics years, organizations compared, earlier contracts,
matching notices, the radar's windows, signed-in browsers).

`pooled(who, X_SQL, X_GROUP_SQL)` (`pool.ts`) chooses the statement, so no
caller spells the group. An account in no group sends today's statement,
word for word, with the same values bound. An account in a group sends the
statement's group form: the same text with the cap's count read as
`user_id IN (?n, ?n+1, ?n+2, ?n+3, ?n+4)`, five places (`POOL_SLOTS`, the
most people a plan's group holds) numbered after the statement's own, the
group's ids bound there and NULL in the places left over. The first
dashboard's group form also binds the plan's figure. The ids are the
request's session read (`Account.group`, from `planFor`'s one statement),
never a value from the request, so a group adds no statement and no round
trip, and no statement binds more than 15 values. Each count reads through
the table's index on `user_id`. D1 runs one statement at a time, so when two
people of one group add at once, the second counts the first's row and is
refused at the figure.

The pool is counts only. A group's form counts the group's rows and
selects, returns or changes nothing of another account; whatever else an
insert checks (the same filter, subject, page, address, name or report)
stays the account's own, so a member may save the filter another member
saved.

A refusal reads as the plan's figure reads today: the searches page's cap,
the watch button's cap, the views' full line, the keys page at its limit,
the feeds' cap, the bug form's daily limit. A member with no dashboard whose
group holds 5 has an allowance of none: every post that would write its
first dashboard keeps nothing and answers with the dashboards' full line
(`dash.boards_full`), the page's script is told the layout cannot be kept,
and the page says the dashboard is saved and unavailable in place of the
starting layout (*In service*).

The counts the pages state are the group's for an account in a group, so a
control reads full when the subscription is: `searchState`, `heldCount`
(`heldCounts` gives both), `briefingState`, `watchState`, `watchCount` and
`viewState` (the views' Save control) answer the group's count as `n` and
the account's own as `mine`, from the same statement. For an account in no
group each answers exactly what it did, with no `mine`. The list pages state
the group's count with the account's own (*In service*).

The group is read once a request, so a seat ended or taken between that read
and the insert makes the count read one account too many (refusing early)
or one too few (letting one item past the figure). A newcomer's items come
last in the order below, so an item let past the figure that way is saved and
unavailable, and the figure in service holds.

Known, left as it is: an account that holds a seat and has an Ultra grant of
its own is in no group itself (its own plan wins), while the holder's
`planFor`, which does not read a member's own plan, still lists it in the
holder's group. Its items count in the holder's pool, and its own adds
count against its own figures alone. Only the operator's grant to an
account in a seat makes this happen.

No account is in a group until a seat is given. With no seat row, every
account sends today's statements, and the limiter keys every download as
before.

### In service

When a group holds more than a figure (a person joins with things of their
own, the plan moves down), nothing is deleted. The holder's items are in
service first, then each member's in the order the seat was joined, each
account's own oldest first (made, then id); the rest are saved and
unavailable, and come back into service with no step from anyone when there
is room again (someone removes items or leaves, or the plan grows).

An account's allowance of a figure is the figure less what the accounts ahead
of it in the group hold, never below none; the holder's is the whole figure.
Every rule that served "the first N by creation" after a move to a smaller
plan keeps its statement and compares with the allowance in place of the
plan's figure. For an account in no group the allowance is the plan's figure
and nothing more is read.

The counts come from one statement a group, `POOL_COUNTS_SQL` (`pool.ts`):
for each account of the group, its saved searches with its briefings, its
watches less its own claimed organization's, its saved views, dashboards,
live keys and live calendar feeds. It returns numbers by account id and
nothing else, each counted through the table's index on `user_id`, and is
sent only for an account in a group, with the ids the session read or
`planFor` gave.

| Where | In service | Past the allowance | Read for it |
|---|---|---|---|
| Saved searches by email (the delivery run) | the account's searches and briefings made before it fewer than the allowance (`n_before`) | passed over for the data date, as a search past a plan's figure is | `POOL_COUNTS_SQL` once a group a run, kept by holder (`RunPool`), counted in the run's query budget |
| The watch mail | the claimed organization's watch and the first watches up to the allowance (`coveredWatches`) | listed, no events | the same read |
| Briefings | as the saved searches, one figure with them | passed over for the week | the same read |
| Saved views by email | the views made before it fewer than the allowance | passed over for the period | the same read |
| The weekly email | the claimed organization's watch and the first watches up to the allowance, as the watch mail reads them; its matching notices and the site's figures are no account's items | not in the message; after its lead (which counts the pages covered alone), one line says how many wait, as the watches page says it ("2 of this account's watches are saved and unavailable until the subscription has room: ..."), in place of the invitation to follow a page when none is covered | the same read |
| An API key | the live keys of the accounts ahead and the account's own made before it fewer than 5 | 403, "This key is saved and unavailable until the subscription has room for it: its 5 keys are in use." | one statement (`KEY_SERVED_SQL`), for a member's key only, its answer kept with the key's last-known answer for 5 minutes (`KEY_SERVED_MS`) |
| A calendar feed | the same rule for feeds; a search's feed also needs its search in service; the watches of the watchlist's and the "all" feed to the allowance, and the "all" feed's tender searches to the searches' allowance (`FEED_SEARCHES_SERVED_SQL`, sent in place of the plain read) | answers as a feed on a plan without feeds does (the site's 404); a search past it is left out of the "all" feed | one statement (`FEED_SERVED_SQL`), for a member's feed only |
| A dashboard | the account's dashboards by creation (not by tab order) up to the allowance | its tab kept and marked; its page says so in place of its tiles and reads none; a tile of it is not drawn alone | `POOL_COUNTS_SQL`, one a page view |
| A dashboard's tiles | a tile of a saved search, a briefing or a saved view (by its id) within the allowance; the watches tile reads the claimed organization's watch and the watches up to the allowance; the keys' tile lists every live key | the tile keeps its head and says "Saved, unavailable until there is room" in place of its body, and reads nothing for it (alone too); a watches tile with none covered says the same; a key past it is marked | the page's own `POOL_COUNTS_SQL` read, nothing more |
| Add a Tile, and Add to dashboard on a row | the items in service, as the tiles read them | not offered: Add a Tile's select leaves out each saved search, briefing and saved view (either kind) past the allowance, and the watches while none of the account's is covered; on the searches page, its briefings panel and `/account/views`, such a row has its mark where Add to dashboard was | the page's own `POOL_COUNTS_SQL` read, nothing more |

The holder's items are always in service, so the run and the key and feed
checks read nothing more for a holder; a page reads the group's counts for
the holder too, to state them.

On the list pages, for an account in a group only, each count is the group's
with the account's own beside it ("This subscription holds 97 of its 100
saved searches and briefings; 12 are this account's."), each row past the
allowance is marked "Saved, unavailable until there is room", and a line
above the rows says how many are past it: `/account/searches` and its
briefings and calendar feeds panels, `/account/watches` (with the watches'
feed), `/account/views` (a view past it offers no email), the Saved Views
panel of `/analytics`, `/account/keys` (a key past it says so in its Status,
in place of "In use") and the dashboard's tabs. Tiles of an analytics table,
of a view kept at its address and of the analytics builder hold a view's
address, not a counted item, so the allowance does not touch them. The
searches page counts the "all" feed's events as the feed lists them. The
searches and watches pages' notices at the figure state the group's count
too. New Dashboard and a new key or feed are offered while the subscription
has room. A member reads the group's totals and its own counts, never
another account's count by itself, and nothing of what another account
keeps.

A person who leaves, is removed, or whose seat stops being covered is in no
group from the next read: their things are under their own plan's figures
(Free's, as a rule), saved and unavailable past them, and the group's counts
drop by theirs at once, so the others' items past their allowance come back
into service.

### The seats' switch

`SEATS` in `site/wrangler.jsonc`, `"off"` as shipped. `seatsOn(env)`
(`seats.ts`) is true only when it is `"on"`, the accounts switch is on and the
seats table is on the database (`seatsReady`); it asks the variable first, so
while it is off nothing is read. While it is off, or on without the table:

- every address under `/account/seats` and `/account/seat` answers the site's
  404 page, the same answer as an address the accounts module does not know,
  before anything else is read;
- no page names a seat: the overview has no Seats row, the billing page no
  Seats link, and a seat's member keeps its Subscribe panel; no plan card has
  the seats row, and `/pro`, the landing page, the Terms, the privacy page,
  the delete page and the Ultra message read as before;
- no invitation is sent (the console's actions on a seat are the one thing
  the switch does not gate: see *The console* below), and no seat notice: the
  delivery run asks the variable and reads no seat for them;
- a control at its figure reads the line it read before, whoever reads it;
- the limiter counts those addresses as pages.

`site/test/seats-switch.test.ts` holds every page of a signed-out reader and
of a Free, Pro and Ultra account, Ultra off sale and on sale, the table
present and absent, to the bytes main drew before the switch existed
(`site/test/seats-switch-today.ts`, captured from main), and holds every
seats address to the 404 with nothing more read. With the switch on, the
same test takes out of each page exactly what *What the seats say
elsewhere* adds (the cards' seats row, `/pro`'s Ultra text and question, the
Terms' section and phrase, the privacy paragraph, an Ultra account's
overview row and billing link) and holds what is left to the same bytes.
The operator sets it `"on"` once the lawyer's read of the Terms' Seats
section and of the invitation is done.

### Invitations

Only a holder whose own plan has member seats (Ultra: 4) invites, its
session read from the database now (one remembered through an outage is
refused, as the refund is). The Seats page's "Invite a Person" panel posts
an address and the message's language to `POST /account/seats/invite`. In
order, nothing written before each: the address in form and not the
holder's own ("That is this account's own address..."); the day's mail
ceiling has room (`dayRoom`; at 0, "No more invitations can be sent today",
429, no row); then one statement (`INVITE_SQL`, 13 values bound) writes the
invitation only while all of these hold inside it:

| Held | Figure | Refusal |
|---|---|---|
| The seats in use (live seats and open invitations) below the plan's member seats | 4 on Ultra | "All 5 seats are taken or invited..." |
| The holder's invitations in any 24 hours | `SEAT_INVITES_PER_DAY` 10 | "This account has sent 10 invitations in the last 24 hours..." |
| The holder's invitations to one address in 30 days | `SEAT_INVITES_PER_ADDRESS` 2 | "This address has had 2 invitations from this account..." |
| Joins in 30 days (rows joined in the window, ended or not) with the open invitations | member seats + `SEAT_SWAPS` 2: 6 on Ultra | "6 people have joined this subscription or been invited to it in the last 30 days... Try again from (date)." |
| The address holds no seat of this holder | | "(address) holds a seat on this subscription already." |
| The address has no open invitation of this holder | | "(address) has an invitation waiting already." |

D1 runs one statement at a time, so two invitations posted at once for the
last seat write one row. When nothing is written a second read
(`INVITE_WHY_SQL`) picks the line. Every count is per holder, so the answer
is the same for an address with an account as for one without, and for
every address outside the holder's own members and invitations.

The row keeps the address (as sign-in normalizes it), the language, when it
was sent and when its link ends (`SEAT_INVITE_DAYS`, 7 days), and SHA-256 of
the link's secret (32 random bytes): the secret is in the link and nowhere
else. The message (`sender.ts inviteMessage`) goes through the sign-in
message's path (`senderFor`), in the language the holder chose: headers
`Auto-Submitted: auto-generated`, Reply-To the contact address, no
`List-Unsubscribe` (one message about one invitation; nothing follows it). Its
subject names no address; its body names the holder's own address, says what
a seat gives and what the holder sees, carries the link
(`/account/seats/join?i=<id>&t=<secret>`) and until when it works, and says
that ignoring it does nothing and that the invitation and its address are
deleted 30 days after sending. It counts against the day's ceiling: each
send writes a `delivery_runs` row of outcome `invite` (sent 1, or failed 1),
which `DAY_SENT_SQL` counts with the job's and the console's sends and the
daily check reads as sends only (`SEND_ONLY_OUTCOMES`, never a run of the
job). A message that does not go removes the invitation ("The invitation
could not be sent, and nothing was kept."). Audit `seat_invited`, no detail.

The holder's Cancel (`POST /account/seats/:id/cancel`, bound to the holder)
ends an open invitation `cancelled` and clears its hash, so the link stops at
once; the address stays on the row until the sweep, so the per-address count
still holds it. Audit `seat_cancelled`.

### The invitation's page

`GET /account/seats/join?i=&t=` reads the row by its id, checks the secret's
form and compares its hash in constant time; a wrong, unknown, run out,
taken, declined or cancelled link, or one of a holder no longer active, is
the same page ("This invitation link has expired, been used or been
cancelled.", 400). The GET writes nothing of the invitation, so a mail
scanner that opens the link uses nothing up. Then, by reader:

- signed out: who invited the address, what a seat gives (the Ultra card's own
  lines) and the sign-in form with the address filled in and the page as
  `next`, so the sign-in ends here (the secret rides in the sign-in message's
  link, to the same address);
- signed in as another address: whose the invitation is, and nothing to press;
- an account holding a seat elsewhere, or with a paid plan of its own: why it
  cannot take one, and Decline;
- the take would refuse it now (the holder's plan has no member seat for it,
  its seats are all taken, the holder is blocked, or the 30 days' joins are
  spent): "This subscription has no seat for you now.", and Decline;
- otherwise What Fits and Take the seat (the page's filled button) beside
  Decline.

The GET writes nothing at all: it reads the holder's plan with `planFor`'s
write turned off (`planFor(env, user, now, false)`), so not even the
holder's cached plan columns change when a link is opened.

What Fits is the pool's own rule (`seats_pages.tsx whatFits`): the holder's
group as its own plan reads it now, the reader placed after its members, and
each figure's allowance from one `POOL_COUNTS_SQL` and `allowanceIn`, the
reader's items by creation served first. Where the reader's own would pass
the room left, it says how many would be in service and how many saved and
unavailable; else "Everything your account keeps fits."

`POST /account/seats/join` (session, CSRF, Origin, the secret again, `action`
take or decline) requires the session's address to be the invitation's (any
other gets the line above, 403, and nothing changes). Decline ends it
`declined` and clears the hash (audit `seat_declined`). Take needs the session
read from the database, no seat and no paid plan of the account's own, and
the holder's own plan read now from the database (`planFor`; a plan answered
from the cache through an outage grants nothing: the 503 page); a holder
blocked, or whose plan holds no member seat, gets "This subscription has no
seat for you now." Then one statement (`TAKE_SQL`) writes the member and
clears the address and the hash only while the invitation is open with the
hash compared, the holder's live seats below its plan's and the window's
joins below its figure. Two presses take it once (the second reads the stale
line); one person taking two holders' seats at once meets
`idx_seats_member_live` ("This account holds a seat on another
subscription..."). Audit `seat_taken`.

### The Seats page

`GET /account/seats` (`private, no-store`). For a holder whose plan has
member seats: each person (the holder first, "Yours, the subscriber's", then
each live seat, "Taken" or "Taken, without the plan for now", with Remove,
then each open invitation with until when its link works and Cancel), "n of 5
seats", the joins line, "What the Subscription Holds" (each pooled figure's
total against the plan's figure and each account's count, in columns headed
by address, and how many items are past the figures when any are; a person
in a seat the plan does not cover now is in the people's table and not
counted here, which a line under the table says), and "Invite a Person". On
a phone the figures' table puts each label before its value, so an address
is never broken in the middle. For Free or Pro: the seats each plan has and the plan
cards; an account that still gives seats its plan does not hold (a holder that
moved down or lapsed) also sees those people, with Remove, and the line on
what that means for them. For a member: its seat (whose subscription, whether
it gives Ultra, what the holder sees, that billing is the subscriber's), Leave
this seat, and the subscription's totals beside its own counts.

Counts, never content: the holder reads its own seat rows, its members'
addresses (which it typed) and `POOL_COUNTS_SQL` over the group its own
session read gave; a member the same counts over its own group. No page of
one account shows another's searches, watches, views, dashboards, keys or
pages, and no statement takes an account id from a form.

Remove (`GET` then `POST /account/seats/:id/remove` with `confirm=yes`, bound
to the holder) ends the seat `removed`; the member is on its own plan from its
next read and is told by the seat notices (*The seat notices*). Leave (`GET` then `POST
/account/seat/leave`, `confirm=yes`, bound to the member) ends it `left` with
`told` at 0, since the page itself said so. Audit `seat_removed`,
`seat_left`, no detail.

The overview's Seats row reads "n of 5 seats" for a holder, "Your seat" for a
member, and "Seats this plan does not hold" for an account that gives seats
its plan does not hold; the billing page's head links the Seats page for each
of them. A member's billing page shows "Billing is the subscriber's. To buy a
plan of your own, leave the seat first." in place of Subscribe, and its plan
line names the holder rather than the holder's end; its checkout post is
refused (409) before anything is asked of Stripe.

Buckets (`limits.ts`, while the switch is on): the invitation and the join
page's post with the forms (5 a minute), the join page with the stop links
(20), cancel, remove and leave with the edits (60), the pages as pages.

### Before the table is on the database

`withSeats`, beside `withTiers`, sends `PLAN_ROWS_SQL`; when the answer is
"no such table: seats" it sends today's statement instead
(`ENTITLEMENTS_SQL`, or its form without `entitlement_tiers`), logs one line
an isolate ("account plan: seats missing, every account read without a seat
until accounts_schema.sql is applied", naming no account), and sends only
today's statement for the next 10 minutes (`SEATS_RECHECK_MS`), so the
delivery run does not spend two queries an account against its budget while
the schema waits. Any other fault passes on, a missing `entitlement_tiers`
included, so the tier table's own fallback works as before whichever of the
two tables is missing. `seatsReady(env)` says whether the table is there: a
true answer is kept for the isolate's life, and a missing table is
remembered as `withSeats` remembers it. Deletion, the sweep and the console
pass over a missing table without a line. Nothing answers 500, and every
page reads as it does with the table present and empty.

### Deletion and the sweep

An account's deletion (`endSeatsOf`, one batch of its own before the rest,
so a database without the table still deletes everything else):

```sql
UPDATE seats SET ended_at = ?1, ended_why = 'closed', email = NULL, token_hash = NULL WHERE holder_id = ?2 AND ended_at IS NULL;
UPDATE seats SET ended_at = ?1, ended_why = 'deleted', told = 0 WHERE member_id = ?2 AND ended_at IS NULL;
DELETE FROM seats WHERE email = ?1 AND member_id IS NULL;
```

The seats the account gives and its open invitations end `closed`, their
addresses cleared; the seat it holds ends `deleted`, with `told` at 0 so no
notice follows; every invitation to its address that was never taken goes.
Each member of a deleted holder reads its own plan from the next request.

The sweep (`signin.ts sweep`, in a try block of its own) deletes a row 30
days after it ends, and an invitation never taken 30 days after it was sent
(`SEAT_KEEP_DAYS`); a live seat stays whatever its age.

### What the seats say elsewhere

Each only while the switch is on (`seatsOn`; the page's shell carries it as
`Shell.seats`, the landing page and the Ultra message read it themselves);
with it off, every one of these reads as before.

- **The plan cards.** A row first on every card (`pro.tsx SEATS_ROW`, drawn by
  `planRows(plans, { seats })`): each plan's own figure from `PLAN_SEATS`,
  "1 seat" on Free and Pro, "5 seats sharing these figures" on Ultra ("1
  siège", "5 sièges qui partagent ces chiffres"). Free and Pro have the same
  figure, the one counted row where Pro's is not above Free's
  (`test/pro-mark.test.ts` holds it to Free <= Pro < Ultra). Every card has
  it: `/pro`, the billing page, the tease panels, the dashboard's and the saved
  views' pages, the Seats page, the landing page; Ultra's line is one of
  Ultra's own (`ultraOwnRows`), so the landing page's waiting Ultra card and
  the Ultra message (`announce.tsx ultraMessageLines`, the console's preview
  and the mail check) list it too.
- **`/pro`.** The Ultra section's text names the seats and which figures the
  people in them share (`propage.ultra_text_seats`, the keys' figure read from
  `KEYS_MAX`), and the questions gain "Can several people use one
  subscription?", in the page and in its FAQ markup; both only while Ultra is
  on sale, as the section is.
- **The Terms.** While Ultra is on sale, a Seats section after What the Paid
  Plans Include (`terms.pro_seats`, every figure read when drawn: the plans'
  seats, the invitation's days, the joins and their window, the signed-in
  browsers), and the abuse paragraph names a seat beside an account
  (`terms.pro_abuse_seats`). Both wait on the lawyer's read.
- **The privacy page.** A paragraph after the signed-in browsers' sentence
  (`seats.privacy`): what an invitation and a seat keep and for how long
  (`SEAT_KEEP_DAYS`), who sees which addresses and counts, and what a
  deletion does to them.
- **A control at the subscription's figure.** For an account in a group, the
  line that said "this account" (`seats_lines.tsx`): a member reads "The
  subscription's (figure) (things) are all in use. Ask (holder), who holds the
  subscription, or remove one of yours.", the holder's address from the
  member's own session; the holder reads that the Seats page shows how many
  each seat holds, with the page linked. Save this search and Add a Search,
  Follow, Save this briefing, Save this view, Create a key, the calendar
  feeds' panels, and the notices a refused post returns to (a search, a
  briefing, a watch, a calendar feed, a new dashboard; the dashboard's in
  words alone). The briefings' panel says a briefing counts toward the
  subscription's figure. An account in no group reads every line as before.
- **The delete page.** A member reads "Deleting the account ends your seat on
  the subscription of (holder)."; an account that gives seats reads how many
  end with it, invitations included. A member's subscription line no longer
  names the seat's plan as its own.

### The seat notices

While the switch is on, the delivery run has a sixth part, after the saved
views (`seat_mail.ts runSeatNotices`), inside the run's cap of messages, the
day's ceiling and the query budget, and counted in the run's row as every
part's messages are. It tells a seat's member, by one message to its own
address in its mail language (`users.lang`), when what the seat gives it
changes:

| Message | Subject | When |
|---|---|---|
| lost | "Your seat on Award Watch no longer gives Ultra" | the seat gave the plan and gives none now: the holder's plan ended (cancelled at its period's end and past its grace, a renewal not paid, Refund now), was revoked or disputed, moved to Pro, or the holder was blocked |
| back | "Your seat on Award Watch gives Ultra again" | the seat gives the plan again: the holder moved back to Ultra or bought it again (no new join is counted) |
| ended | "Your seat on Award Watch has ended" | the holder removed the member, the holder's account was deleted, or the operator ended the seat |

The message says what changed and from which day, the plan the account is
on now and that what it keeps is saved (lost and ended), and links the
account's page and the plan and billing page. It never says why the holder's
plan changed (that is the holder's billing), names no address and no other
account's figure, and carries no stop link and no `List-Unsubscribe`: it is
one message about one change to the account's own plan, sent once (headers:
From, Reply-To the contact address, `Auto-Submitted: auto-generated`). It
goes out through the run's path (`sendWithHeaders`), so a sending limit's
refusal stops the run as it stops the other parts.

Nobody else is told: a member who left (the page said so) or deleted its
account, a member whose account is blocked or no longer active (passed over,
as the other parts pass such accounts over, and told when that changes), an
invitation (no member, the operator's cancellation among them), and a member
with Ultra of its own (the operator's grant) while that lasts.

How it decides, in the seats table's own columns: `told` is what the member
was last told (1 the seat gives the plan, which taking it says; 0 it gives
none, or it ended) and `told_at` when; an ended seat has been told its end
once `told_at` is at or after `ended_at`, so a member told "lost" and then
removed reads "ended" too, as the removal page promises. Each run reads
(`SEATS_DUE_SQL`, at most `SEATS_RUN_MAX`, 200) the live seats and the seats
ended `removed`, `closed` or `operator` whose end is not yet told, of
members that are active and not blocked: the ended ones first, then the live
ones a holder at a time from a point that changes each run, so every
holder's are read in turn when more than 200 are live. For a live seat it
reads the holder's plan once a run (`planFor`, whose group names the members
the holder's own plan covers); a seat whose `told` already says what is
true costs nothing more. A seat to tell reads its member's plan (`planFor`),
which decides the message and names the plan: what the site serves the
member is what the message says. A plan that cannot be read from the
database now (`planFor`'s last known plan) tells nobody anything, and the
seat waits for the next run. The message is claimed before its send by
writing `told` and `told_at` in a statement that holds only while the row is
as the run read it (`SEAT_CLAIM_SQL`), and given back when the send does not
go (`SEAT_RELEASE_SQL`). A sending limit's refusal stops the run and the
seat is read again by the next. Any other refusal counts as failed once, and
the claim is given back with `told_at` set to the next UTC day, written as a
date alone (`seatWaitDay`): the part does not read the seat again before that
day's first run, so an address that refuses is tried once a day rather than
every run, and a date alone never counts as an end told, so a seat that ends
while it waits is told its end. Without the seats table the part
reads one statement, sends nothing, and the run's report says so. No column
or table is added.

Before the act, on the holder's billing page, while the switch is on and the
holder's plan covers at least one other seat (the session's own group, read
with nothing more): the subscription's panel, whose Manage button opens
Stripe's page where it is cancelled, says "When the plan ends, the 2 people
in your other seats return to their own plans, with what they keep saved."
(`billing.seats_ends`); the Move to Pro panel says "Pro has 1 seat. When the
move takes effect, the 2 people in your other seats return to their own
plans, with what they keep saved, and each gets one message."
(`billing.seats_down`); and the refund's confirmation says "The refund ends
Ultra at once for this account and for the 2 people in its other seats."
(`refund.seats`). Each has a form for one person. With the switch off, or no
other seat covered, the page is as before.

`site/test/seat-mail.test.ts` holds every row of the seats design's table of
the subscription's and the seat's edges that tells a person (each told once,
nothing twice) and every one that tells nobody, the claim given back, the
run's cap, the day's ceiling and the query budget, the run's row, a fault
after a send, a plan not read, the switch off and the table missing, and the
billing lines in both languages; the mail suite renders the three messages
in both languages through the part itself.

### The console

An account's page (`/admin/users/<id>`) shows a Seats panel when a seat row
names the account, and nothing otherwise. For a holder: "5 of 5 seats: this
account, 2 members, 2 invitations open", then its rows (the member's address
leading to that account's page, or the invited address; whether the seat
gives the plan now, waits as an invitation, has expired or has ended; when
it was sent, taken and ended, and why), the ended rows of the last 30 days
muted. For a member: "A seat on (the holder's address) since (date); it
gives Ultra now", or "it gives no plan now". It reads nothing while the
table is not on the database.

Whenever an account has a seat row, the seats' switch on or off, a holder's
rows gain a last column: End this seat
on each live seat, Cancel this invitation on each invitation still open.
Each is a page (`GET /admin/users/<id>/seats/<seat id>/end` or
`.../invite-cancel`) that names the subscriber and the person or the invited
address, says what it does and asks for the box; its post (the console's
Origin and CSRF checks, `confirm=yes`) is bound to the holder the address
names. Ending a seat sets it `operator`: the member is on its own plan from
its next read and nothing of theirs is deleted. Cancelling an invitation
sets it `operator` and clears its link's hash, so the link stops at once;
the address stays on the row until the sweep, as the holder's own
cancellation leaves it. Each writes `operator_seat_ended` (on the holder and
on the member) or `operator_invite_cancelled` (on the holder), the detail
naming the operator by id alone: no address and no seat id. A row no longer
open answers "Nothing changed: that seat or invitation is no longer open."
The switch plays no part here: a live seat gives its member the plan whether
the switch is on or off (the plan is read from the seat's row), so ending one
is always open to the operator. Without the seats table both addresses are
the site's 404, and an account no seat row names has no such column.

The overview (`/admin`) has a panel "Seats and Signed-In Browsers" whenever
the seats table is on the database, the switch on or off: the seats taken
now and the subscriptions that give them, the invitations open now, the
joins of the last 30 days (`SEAT_WINDOW_DAYS`, ended seats counted), the
browsers the cap of signed-in browsers signed out in the last 30 days
(`CAPPED_DAYS`, the audit's `signed_out` rows of detail `cap <n>`), and how
many accounts it signed out 10 or more of in that window
(`CAPPED_ACCOUNT_MIN`), the mark of one sign-in shared by a team. Counts
alone: the panel names no address and no id. Its two statements
(`SEAT_SIGNALS_SQL`, `CAP_SIGNALS_SQL` in `admin_ops.ts`) go in the batch
the overview sends already, each through an index; without the table the
panel is left out and neither is sent. The accounts table has a Seat column
and filter (*Operator console*, *The accounts table*).

A member cannot buy a plan (checkout refuses it) and a take refuses an
account with a paid plan, so the operator's grant is the one way an account
could hold a live seat and a plan of its own, and be counted in its
holder's pool while out of its group. The grant closes it. For an account
that holds a seat, the grant's post first answers a page that names the
subscription's holder (linked to its console page), says the grant ends the
seat at once and that the person is told the seat ended, and lists the
plan, end date and reference; its form carries them with the seat's id and
the box. The confirmed post reads the seat again (a fault there ends on the
503 page and grants nothing; a seat other than the one confirmed shows the
page again, 409), then writes the grant and ends every live seat of the
account (`ended_why = 'operator'`, `seats.ts GRANT_ENDS_SEAT_SQL`) in one
batch, so either both are written or neither is; it writes `operator_granted`
and End this seat's two `operator_seat_ended` rows (on the holder and on the
account), each naming the operator alone, and returns "Ultra granted. The
account's seat has ended." Whenever the seats table is on the database the
grant's batch carries the seat's end, so a seat taken after the read also
ends with the grant. An account that holds no seat is granted as before, in
one post; a database without the table sends the grant's batch as before.

### Operator step

After this lands, from `site/`:

```
npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
```

The new statements are `CREATE TABLE IF NOT EXISTS seats`, `CREATE UNIQUE
INDEX IF NOT EXISTS idx_seats_member_live`, `CREATE INDEX IF NOT EXISTS
idx_seats_holder` and `CREATE INDEX IF NOT EXISTS idx_seats_email`; every
other statement is `IF NOT EXISTS` and changes nothing. Nothing on the site
changes when it is run.

## Dashboard

`/account/dashboard` is Ultra's: up to 5 dashboards an account keeps, each
a grid of up to 24 tiles it chooses from what the site already shows it,
each tile at its own place and size. The figures are the `dashboards` and
`dashboard_tiles` features of `RULES` (0 and 0 on Free and Pro, 5 and 24 on
Ultra; `DASHBOARDS_MAX` and `TILES_MAX` in `dashboard_rule.ts` are the
ceilings whatever the plan, `boardCap(plan)` and `tileCap(plan)` a plan's
own). Every line that names them reads `RULES`: Ultra's plan row, "5
dashboards of 24 tiles each" ("5 tableaux de bord de 24 tuiles chacun";
`dashboardsWording` in `site/src/pro.tsx` picks the singular forms a
figure of 1 would need), the Pro page's Ultra section, the landing page's
Ultra card, the Ultra message and the page a Free or Pro reader gets here.
The code is `site/src/account/dashboard.tsx` (the tables, the tiles, the
dashboards, the page, its posts and its read), `site/public/dash-grid.js`
(the grid's rules, shared by the Worker and the page's script),
`dashboard_fit.ts` (what a tile shows at its size),
`site/public/dashboard.js` (the page's script), `dashboard_rule.ts` (who
has it, the ceilings, a dashboard's address and the rail's item),
`dashboard_add.tsx` (Add to dashboard, and the dashboards' names),
`dashboard_doors.tsx` (the find page, a subject's checklist of tables and
the starters, *Finding a subject and choosing its tables*) and
`dashboard_strings.ts`; the rail item is in `site/src/layout.tsx`. An
analytics table on a tile is drawn by the analytics view's own code in
`site/src/pages/analytics.tsx` (*Analytics tables*). The tests are
`site/test/dash-grid.test.ts` (the grid), `site/test/dashboard.test.ts`
(the page, the three states of storage, the posts, several dashboards, a
dashboard of 24 tiles, the analytics tables and the analytics pages' own
Add to dashboard, the text tile), `site/test/dashboard-aid.test.ts` (More
Kinds of Tile), `site/test/dashboard-doors.test.ts` (the find page, the
checklist and its post, a saved view's link, the starters),
`site/test/builder-tiles.test.ts` (the analytics builder's two kinds, *Views
of the analytics builder*) and a 12-tile, a 24-tile, a 24-analytics-table, a
24-builder-view and a checklist entry in `site/test/cpu-budget.test.ts`.

### Several dashboards

- **Addresses**: the first dashboard is at `/account/dashboard`, which
  always shows whichever is first; every dashboard is also at
  `/account/dashboard/<id>` (its row's id, 32 hexadecimal characters). A
  reload, a link and the language switch (the page's own address with
  `lang` changed) keep the reader on it. An id the account does not hold
  (deleted, another account's, or any while the tables are absent) answers
  303 to `/account/dashboard`; anything else under the address is the
  site's 404. Signed out, the sign-in page returns to the address asked.
- **Tabs**: a row in the page's head under its lead, one tab a dashboard
  in the account's order (`pos`), the one shown marked (`aria-current`),
  each link the dashboard's address (the first's the bare one). The row wraps, so it
  never widens the page. Beside it: New dashboard while the account holds
  fewer than its figure, and Rename, Order or Delete for the dashboard
  shown, a `details` element that opens without the script.
- **Names**: a typed name, plain text, control characters dropped, 40
  characters at most (`BOARD_NAME_MAX`); left empty, the site's label,
  "Dashboard 2" ("Tableau de bord 2"), numbered in the order the account
  made its dashboards, so moving a tab never changes it. Stored as typed;
  `''` for the label, which follows the page's language.
- **New dashboard** is a post: the new one goes after the others, empty,
  and the page lands on it with Add a Tile open. The plan's figure is held
  inside the insert (`NEW_BOARD_SQL`); past it the page says the account
  holds its 5 dashboards.
- **Order**: Move earlier and Move later, posts, offered disabled at either
  end; the whole order is written again (`pos` 0 to n-1). A dashboard moved
  to the front is then at the bare address.
- **Delete**: inside Rename, Order or Delete, a second `details` element
  asks "Delete the dashboard Suppliers and its 5 tiles?" with its own
  button (the post must carry `confirm=yes`); never a browser dialog. The
  dashboard and its tiles go in one batch (`DELETE_BOARD_SQL`); the
  account's last dashboard is kept, its tiles removed and its name back to
  the label, an emptied first dashboard as removing its last tile leaves.
- **Tiles are a dashboard's own**: the figure of 24, the 2 briefings and
  the same item once are each a dashboard's, held inside the insert
  (`ADD_TILE_SQL`, its `?12` the dashboard, null for the first), so an item
  may sit on two dashboards, once on each.
- **Move to**: with other dashboards stored, a tile's menu lists them by
  name under "Move to", each a post (`POST
  /account/dashboard/tiles/:id/board`, `board`). The tile keeps its size and
  lands at the foot of that dashboard at the left (`place`, as an add), held
  inside the update (`MOVE_TO_SQL`) to that dashboard's figure, its
  briefings and the same item once; a dashboard at its figure is offered
  disabled. The dashboard it left closes up, and the reader stays there,
  told where it went (`?m=moved&to=<id>`).
- **Add to dashboard** on the other pages (each saved search a tile can
  show, each briefing, each saved view, each panel of an analytics view):
  one dashboard (or none stored yet), the one button, and the tile goes on
  the first; several, the same words open on the dashboards' names, each a
  submit button of one form naming its dashboard (`boardChoices`, one
  statement on those pages for an Ultra account). No filled button is
  added to those pages.

### The grid

From 1,100 px of window the page is a grid of 12 columns, rows of 40 px
and gaps of 12 px. A tile is `{id, x, y, w, h}`: `x` and `w` in columns
(`w` from 3 to 12), `y` and `h` in rows (`h` from 2 to 16), and never less
than its kind's least size (`LEAST` in `dash-grid.js`; it holds three of
the kind's rows). Tiles never overlap. The rules, in `dash-grid.js` and
nowhere else:

- **Compaction**: every tile slides up into the free rows above it, in
  reading order (top, then left), as far as the tiles above it in its
  columns allow; a tile never passes another on the way up. A layout
  compacted once comes back unchanged.
- **A move**: the tile goes to the column and row it was dropped on, held
  to the grid. Going up (or along its row), it goes above a tile it meets
  once its top reaches that tile's middle, and the tile is pushed down;
  going down, it goes under a tile once its bottom passes that tile's
  middle. Which tiles it passes is decided once, from where it was dropped;
  every tile it then meets is pushed under it, the lowest first, and pushes
  on what it meets in turn. Dropping a tile exactly where another of its
  height was swaps the two, either way. Then the layout is compacted.
- **A resize**: the tile keeps its column (it moves left when the new width
  would pass the edge), what it then meets is pushed under it, and the
  layout is compacted.
- **A step** (a tile's menu, the arrow keys): a column left or right; up or
  down to the next place where the layout changes, since one row is often
  not enough to pass a tile; a column wider or narrower; a row taller or
  shorter. A step that changes nothing is offered disabled in the menu.
- **Several added at once** (a checklist's tables, a starter): under the
  others in their order, side by side from the left while the row has room
  for the next, then compacted (`placeAll`); of several, one left alone in
  its row (beside a wider one, or the last of an odd count) takes the whole
  row, so no row of them leaves its right part empty. One tile alone goes
  where `place` puts it, as an add.
- **Clamping**: any layout read or posted is first held to whole numbers,
  the columns and the least sizes (`normalize`). The Worker never trusts a
  stored place: a page view, a fragment and every post lay the layout out
  again by these rules.
- A tile narrower than 6 columns (narrower than its table at 1,280 px)
  needs more height for its three rows, so its least height is taller
  (`hn` in `LEAST`). An analytics table's wider tables stack below 7
  columns, so its shapes' `hn` holds below 7 (`nb` in `LEAST`).

The least and starting sizes, by size key (an analytics table's shape:
one chart or ranked bars over its table, two charts over it, a chart an
organization over it (the share table), or the table alone; three blocks
of the organization hold taller rows; a text tile's one-line heading or
its note):

| Size key | Least w | Least h (6 columns and up; 7 for an analytics table) | Least h (narrower) | Starts at h |
|---|---|---|---|---|
| `tenders` | 4 | 7 | 10 | 10 |
| `radar` | 4 | 8 | 10 | 11 |
| `records` | 4 | 6 | 9 | 9 |
| `watches` | 3 | 8 | 10 | 11 |
| `analytic:chart` | 4 | 10 | 14 | 14 |
| `analytic:two` | 7 | 12 | (none narrower) | 12 |
| `analytic:share` | 4 | 14 | 16 | 16 |
| `analytic:table` | 4 | 12 | 13 | 13 |
| `briefing` | 3 | 4 | 4 | 6 |
| `org` (years, segments, buyers) | 4 | 6 | 9 | 9 |
| `org:share` | 4 | 7 | 9 | 8 |
| `org:ending` | 4 | 8 | 10 | 11 |
| `org:instruments` | 4 | 7 | 8 | 10 |
| `matches` | 4 | 7 | 10 | 10 |
| `api` | 3 | 7 | 8 | 9 |
| `text` (a heading) | 3 | 2 | 2 | 2 |
| `text:note` | 3 | 3 | 3 | 4 |

A tile starts half the row wide (an add; never narrower than its least) or
as its panel was (the earlier page: full or half width), at its starting
height, which holds the five rows every list showed before tiles had sizes,
and for an analytics table three rows or more under its charts.
`site/test/dash-grid.test.ts` holds both tables to `dashboard_fit.ts`, an
analytics shape at every width for each of its tables.

Below 1,100 px the layout is derived, never stored: two columns from 700
px (a tile of 7 columns or more takes both, a smaller one takes one), one
column below 700 px, in reading order, each tile as tall as its content.
The handles rest there; the menu works at any width.

### What a tile shows at its size

`tileFit(kind, ref, w, h)` in `dashboard_fit.ts` turns a tile's size into
the rows its list shows (3 at the least, 25 at the most) and the width and
height of its chart, from the stylesheet's figures at a window of 1,280 px:
a head band of 41 px (53 with the item's line), a foot of 33, a table's
head row of 33, a row's 8 px of padding each side and 20 px a line (a
small line inside a cell takes the cell's 20 px line box), a main cell's
usual text wrapping at about 6.6 px a character, and a table stacked into
labelled rows when the tile is narrower than 440 px inside its border (the
stylesheet's container query, from 700 px). Each kind's lines, its blocks
beside the table and its usual text are a table there (`BODIES`, `BLOCKS`).
The figures err tall; in the page the script takes off any row that still
does not fit (`trim`) and the foot says how many show. Nothing scrolls
inside a tile.

| Kind | Rows | Statement's LIMIT |
|---|---|---|
| `tenders` | the soonest closing of the search's matches | none: `tenders/open.json`, cut to the rows |
| `radar` | the soonest ending | `RADAR_TOP_SQL`, `LIMIT ?13` bound to the rows (at most 25), through `rec_expiring_end`; a province search reads its page of 100 and shows the rows |
| `records`, `org` years | the sources, two fiscal years each | the counts statement (a row a source and year) |
| `watches` | the newest events of the week | `readEvents`, as before |
| `analytic`, `view` | the table's rows its height holds under its chart, the plot's height and width from the tile (`analyticFit`), the axis's labels thinned to one in about 64 px | the view's own statements for the table (*Analytics tables*) |
| `briefing` | the week's four counts | `readBriefing`, as before |
| `org` segments, buyers, instruments, share | the block's first rows | the block's statement (LIMIT 114, 100 and 10,000 as on the organization's page; the share's years) |
| `org` ending | the soonest ending | `RADAR_TOP_SQL` at the rows |
| `matches` | the closest matches, held to the plan's count | the claim, the profile entry, `tenders/open.json` |
| `api` | the live keys | the keys and `keyUsage` |

A list cut to its rows says in its foot how many it shows of how many
there are ("5 of 31"), beside Open; a list that shows all says its count as
before.

### The tables

| Table | Columns | Rule |
|---|---|---|
| `dashboards` | `id`, `user_id`, `name` (the reader's, 40 characters at most, or '' for the site's label), `pos` (the tabs' order), `created_at` | The first written with the account's first change unless one is there (`BOARD_INSERT_SQL`), the others by New dashboard within the plan's figure (`NEW_BOARD_SQL`); a row with no tile is a dashboard the reader emptied; index `idx_dashboards_user` (`user_id`, `pos`) |
| `dashboard_tiles` | `id`, `dashboard_id`, `user_id`, `kind`, `ref`, `opts` (the tile's own choices as JSON, 2,000 characters at most; a text tile's text, `{"text": ...}`, and '' for every other kind in this build), `x`, `y`, `w`, `h`, `created_at` | At most the plan's figure and at most 2 briefings a dashboard, the same item once on a dashboard, all held inside the insert (`ADD_TILE_SQL`) and inside a move to another dashboard (`MOVE_TO_SQL`), so two posts at once cannot pass any of them; indexes `idx_dashboard_tiles_user` (`user_id`, `kind`, `ref`) and `idx_dashboard_tiles_board` (`dashboard_id`), through which a page reads one dashboard's tiles |
| `dashboard_panels` | `id`, `user_id`, `kind`, `ref`, `pos`, `wide`, `created_at`; unique on (`user_id`, `kind`, `ref`) | The earlier page's table: read until the account's first change on the grid, written while the grid's tables are absent (`ADD_PANEL_SQL`), then read no more for that account |

`kind` is checked by the site (`PANEL_KINDS`), not by a CHECK, so a new
kind needs no rebuild: the analytics tables and the text tiles added no
table and no column. Every dashboard and tile goes with the account
(`deleteAccount`); a tile goes with its dashboard, and from every dashboard
with the saved search, briefing or view it shows when that is removed on
its page. No table or column was added for several dashboards: `name` and
`pos` were there from the grid.

### The three states of storage

Each state holds per dashboard; the page works in each, and nothing answers
500.

- **The grid's tables absent** (`accounts_schema.sql` not applied since the
  grid): one dashboard and no tabs, since nothing could keep a second; a
  dashboard's address goes to `/account/dashboard`, and New dashboard,
  Rename, Order, Delete and Move to answer the line below. The account's
  `dashboard_panels` rows, or the starting layout,
  laid out on the grid (`fromPanels`: a full-width panel takes the row,
  half-width ones go two to a row, each at its kind's starting height). The
  page arranges them, saves no place or size and says so ("Positions and
  sizes cannot be saved yet"); the script posts nothing, the menu's steps
  answer the same line, and the layout save answers `{"state":"unsaved"}`.
  Adding and removing go to `dashboard_panels` as before (an analytics
  table too, its ref in that table's `ref`); a text tile, whose text needs
  the tiles' `opts`, is not kept there: Add a Tile's Text group says so in
  place of its field, and a post answers `?m=text_unsaved`. Without that
  table too, nothing is kept and the page says the dashboard cannot be
  saved yet. Nothing answers 500.
- **The tables there, nothing stored for the account**: the same layout,
  computed and not stored, as the account's one dashboard, its one tab
  "Dashboard 1" with New dashboard beside it. Its first change of any kind
  (a drop, a menu step or size, an add, a removal, a new dashboard, a name;
  a deletion writes it with no tile) writes the whole layout in one batch
  (`writeFirst`: the dashboard's row, then each tile through
  `ADD_TILE_SQL`, a panel's id kept and a starter's given a new one), then
  applies the change. The script's save answers the starter's new ids
  (`renamed`), which the page takes on. Two first changes at once write one
  dashboard and each item once.
- **Dashboards stored**: each its tiles; `dashboard_panels` is read no more
  for that account, and goes with the account as before.

### The page

Each tile on the grid at its place and size: a head (the grip, the kind,
the item, the menu), a body, a foot (the source and period where the kind
has one, the rows shown of all there are, Open) and a corner. The menu is
a `details` element, so it opens without the script: Open, then Move left,
Move right, Move up, Move down, Wider, Narrower, Taller, Shorter (each a
post; a step that would change nothing is disabled), then Remove. There is
no edit mode: `?edit=1` shows the same page. The page's one filled button
is Add a Tile, at the head's right, a `details` too: the count of tiles,
then three groups. From Your Lists: the select of what the account holds
and is not on the dashboard shown yet (its choices as before) and Add.
Analytics: a search, one field ("Buyer, organization or segment") and a
flat Find, a GET to the find page for the dashboard shown, then the line
saying each table and chart of an analytics view has its own Add to
dashboard, with the link to Analytics (*Finding a subject and choosing its
tables*). Text: a field for a
heading or a note and Add (a plain button, so Add a Tile stays the one
filled one). Then More Kinds of Tile, less its analytics line, which the
Analytics group says. Each post names the dashboard shown. An emptied
dashboard draws it open, with Start From first (*Starter dashboards*). The
tabs sit in the head under the lead, so Add a
Tile's choices, which hang below the head's row, never cover them
(*Several dashboards*).

The script (`dashboard.js`, a module loaded on this page only):

- **Pointer** (from 1,100 px): drag a tile by its grip to move it, or by its
  corner to size it, with Pointer Events and the pointer captured
  (`touch-action: none` on the two handles only). While a tile moves, the
  place it will land is marked (the soft emerald with a dashed emerald
  edge) and the other tiles move to where they would go, sliding unless
  the reader prefers reduced motion. A tile dragged near the window's top or
  bottom scrolls the page.
- **Keys**: the grip and the corner are buttons. Enter or Space picks the
  tile up, the arrows move it a step (or size it: right wider, left
  narrower, down taller, up shorter), Enter drops it, Escape puts it back,
  and leaving the handle puts it back too. Each step is said in a polite
  live region ("column 3 of 12, row 9").
- **Touch**: the handles show always on a touch screen from 1,100 px;
  dragging works as with a mouse. Below 1,100 px the handles rest and the
  menu does the moving.
- **No script**: the menu's posts and Add a Tile work as forms; the handles
  are not drawn.
- **Saving**: each change is saved by itself 600 ms after the last
  (`POST /account/dashboard/layout?board=<id>`, the address the page's data
  gives the script, so a save goes to the dashboard shown even from a
  script cached before the tabs), one save at a time; the status line
  says "Saving the layout.", then "Saved." with Undo, or "The layout could
  not be saved." with Try again and Undo.
- **Undo**: the status line's link, or Ctrl+Z (Cmd+Z) outside a field: the
  layout before the last change, the last 20 of the visit, saved again.
- **A resize** reads that tile again at its new size
  (`GET /account/dashboard/tiles/:id?w=&h=`), parses the fragment and puts
  its body and foot in place of the tile's; nothing else reloads. The
  script writes nothing with `innerHTML`.
- A menu step done with the script is done in the page and saved, so it
  joins Undo; Remove and Open stay a post and a link.

### A page view

The account's rows are read at once by the readers the account pages use
(the account's dashboards, with each one's count of tiles, and the shown
one's tiles in one batch of two statements, as before the tabs; the panels,
the saved searches,
the briefings, the claim, the watches, the keys, the saved views). Every
tile's records statements go in one batch with the state row; when that
batch fails, each tile is read on its own, so one table the nightly has
not made yet leaves the other tiles. The watches and the briefings send
their own batches through their own readers (`readEvents`,
`readBriefing`), at once with the first. At most two static files are
parsed: `tenders/open.json` and, with an organization tile or matching
notices, the claimed organization's profile shard. More Kinds of Tile
reads nothing of its own. A Free or Pro reader reads no records. A tile's
fragment reads the same rows (the dashboard holding the tile) and that
tile's statements in their own batch.

A dashboard of 24 tiles still sends one records batch: the state row and
each tile's statements, every one bounded and read through an index. A
dashboard of 24 analytics tables (every table of a buyer's, an
organization's and a segment's view, and three again at another source or
period) sends 49: the state row and each table's statements with its
subject's name (*Analytics tables*); the CPU budget's entry for it
measured 13.33 and 13.57 (bound 41); beside it, the 24 tiles of every
other kind, their three views now drawn as tables, measured about 17
(bound 44). With
every kind that reads the records, that is 25 statements (two each for the
3-, 6- and 12-month lists and a saved search of contracts ending, the
organization's share and ending blocks, and a buyer's or an organization's
view; one each for a records search, a segment's view and the other
blocks); the watches and each briefing send their own batch, as on any
page, and the tender searches, matching notices and the API read no
records. `site/test/dashboard.test.ts` counts the batch and reads each
statement's query plan; when the batch fails each tile is read alone, so
one tile that cannot be read leaves the other 23. The CPU budget's 24-tile
entry measured 14.62 against the 12 tiles' 8.62 (bound 44).

### Routes

| Route | What it does |
|---|---|
| `GET /account/dashboard` | the first dashboard's tiles on the grid; `?edit=1` is the same page |
| `GET /account/dashboard/:id` | a dashboard by its id, the same page; an id the account does not hold, 303 to `/account/dashboard` |
| `POST /account/dashboard/panels` | add a tile: `kind` and `ref` from a page's Add to dashboard (an analytics table: `kind=analytic`, its ref), `panel` (`kind:ref`) from Add a Tile, or `kind=text` and `text` from Add a Tile's Text group, to the dashboard `board` names (none, the first); it goes under the others at the left, half the row wide (never narrower than its least), at its kind's starting height |
| `POST /account/dashboard/layout` | the script's save, for the dashboard `?board=` names (none, the first): `layout`, JSON `[{id, x, y, w, h}]` (8,000 characters and 50 tiles at most); only that dashboard's own ids count, a tile the post leaves out keeps its place, the whole goes through `normalize`; answers JSON `{state: "saved", tiles, renamed}`, `{state: "unsaved"}` while the tables are absent, 404 for a dashboard the account does not hold, 400 for anything that is not such a list |
| `POST /account/dashboard/boards` | New dashboard, within the plan's figure; lands on it |
| `POST /account/dashboard/boards/:id/rename` | `name`; `:id` a dashboard's id, or `first` for the computed first |
| `POST /account/dashboard/boards/:id/move` | `dir` earlier or later |
| `POST /account/dashboard/boards/:id/delete` | `confirm=yes`; the dashboard and its tiles, the last one emptied |
| `GET /account/dashboard/tiles/:id` | one tile's section at `?w=&h=` (held to the grid), or at its own size, read on the dashboard that holds it; the CSRF value in the `X-CSRF-Token` header; 403 without it, 404 for an id the account does not hold |
| `POST /account/dashboard/tiles/:id/move` | `dir` left, right, up or down |
| `POST /account/dashboard/tiles/:id/size` | `to` wider, narrower, taller or shorter |
| `POST /account/dashboard/tiles/:id/board` | `board`, another of the account's dashboards: Move to |
| `POST /account/dashboard/tiles/:id/delete` | remove it |
| `POST /account/dashboard/tiles/:id/text` | a text tile's `text`, cleaned as on its add; emptied, the tile stays and says it is empty; on any other kind, nothing |
| `POST /account/dashboard/panels/:id/move`, `/width`, `/delete` | the earlier page's posts, for a page loaded before the grid: up or down, full or half width, remove |
| `GET /account/dashboard/find` | the find page: `q` the words, `board` the dashboard (none, the first), `kind` buyer, organization or segment to list one kind, `all=1` a starter's |
| `GET /account/dashboard/tables/:base/:id` | a subject's checklist (`:base` buyers, organizations or segments): `source`, the period (`years`, or `from` and `to`; `period=latest` or `span` from its own form), an organization's `segment` and `vs`, `board`, `all=1` |
| `POST /account/dashboard/tables/:base/:id` | the checklist's Add to dashboard: `table` once a table checked, the source and period, the share table's `segment` and `vs`, `board` |
| `POST /account/dashboard/starter` | `starter` org or ending, `board`: an empty dashboard filled in one post |

Every post is behind the session, the CSRF value and the Origin; the read
is behind the session and the CSRF value in its header. All of them count
in the dashboard's own bucket with the saved views' posts (`EDIT_LIMIT`, 60
a minute per address; `bucketFor` "edit"), so arranging never spends the
forms' 5. A post from the menu returns to the dashboard it changed (the
bare address while that is the first) with what happened (`?m=added`,
`exists`, `full`, `briefings_full`, `unsaved`, `unsaved_layout`,
`boards_full`, `renamed`, `board_deleted`, `board_emptied`, `text_empty`,
`text_unsaved`, `started_taken`; `tables` with its counts `n`, `of`,
`there` and `full`; `started` with `n`; and `moved`,
`move_exists`, `move_full` with `to=<id>` naming the dashboard), at the
place the change was made: a step or a size at
the tile's own anchor (`#tile-<id>`), an add at the tile added (or found
added), a removal at the tile that takes its place in reading order, else
the one before it, else Add a Tile (`#dash-add`). The page, the posts and
the read are `private, no-store`, the find page and the checklist too; those
two reads count in the "edit" bucket as the tile's read does
(`DASHBOARD_READS` in `limits.ts`), and the checklist's and the starters'
posts with the others.

### The starting layout

An Ultra account with nothing stored sees the starting layout, computed and
not stored: the watches, the 3-month list, matching notices and the
organization's years block when it has claimed one, its first two saved
tender searches, and the API tile when it holds a live key, each the whole
row wide at its starting height. Its first change writes it as the
account's tiles (*The three states of storage*). A removal that leaves no
tile keeps the dashboard's row, so the emptied dashboard stays empty and
offers Add a Tile, open. Before the grid's tables exist, an emptied layout
is marked in `dashboard_panels` by a row of the kind `layout`
(`LAYOUT_MARKER`; ref `''`, place -1) as before: no page shows it, no post
can name it, and no count takes it.

### More kinds of tile

More Kinds of Tile (`Autres genres de tuiles`) is a short muted list of the
kinds of tile the account cannot add yet, each with the one step that gives
the account what the tile shows and a plain link to the page where that is
done (`moreKinds`). It is built from the rows the page reads already and adds
no statement and no file to a page view: `site/test/dashboard-aid.test.ts`
counts both on the starting layout and an emptied dashboard against the
figures measured before the list (with the grid's one batch of two
statements added).

| Line | Links to | Leaves the list once the account holds |
|---|---|---|
| A tender search's open notices | `/tenders` | a saved search of kind tenders |
| A filtered list of contracts ending | `/expiring/12m` | a saved search of kind expiring; the 3, 6 and 12-month windows need nothing, and Add a Tile always offers them |
| An organization's, a buyer's or a segment's records | `/account/searches`, where Add a Search takes the page's address | a saved search of kind organization, buyer or segment |
| A table or chart of an analytics view | `/analytics`; each panel of a view has Add to dashboard | a saved view, or a view's or an analytics table's tile on the dashboard; inside Add a Tile the line is left out, its Analytics group saying it |
| A weekly briefing, this week so far | `/segments`; a segment's or a buyer's page has Save this briefing | a briefing; the line waits for the `briefings` table |
| Your organization's figures and matching notices | `/account/organization` | a claim; the line waits for the `org_claims` table |
| API requests today | `/account/keys` | a key not revoked; the line shows only on a plan with the keyed API (`api`) |

The watches and the plain windows of contracts ending never appear, since
those tiles need nothing. With no line left the list is not drawn. It shows
inside Add a Tile, and also under the starting layout's tiles, so a first
visit finds it. It is left out while the dashboard holds its plan's figure
of tiles and while nothing can be kept (neither the grid's tables nor the
panels' table).

### Finding a subject and choosing its tables

Add a Tile's Analytics door: any buyer, organization or segment, found from
the dashboard, its tables added from a checklist without leaving it. Built
in `dashboard_doors.tsx`.

- **The find page** (`/account/dashboard/find?q=`) lists a few matches of
  each kind (6; 20 when `kind` asks for one kind), each leading to its
  checklist at the source the subject's analytics page opens on (the one
  with the most records) and the default period, 10 fiscal years, for the
  dashboard the search came from (`board`). Buyers and organizations are
  read by the site's own search (`search_db.ts` `runSearch`, the hosted
  search database's one batch of `/search`'s first page: both counts, the
  organizations and the buyers), so they come in `/search`'s order and the
  page names no one `/search` does not name, a supplier withheld as a
  person included (the search database never holds one). The segments are
  the site's list of 57, matched in the code by the search's own rule (each
  word in the code and title or the short name, in either language, the last
  as a prefix); `kind=segment` with no word lists all 57. A kind with more
  matches says "6 of 31" and links the rest (`/search` for buyers and
  organizations, the segments alone here). With no word the page says what
  it searches; with no match, that nothing matches; with the search database
  unavailable, that it cannot be read, and the segments still show. Its
  Find is the page's one filled button.
- **The checklist** (`/account/dashboard/tables/<base>/<id>`): the
  subject's name, then a GET with a flat Show: the dashboard (when the
  account holds several), the source (the four, or a segment's two) and the
  period, the latest 3, 5, 10 or 20 fiscal years or chosen first and last
  years (every one from 2000-01), read as the view reads its own address
  for the plan (`viewFrame`: held to the plan's years, a value it cannot
  use read as the default). Then the subject's tables as boxes, by their
  titles (`TABLE_TITLES`), in the view's order. A table that does not apply
  at the source (`tableApplies` in `pages/analytics.tsx`, held by a test to
  the panels that offer their own Add to dashboard) is offered disabled
  with the analytics page's own line why; the share table also needs a
  segment, chosen in a select of the organization's largest at that source
  and period, and says so when it has none. A table the dashboard holds
  already (the same ref) says "On this dashboard already". With `all=1` (a
  starter) every other table that applies is checked. It reads one records
  batch: the buyer's or the organization's name by its key and, for an
  organization at a source with segments, its largest segments
  (`ORG_SEGMENTS_SQL`, the view's own); a segment's reads none. Its Add to
  dashboard is the page's one filled button, offered disabled on a
  dashboard at its figure.
- **Its post** adds every table checked as an `analytic` tile. Each is
  checked as Add to dashboard's ref is (`analyticRef`) and must apply at the
  source; a table its view does not draw, one that does not apply, a share
  table without its segment or a period the check refuses answers 400 and
  adds nothing. Stored in the ref's one form (`analyticAddress`), in the
  checklist's order, the same item once; the ones there already are
  counted, and of the rest as many as the dashboard's figure leaves room
  for go in one batch, each insert holding the figure and the same item
  once (`ADD_TILE_SQL`), laid out under the others (`placeAll`). The
  dashboard then says how many of how many were added and why the rest
  were not: "2 of 5 tables added. 1 was on this dashboard already. 2 did not
  fit: the dashboard holds its 24 tiles." (`?m=tables&n=&of=&there=&full=`),
  at the first tile added. With nothing checked it returns to the checklist,
  which says to check one. In each state of storage as an add: into the
  panels while the grid's tables are absent (half the row each), the
  computed first written first (`writeFirst`), nothing kept without either.
  A dashboard the account does not hold, another account's included, is
  refused: the first, with nothing added.
- **From a saved view**: on `/account/views`, each row keeps its one-press
  Add to dashboard and, for an account that holds the dashboard, gains a
  plain link, "Choose its tables", to the checklist at the view's subject,
  source, period and choices. Every other reader's page is as it was.

### Starter dashboards

A dashboard with no tile (one emptied, or a new one) opens Add a Tile with
Start From first, four quiet choices: Your organization (its matching
notices and its 6 blocks, in one post; without a claim, a link to the page
where one is named), A buyer and A segment (the find page of that kind with
`all=1`, whose checklist opens with every table that applies checked), and
Contracts ending (the watches and each window of contracts ending the plan
gives, 3, 6 and 12 months on Ultra, in one post). A starter adds only kinds
the account can hold, within the figure, two to a row (`placeAll`), and
never touches a dashboard that holds a tile: the post is refused there
(`?m=started_taken`), and each insert holds the dashboard empty but for its
own batch (`STARTER_TILE_SQL`; `STARTER_PANEL_SQL` while the grid's tables
are absent). The account's first dashboard, computed while nothing is
stored, keeps its starting layout (*The starting layout*): it holds tiles,
so no starter shows there.

### What each reader sees

- **Ultra**, whether or not Ultra is on sale (a grant by hand included): the
  tabs, the tiles, Add a Tile, More Kinds of Tile while a kind needs a step
  first, and Add to dashboard in each panel of an analytics view (with the
  panel's anchor), on each saved search a tile can show, on each briefing
  of the searches page and on each row of the saved views page, with that
  row's Choose its tables; the find page, the checklists and Start From.
- **Free and Pro while Ultra is on sale**: the head, What the Dashboard Holds
  ("Pages of tiles you choose from what the site already shows you: 5
  dashboards of 24 tiles each.", Ultra's figures from `RULES`; then the
  kinds, one sentence each (`TEASE_KINDS`: an analytics table, drawn in
  full, in place of a view's first chart, and a heading or a note; the lists
  say they show as many rows as a tile's size holds), the gate line with
  Plans and prices, and the three
  plan cards, Ultra's link the page's filled button. No records read, no
  script. The same at any dashboard's address, the find page's and a
  checklist's; their posts go to the dashboard's address and write nothing.
- **Free and Pro while Ultra is off sale**: the site's 404, as before Ultra.
- **Signed out**: the sign-in page with `next=/account/dashboard` while
  Ultra is on sale; the site's 404 while it is not.
- **The rail**: Dashboard, with the Ultra chip, first in Your lists, while
  Ultra is on sale or the account holds it, for every reader the rail shows
  an account to; never with the accounts switch off.
- **The plan cards**: Ultra's card has a row of its own, "5 dashboards of 24
  tiles each" ("5 tableaux de bord de 24 tuiles chacun"); Free's and Pro's
  show it in the hollow ring, muted. Only beside Ultra's card: the two cards
  drawn while Ultra is off sale keep their rows. The privacy page (while
  Ultra is on sale) says a dashboard keeps its name, its place among the
  account's dashboards, its tiles, their places and sizes, their own
  choices and the text of a note the reader types, all deleted with the
  account.

### Analytics tables

An analytics table (kind `analytic`) is one table of a buyer's, an
organization's or a segment's analytics view (`VIEW_TABLES`: 8, 6 and 7 of
them) as a tile of its own, for its subject at a source and a period, drawn
in full: the panel's chart or charts and its table, as the view draws them.

- **Its ref** is the view's address as a view's tile writes it (the path,
  then `source` and the period, `years` or `from` and `to`), then, for the
  share table alone, its `segment` and the organizations chosen (`vs`, in
  the view's order), then the table's anchor:
  `/buyers/pwgsc-tpsgc/analytics?source=awards&years=10#table-records`,
  `/organizations/org-a000000001/analytics?source=awards&years=10&segment=81#table-share`.
  `analyticRef` reads it through the checks a view's ref passes
  (`viewRef`) and refuses a table its view does not draw, and the share
  table without a segment; `analyticAddress` writes it in its one form. So
  the same table once on a dashboard (kind and ref), two tables of one view
  are two tiles, and the ref is the address its Open leads to. `opts` stays
  ''.
- **Its reads** are the statements the view reads the table with
  (`analyticQueries` over `buyerQueries`, `orgQueries`,
  `segmentQueries`), each bounded and indexed as on the view: a ranked
  table also reads the view's first table, whose value its shares are of,
  and the share table reads the segment's largest organizations with it.
  The buyer's or the organization's name is read by its key
  (`BUYER_NAME_SQL`, `ORG_NAME_SQL`); a segment's is its label. All of a
  page view's tables go in the page's one records batch.
- **Its drawing** is the view's (`analyticBody`, the same components the
  page draws with, given a `TileFit`): the rows the tile's height holds
  (newest years first, the largest first), every chart to the tile's width
  and height (`analyticFit`; the plots take the rows' room when the read
  has fewer rows than the tile holds, `analyticPlot`), no sorting in the
  tile, and none of the panel's forms (the share table's choice of segment
  and organizations stays on the page; the tile keeps the ones its ref
  names). What the view withholds stays withheld: a record whose supplier
  is not published reads "Not stated". In a tile narrower than 960 px the
  table's secondary columns rest as the page's do from 700 to 1,279 px
  (`.dash-rest`); narrower than the table itself, it stacks into labelled
  rows, every column a line as on a phone (`.dash-stack-540`,
  `.dash-stack-640`, by the table's least width), and ranked bars put each
  name on its own line. No table widens its tile.
- **Its head** is the panel's title with the subject's name; its foot the
  source and period (the contracts ending, which follow neither, their
  first day), the rows shown of all there are, and Open, which leads to the
  view at the table's anchor.
- **A view's tile from before** (kind `view`) draws, as it is stored, as
  its view's first table (a buyer's quarters, an organization's years, a
  segment's buyers and organizations), with the same head and foot; a saved
  view's tile keeps following its saved view and its name.
- **The analytics pages**: for an account that holds the dashboard, each
  panel's head carries the panel's own Add to dashboard beside its CSV
  link (link style; with several dashboards, their names under it) and the
  panel's heading its anchor (`table-<name>`); a panel whose table does not
  apply to the source (a segment's table on a source without segments, the
  competition of grants, the growth of a source that numbers no versions,
  the share table without a segment) offers none. The page head's own Add
  to dashboard is gone. Every other reader's analytics pages are byte for
  byte as they were (compared when the tables were built, on each view,
  signed out, Free and Pro, on and off sale, both languages);
  `site/test/dashboard.test.ts` holds Ultra's page to Pro's but for the
  controls, the anchors and Ultra's period, and finds neither on any other
  reader's.

### Text tiles

A text tile (kind `text`) is a heading or a note the reader types. Its ref
is an id of its own, so two notes can sit on one dashboard; its text is in
`opts` as `{"text": ...}`. The text is plain: line breaks kept (blank lines
past one in a row dropped), every other control character dropped, 500
characters at most (`NOTE_MAX`, counted in characters, never cutting one in
half), cleaned on its add, on its edit and again when read. It is drawn as
text, never as markup or a link, its line breaks kept. One short line (80
characters at most) is the tile's heading; anything else is a note under a
heading only assistive technology reads. An `opts` that does not parse
draws as an empty note, never a fault. The tile has no head band, no foot
and no Open; its menu leads with Edit, a `details` element with the text in
a field and Save (`POST /account/dashboard/tiles/:id/text`), never a
browser dialog, then the moves, Move to and Remove as any tile's. It is
added from Add a Tile's Text group; an add with no text adds nothing
(`?m=text_empty`). It is kept only with the grid's tables
(*The three states of storage*).

### Views of the analytics builder

Two kinds of tile show a view made in the analytics builder
(`site/src/account/build_views.tsx`; the builder is in `docs/analytics.md`,
The builder): `build`, the view's chart, sorted bars or figures over its
table, or its table alone, at the tile's size; and `number`, its latest
figure, with its change from the fiscal year before. Both, and everything
below, exist only while the builder's switch (`BUILDER`) is on and the
reader's plan holds the builder (Ultra): with it off, no page offers either
kind, no post of either is taken (400), the tease does not name them, every
page is byte for byte as it was, and a tile kept from before reads nothing
and says "This tile cannot be read right now."

- **Its ref** is the view's address in the builder's one form
  (`builder.ts buildAddress`, `/analytics/build?...`), at most 2,000
  characters (`OPTS_MAX`), so the same view is the same item once on a
  dashboard (a `build` and a `number` tile of one view are two items). A
  post (`POST /account/dashboard/panels`, `kind` and `ref`, the dashboard's
  own post, in its bucket) must give that form for a view the menus offer and
  a subject chosen in full (each buyer one the buyers' list holds), and a
  `number` tile a view that gives one figure a fiscal year (one subject, by
  fiscal year or for the period, never the contracts ending); anything else
  is 400. Read back, the address is read as the builder reads one and
  checked again: a combination no longer offered says why, a buyer the list
  no longer holds says that what the tile showed was removed. No schema
  change: `kind` has no CHECK.
- **Its reads** are the builder page's own statements (`builder_sql.ts
  buildPlan`; a figure's through `builder.ts figureChoice`, the view by
  fiscal year over its last year and the one before), with `cube_meta` first
  for a cube, in the page's one records batch: at most three statements a
  tile. The buyers' list (`buyers/index.json`) is read once for a page that
  holds such a tile. A cube missing or not filled yet leaves that tile
  unreadable and the others as they are.
- **What it shows**: headed by the view's title ("Value by fiscal year"; a
  figure by its figure, "Median value"), its subject the item, its source and
  period in the foot ("Contracts ending from" the date for the contracts
  ending), Open the view in the builder. A figure: the last fiscal year's,
  in the short form with the exact figure as its tip. When that year is the
  data date's ("2026-27 (to date)") it is never set against a whole year:
  under it the year before stands in full as a figure of its own ("2025-26,
  the full year: $53.5M"). When both years are whole, under it is its change
  from the year before with its sign (a value, an average or a median as a
  percentage; records and organizations as a count; a share in percentage
  points), or "No change from", or "No figure for ... to compare with". The
  words say how a figure moved and nothing of what that means.
- **Its chart's axis** rests its labels by the tile's own width at any
  layout (`site/src/chart.tsx tileLabels`, the container queries on
  `.dash-tile`), as an analytics table's does.
- **Its sizes** (`dash-grid.js LEAST` and `START_H`, `dashboard_fit.ts
  buildFit`): `build:chart` (a chart of one panel) 4 columns by 10 rows from 7
  columns, 13 narrower, starting at 13; `build:two` (two panels, the
  contracts ending's two charts among them) 4 by 12, 15 narrower, starting at
  15; `build:panels` (three to five: a comparison, the three largest shares)
  8 by 16; `build:ranked` 4 by 8, 13 narrower, starting at 13; `build:number`
  (the figures over the table) 4 by 9, 12 narrower, starting at 12;
  `build:table` 4 by 6, 10 narrower, starting at 10; `number` 3 by 5.
- **Add a Tile** gains a group between Analytics and Text, Build a View: Open
  the analytics builder, where a view's own Add to dashboard puts it, or its
  latest figure, on the dashboard the reader chooses. The From Your Lists
  select lists the account's saved views of the builder as Saved Builder
  Views, each a `build` tile.
- **The find page** gives each buyer, organization and segment it lists
  "Open in the builder" beside its checklist: its value by fiscal year over
  the latest ten fiscal years, at the source the checklist opens on. The
  builder's organization field links to the find page ("Find an organization
  by name").

`site/test/builder-tiles.test.ts` holds the switch (off, absent and another
value byte for byte, nothing read), the posts' checks, the one records batch,
the figures worked out from the rows, the tiles that cannot be read, the
fragment, the third door, the builder page's controls, the saved view and its
email, the find page and both languages; `site/test/cpu-budget.test.ts` a
dashboard of 24 builder views (`DASHBOARD_BUILD_BOUND`).

### Operator step

Apply the schema, as for every earlier table (it adds `dashboards`,
`dashboard_tiles` and their three indexes, and changes nothing else; every
statement only creates what is missing). Several dashboards needed nothing
more: the same file, the same command.

```
cd site
npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
```

Until then an Ultra account sees its panels (or the starting layout) on the
grid as one dashboard with no tabs, can arrange them on the page, and is
told that positions and sizes cannot be saved yet; adding and removing
tiles keep working in `dashboard_panels`. Nothing needs moving by hand afterwards: each account's
panels become its tiles at its first change.

### Known limits

- The rows a tile lists are reckoned for a window of 1,280 px. A wider
  window can leave room under a list; a narrower one (1,100 to 1,279 px)
  stacks more tables and the script takes off the rows that do not fit, so
  a reader without the script there may see the last row cut.
- The handles are not drawn below 1,100 px, where the layout is derived; a
  phone or a tablet moves and sizes tiles from the menu.
- A saved search's label is shown as it was saved, in the language of the
  page it was saved from; the searches page rebuilds it in the page's
  language.
- A view's period is checked against `PERIODS`; a period added there later is
  accepted with it.
- A dashboard left unnamed is numbered in the order the account made its
  dashboards, so its number can differ from its tab's place ("Dashboard 3"
  first, after a move or a deletion).
- After Move to the reader stays on the dashboard the tile left; the notice
  names the dashboard it went to, whose tab is beside.
- Room under a list: measured on the local Worker (2026-11-16) at 1,280 px,
  each tile's rows were within one of what its height holds, either way
  (with the script, a row too many is taken off and leaves its height
  under the last); at 1,600 px a tile reckoned for 1,280 px lists up to 5
  rows fewer than it holds, since its table no longer stacks. The server
  cannot know the window without a second read, so the room stays; sending
  a few rows past the reckoning, hidden, for the script to show where they
  fit, would remove it and touches every table's drawing (queued).

## Saved views

Each analytics view (a buyer's, an organization's, a segment's) can be saved
to the account with its source, its period and its choices (the share
chart's segment and the organizations compared), under a name the reader may
type. `/account/views` lists them; Ultra's can be sent by email, weekly or
monthly, while their figures change. The figures are the `saved_views`
feature of `RULES` (0 on Free, 10 on Pro, 50 on Ultra; `SAVED_VIEW_MAX` is
the ceiling whatever the plan) and `view_mail` (Ultra alone). The code is
`site/src/account/saved_views.ts` (the rows, the name, the merges),
`view_pages.tsx` (the control, the page, the index's panel, the stop pages),
`view_mail.ts` (the run), `digests.ts` `viewDigest` (the message) and
`views_strings.ts`; the address is read and written by
`site/src/view_address.ts`, the module the views themselves read their
address with. The tests are `site/test/saved-views.test.ts`, with the
message in `site/test-mail/`.

### The tables

| Table | Columns | Rule |
|---|---|---|
| `saved_views` | `id`, `user_id`, `kind` (`buyer`, `organization`, `segment`; `build`, a view of the analytics builder), `address` (at most 2,000 characters), `name` (at most 60), `lang`, `deliver` (`weekly`, `monthly`, `off`; always `off` for `build`), `created_at`, `last_delivered_at`, `last_hash`, `secret`; unique on (`user_id`, `address`) | At most the plan's figure per account, every kind counted together, held inside the insert (`ADD_VIEW_SQL`), so two posts at once cannot pass it; an address once |
| `view_deliveries` | `id`, `view_id`, `sent_at`, `day` (the data date), `status` (`sent`, `failed`, `same`) | One row per run of a view; kept 90 days (`VIEW_DELIVERY_DAYS`, swept by the run) and with the view |

`last_hash` is the SHA-256 of the figures the last message carried (the
source, the period, each year's records and value, the largest records by
reference and value: public figures only). `secret` is the stop link's 16
random bytes, made with the first message and kept in clear, as a
briefing's is. A view goes with the account (`deleteAccount`), and its
dashboard tiles go with it, from every dashboard.

### Saving a view

Save this view is the last row of each view's toolbar, for a signed-in
reader: a Name field (empty, it takes the site's label, "National Defence,
published contracts, 2016-17 to 2025-26", whose subject's name is cut on a
whole word with an ellipsis when the label would pass 100 characters,
`LABEL_MAX`, so the source and the period stay whole; at the 60 of a typed
name the label kept "Public Services and" of Public Services and Procurement
Canada) and the flat button. The post
carries the address the view wrote for itself (`viewQuery`: the source, the
period, then for an organization the share chart's segment and the
organizations compared). The route reads it as the view reads it
(`view_address.ts frameOf`, `rivalsOf`, `shareSegmentOf`) at the data date,
for the account's plan (a Pro account's period at most 10 fiscal years),
writes it again as the view writes it, and keeps it only when the two are the
same string (`readViewAddress`): another key, another order, a value the view
would read otherwise, the language or a second value of a key are refused
(400). A buyer or organization the data no longer holds is refused too. The
typed name has its control characters dropped and is cut to 60 characters
(`NAME_MAX`). Saved,
the row reads "Saved to your views."; at the plan's figure it says so; on
Free, Save this view leads to the saved views page, which names the plans
that keep views. The control is absent while the switch is off, for a reader
not signed in, and while `saved_views` is not on the database.

A view of the analytics builder (kind `build`, `site/src/account/build_views.tsx`)
is saved the same way from the builder's page, under its result, for an
Ultra reader while the builder's switch (`BUILDER`) is on: the post carries
the view's address in the builder's one form, which must come back the same
from the builder's own reading, for a view its menus offer and a subject
chosen in full, or it is refused (400); Pro, Free and every reader while the
switch is off are refused too. Left unnamed it takes the site's label: what
it is about and its title, then its source and period ("Public Services and
Procurement Canada: Value by fiscal year, PSPC contract history, ..."), cut
as an analytics view's is. It is kept by the same insert, counted with the
others against the plan's figure (and a group's, `ADD_VIEW_GROUP_SQL`). It is
never sent by email: its row has no select (it reads "Not sent by email."),
`POST /account/views/:id` leaves it off (`SET_DELIVERY_SQL` holds a `build`
view to `off` inside the statement), and the run never takes one up (its
address is no analytics view's, which the run reads every address as).

### The page

`/account/views` lists the views in the order they were saved, each with a
link that opens it as saved, the kind of view, Remove, and the count against
the plan's figure. While Ultra is on sale an Email column holds, for Ultra,
the select (Weekly, Monthly, Off) with the last run's line ("Sent ...",
"Checked ...: nothing changed, no message.", "Not sent ..."), and for Pro the
line "Off. Email delivery of saved views is part of Ultra." While Ultra is off
sale the column is not drawn. Free reads the gate line (Pro's figure, and
Ultra's while it is on sale) and the plan cards. After a move to a smaller
plan nothing is deleted: the views past the plan's figure are kept, listed and
marked, and the page says how many it holds against the figure. A buyer's or
an organization's view whose id the nightly merged into another is pointed at
the surviving id when the page is read, as a watch is; one that would then
repeat a view the account keeps is merged into it. The analytics index
(`/analytics`) lists the account's saved views in its Saved Views panel. The
page is the site's 404 until the schema holds `saved_views`. A view of the
builder is listed as "Analytics builder", its link opening it in the
builder, with Add to dashboard as a tile of its own (kind `build`) and no
Choose its tables; while the builder is not the reader's, it is named, not
linked, with no Add to dashboard, and stays counted and removable.

### The email

The run's fifth part (`view_mail.ts runViewMail`, after the weekly email,
inside the same `RUN_MESSAGES_MAX`; the weekly email stopping at its own
ceiling of 100 does not hold it, so it gets what the shared cap has left). It
reads and sends nothing while Ultra is not on sale, and reads nothing of the
records database while the tables are missing (the report says so). A view is
due:

- weekly: on the first run of its week, from the briefings' Monday
  (`weekAnchor`);
- monthly: on the first run on or after the first Monday of the month
  (`monthAnchor`);

while not covered since that day, its account active, not blocked and on a
plan with `view_mail`, the view one of the first by creation date within the
plan's figure, and no message refused for it since that day. Its figures are
one records batch of two statements: the view's first chart
(`BUYER_QUARTERS_SQL` added up by fiscal year, `ORG_YEARS_SQL` or
`SEGMENT_YEARS_SQL`) and its largest records of the period's last fiscal year
(`BUYER_RECORDS_SQL`, `ORG_RECORDS_SQL` or `SEGMENT_RECORDS_SQL`, of which the
message lists 5). Two views of one address read once. When the figures hash
as the last message's did, the run writes `same` and sends nothing. Until the
records database is ready at today's data date, every view waits unclaimed.
A view is claimed for its period before its message goes and given back when
the send does not go, as a briefing is. After a message went, its row and its
hash are written once more when the write fails, so an unchanged view does not
send again. A view read and passed over because its account's plan does not
send it (no `view_mail`, or past the plan's figure) is marked covered for its
period (`last_delivered_at`, no run row), so the views of accounts that moved
down do not fill the 1,000 the run reads ahead of the ones paid for; a plan
restored within the period sends from the next one. The list (`VIEWS_DUE_SQL`)
puts the views of accounts whose cached plan is paid first, as the watch
mail's does; the cache holds Ultra as pro, so it orders Free last and cannot
tell Ultra from Pro, and `planFor` still decides each view.

The message: the view's name, its source and period, the figures by fiscal
year (records and counted value, newest first), the five largest records of
the last fiscal year, the button Open the view, the first table as a CSV file
(for a signed-in reader), why it came, the saved views page and the stop link,
with `List-Unsubscribe` and its one-click partner.

More than five of an account's views with new figures in one run (`GROUP_OVER`,
the saved searches' figure) go in one message, as its saved searches and
briefings do. An account with more than five views due in the run's list is
read whole where its first one stands; the plan's figure and a seat's
allowance come first, then the views that are unchanged (`same`) or at an
address no view reads drop out, and the rest are counted: more than five go as
one message (`digests.ts` `viewGroupDigest`), weekly and monthly together,
five or fewer one message each, exactly as before. The grouped message is in
the account's mail language (`users.lang`), the views named as the reader
saved them; a section a view in the account's order, with its source and
period linking the view, its newest fiscal year's figures, its largest records
of the period's last fiscal year (the other party in the message's language;
a supplier the records do not name stays unnamed), and its own stop link
(`?v=`). The whole message lists at most 30 records and a section 5
(`GROUP_ROWS_MAX`, `GROUP_SECTION_ROWS`), each view past them one line with
its newest year's figures and its link; then the button to the saved views
page, the reason line, and one stop link for the whole message (`?gv=`) in its
footer and in `List-Unsubscribe`. It counts once against the run's cap, the
day's ceiling and the run log; each view keeps its own claim, its own `sent`
row and its own hash (written in one batch after the send, tried once more on
a fault), and a send that does not go gives every claim back, with each one's
`failed` row when the refusal is not a sending limit.

### Routes

| Route | What it does |
|---|---|
| `GET /account/views` | the page |
| `POST /account/views` | save a view: `address` and `name` (an analytics view's, or a builder view's while the builder is the reader's) |
| `POST /account/views/:id` | its email: `deliver` weekly, monthly or off; on only for Ultra while Ultra is on sale, and never for a builder's view |
| `POST /account/views/:id/delete` | remove it, and its tiles on every dashboard |
| `GET`, `POST /account/stop?v=&t=` | the view's stop page, and turning its email off (one-click too) |

Every post is behind the session, the CSRF value and the Origin, in the
dashboard's bucket (`EDIT_LIMIT`, 60 a minute per address). The audit records `view_saved` (the kind),
`view_changed` (the cadence), `view_removed` and `view_stopped`, never the
address or the name.

### Operator step

Apply the two tables and their indexes. The whole file does it, as for every
earlier table:

```
cd site
npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
```

but the whole file also makes `entitlement_tiers` on a database that does not
hold it yet, and with Ultra's five variables set in `wrangler.jsonc` that
table is the last condition of `ultraOnSale` (*Ultra*, On sale): Ultra goes on
sale with it. To add the saved views alone while Ultra stays off sale, run
only the statements of `accounts_schema.sql` that name `saved_views` and
`view_deliveries` (two `CREATE TABLE` and four `CREATE INDEX`), from a file
kept outside the repository, with the same command and that file.

Until then nothing offers to save a view, `/account/views` is the site's 404,
the analytics index has no Saved Views panel, and the run's fifth part says
the table is missing (while Ultra is on sale).

### Known limits

- A view saved as its latest years moves with the data date; a view saved by
  its first and last fiscal year stays on them.
- The name is typed once, when the view is saved; the page offers no rename.
- An organization's view saved without the share chart's segment opens on its
  largest segment, as the view does; the saved address keeps no segment.

## Operator console

`/admin` is where the operator looks an account up and acts on it. The
code is `site/src/account/admin.tsx` (the routes and pages),
`admin_ops.ts` (the database side), `admin_stripe.ts` (the Stripe calls)
and `admin_access.ts` (the Cloudflare Access check); the tests are
`site/test/accounts-admin.test.ts`.

### Who gets in

Every address under `/admin` answers the site's own 404, the page any
unknown address gets, unless all of these hold:

1. The accounts switch is on.
2. The secret `OPERATOR_EMAILS` names at least one address.
3. A session stands for one of those addresses, read from the database on
   the request. A session remembered through a database outage does not
   count.
4. Once `ACCESS_AUD` is set: the request carries a Cloudflare Access token
   in the `Cf-Access-Jwt-Assertion` header that verifies, and its `email`
   claim is the session's address.

The token is checked in the Worker, with no library: its RS256 signature
against the team's keys from
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, `iss` equal to
that address without the path, `aud` holding `ACCESS_AUD`, and `exp` ahead
of the clock. The keys are fetched at most once an hour, and again at most
once a minute when a token names a key the cached set lacks. A missing
token, one that fails any check, and a key set that cannot be fetched all
get the 404.

While `ACCESS_AUD` is unset the session alone admits. That is for the
first days only, before Access is set up: until then a stolen session
cookie of an operator address opens the console.

### The secrets

```
cd site
npx wrangler secret put OPERATOR_EMAILS
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
```

- `OPERATOR_EMAILS`: the addresses, comma-separated, read lower-cased.
  Each signs in at `/account/sign-in` like any reader before the console
  opens for it. All three are secrets and never variables in
  `wrangler.jsonc`, because the repository is public and the addresses
  must not appear in it. Deleting `OPERATOR_EMAILS` closes the console at
  once.
- `ACCESS_TEAM_DOMAIN`: the team's domain, `<team>.cloudflareaccess.com`
  (the bare team name works too). Any other host is refused, so a wrong
  value closes the console rather than fetching keys from elsewhere.
- `ACCESS_AUD`: the Access application's AUD tag.

### Setting up Access

1. In the dashboard: Zero Trust, Access controls, Applications, Create new
   application, Self-hosted and private.
2. Add public hostnames for the domain `awardwatch.ca` with the path
   `admin`, and again with the path `admin/*` (a wildcard path does not
   cover its parent). The site also answers on `www.awardwatch.ca`; add
   the same two paths for it, or leave it out, in which case the console
   there answers 404 once `ACCESS_AUD` is set, since such a request
   carries no token.
3. A policy: action Allow, include Emails, the operator's addresses (the
   same as `OPERATOR_EMAILS`).
4. Login methods: One-time PIN, which mails a code to the address typed.
5. Save. Under the application's Edit, Additional settings, copy the
   Application Audience (AUD) Tag into `ACCESS_AUD`, and put the team
   domain into `ACCESS_TEAM_DOMAIN`. Set `ACCESS_TEAM_DOMAIN` first: with
   `ACCESS_AUD` set and the team missing, every request gets the 404.
6. Open `/admin`. Access asks for the address and its PIN; then the site
   needs its own session for the same address.

### What each action does

Every action is a POST, with the session's CSRF value and an `Origin`
header naming the site (a post without one is refused here, unlike on the
account pages). The buttons are on the account's page, `/admin/users/<id>`.
The five marked "confirm" lead first to a page that says what will happen,
and act only on the post from that page, its box ticked; a post without
the box changes nothing. Each writes an audit row
whose event starts `operator_` and whose detail is `by <operator's user
id>`, never an address. The console refuses to block, re-address or
delete the operator's own account.

| Action | Effect |
|---|---|
| Grant Pro by hand (or Ultra) | A `manual` entitlement row from now to the start of the end date given (UTC), or with no end. The reference is required: at most 120 characters, and any value holding `@` is refused, since a reference never holds an address. The same row as the insert under *Granting a plan by hand*. The Plan select offers Pro (the default) and Ultra; an Ultra grant writes the row and its `entitlement_tiers` row in one batch, whether or not Ultra is on sale, and on a database without that table writes nothing and says to apply `accounts_schema.sql` (*Ultra*). For an account that holds a seat, the grant first shows a page that names the seat's holder and says the grant ends the seat (*Seats*, *The console*). |
| Revoke | Sets `revoked_at` on one row not yet revoked or ended. Revoking a Stripe row leaves the subscription billing, and its next paid invoice grants Pro again: cancel the subscription as well. |
| Cancel the subscription (confirm) | At the period end (`POST /v1/subscriptions/<id>` with `cancel_at_period_end=true`): Pro runs to the end of the period paid, then Stripe's `customer.subscription.deleted` notice ends it. At once (`DELETE /v1/subscriptions/<id>`): Stripe ends it now and the stored row reads `canceled`; the same notice ends Pro, usually within a minute. Neither refunds anything. |
| Refund the latest payment (confirm) | The page reads the latest paid invoices of the subscription (`GET /v1/invoices?subscription=<id>&status=paid&expand[]=data.payments`) and takes the newest that took money; its charge comes from the invoice's payments, or, for a payment through a PaymentIntent, from `GET /v1/charges?payment_intent=<id>`. It shows the invoice, the charge, the amount and what is refunded already. The post finds the charge again, refunds only if it is still the one shown, and calls `POST /v1/refunds` with `charge=<id>` and the header `Idempotency-Key: operator-refund-<charge id>`, so a second press or a retry within Stripe's 24 hours returns the first refund. Stripe's `charge.refunded` notice then ends the account's Stripe Pro (*What each notice does*). The subscription is not cancelled. |
| Block (confirm) / Lift the block | A row in `account_blocks` with the reason (required, at most 200 characters, no `@`). In one batch: every session revoked, and email delivery turned off on every saved search that had it, the list kept in the row. While it stands, a code or a link for the address gets the "expired" answer any stale code gets, the sign-in page itself answering as for any address; the account's API keys answer 401; the delivery job, which reads only searches whose delivery is on, sends nothing. Lifting the block deletes the row and turns delivery back on for the searches it turned off that are still off. Entitlements and the subscription are left alone. |
| Change the address (confirm) | The new address is normalized as sign-in does, at most 254 characters, and refused when any account holds it. The old address's open sign-in requests and wrong tries are deleted and every session is revoked. When mail can be sent (the `MAIL` binding and `MAIL_FROM`, or the log sender locally), the new address gets a message in the mail shell, in the account's language, saying the site's operator changed the account's address, with the sign-in page as its button and the contact address. The old address is not written to, and can sign up again as a new account. |
| Sign out everywhere | Every session of the account revoked. |
| Delete (confirm) | Exactly the reader's own deletion (*Deletion*): the subscription cancelled first or nothing deleted, then the rows deleted and the address hashed, then every session revoked. A block ends with it. |

### What the console shows

- `/admin`: active, deleted and blocked accounts; signed-in browsers; the
  accounts on Pro now and on Ultra now (once `entitlement_tiers` exists),
  each by the source of the row that decides their plan (by hand or
  through Stripe); subscriptions by their last notified
  status; deliveries sent and not sent in the last 7 days (the `deliveries`
  rows, one a saved search, a grouped message's searches each counted) and,
  once `delivery_runs` exists, the messages the delivery job and the
  console's bulk runs sent over the same days (the run log's `sent`, a
  grouped message once); bug reports in
  the last 7 days and in all, with the latest 10, once the `bug_reports`
  table exists; calendar feeds by kind and read in the last 7 days, once
  the `feeds` table exists; sign-in codes issued today (UTC); once the
  `seats` table exists, the seats' signals (*Seats*, *The console*); the last 20 audit
  events; and a search by user id or by address, exact or by its start.
- `/admin/accounts`: every account in one table, filtered, sorted and
  paged, with a CSV of the same view (*The accounts table*, below).
- `/admin/users/<id>`: the user row (address, created, last seen,
  language, status, cached plan, which holds Ultra as pro), the plan
  `planFor` computes, every entitlement row (its plan read through its
  tier, so an Ultra row reads `ultra`) with a revoke button on those not
  revoked or ended, the grant form with its Plan select, the
  `payment_customers` row and, with the Stripe keys set, the
  subscription's status, period end and pending cancellation as Stripe
  holds them now; the account's seats, when a seat row names it (*Seats*,
  *The console*); sessions (signed in now, the newest use, device
  classes); saved searches with their delivery and last delivery; API keys
  (prefix, created, last used, revoked); calendar feeds (kind, created,
  revoked, last read, never the secret); the last 20 deliveries; the
  account's bug reports; the last 50 audit rows; and whether it is
  blocked, since when, by whom and why.

The console never shows card data. The Stripe objects it reads are used
for ids, statuses, dates, an amount and its currency, shown once and not
kept; nothing from a charge's card or billing details is read into the
page.

A reader's own refund from the billing page (*Refund of the first
payment*) needs nothing from the operator when it goes through. It shows
on the account's page as audit rows: `refund_requested` with the
subscription's id, `refund_made` ("refund succeeded"), `plan_changed`
"stripe cancelled with the refund", then the webhook's "stripe ended,
refunded"; the stored row reads `canceled` and the plan Free. A press that
was refused shows `refund_refused` with its reason; a reader sent to the
contact address after one ("stripe refused", "stripe unreachable",
"figures", "not first") is refunded here with Refund the latest payment,
then cancelled with Cancel the subscription, At once. The one case that
needs a hand is a refund that went through while the subscription can
still bill: the daily check names the account and the subscription each
morning until Cancel the subscription, At once (or a cancellation in
Stripe's dashboard) clears it. The overview's last 20 audit events show the
same rows.

### The accounts table

`/admin/accounts`, linked from the overview, lists every account, 50 to a
page, newest sign-up first. Its columns: the address (linked to the
account's page), the plan now, the seat (once the `seats` table exists:
Gives seats, Holds a seat or None), status, blocked (with the block's date),
signed up, last sign-in, saved searches, saved searches with delivery on,
live API keys (not revoked), the subscription's status and the account's
language.

- The plan is the one the deciding entitlement row gives, as `planFor`
  picks it, with its end date when Pro. A deleted account reads as Free,
  as in the overview's counts of Pro.
- Last sign-in is the start of the account's newest session. Session rows
  go 90 days after they end, so an account that has not signed in since
  shows none.
- Subscription is `payment_customers.status` as Stripe last notified it,
  shown as stored; an account without the row shows none.

The query parameters. Each value is checked against its list, and any
other value, `any` included, sets no filter or falls back to the default
order; no parameter's text reaches the SQL.

| Parameter | Values |
|---|---|
| `q` | The start of an address, read lower-cased; `%` and `_` match only themselves. |
| `plan` | `free`, `pro` |
| `status` | `active`, `deleted` |
| `blocked` | `yes`, `no` |
| `delivery` | `on` (at least one saved search has delivery on), `off` |
| `subscription` | `active`, `trialing`, `past_due`, `unpaid`, `incomplete`, `incomplete_expired`, `canceled`, `paused`, `none` (no row or no status) |
| `language` | `en`, `fr`: the account's language. `lang` stays the page's own. |
| `seat` | `holder` (gives a live seat or an open invitation), `member` (holds a live seat; an account on both sides reads `member`), `none`. Only while the `seats` table is on the database; without it the parameter reads as unset and the column is not drawn. |
| `sort` | `address`, `plan`, `seat` (with the `seats` table), `status`, `blocked`, `created` (the default), `sign_in`, `searches`, `delivery`, `keys`, `subscription`, `language` |
| `dir` | `asc`, `desc`. Without it `created` sorts newest first and every other key ascending. |
| `page` | 1 to 200. A page past the last shows the last. |

Each column heading links to its sort with the filters kept, and the
current column's heading reverses it. Each sort key maps to an ORDER BY
written out in `admin_ops.ts`, and each filter is a bound parameter of one
fixed statement. Paging stops at page 200 (10,000 accounts), as on the
search page; filter to reach the rest.

`/admin/accounts.csv` takes the same parameters and returns the current
filters and order from the first row, whatever the page, at most 10,000
rows, `Cache-Control: no-store`, as the attachment `accounts-<date>.csv`.
Its header:

```
user_id,address,plan,plan_until,status,blocked,blocked_at,signed_up,last_sign_in,saved_searches,delivery_on,api_keys,subscription,language
```

Times are ISO in UTC, as stored. The user id stands in for the link each
address carries on the page. The file holds every address in the view:
keep it as the database itself would be kept. A cell starting with `=`,
`+`, `-` or `@` gets a leading `'`, so a spreadsheet reads it as text.

The default order reads the index `idx_users_created` on
`users(created_at, id)`, next to the `users` table in
`accounts_schema.sql`. Apply it on the account before deploying the
table (applying the whole schema again does the same, since every
statement in it is idempotent):

```
cd site
npx wrangler d1 execute awardwatch-accounts --remote --command="CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at, id)"
```

Until it is applied the table still works, sorting every account for
each page.

### Stripe key permissions

With the console, the restricted key of *Payments*, step 6, needs:
Subscriptions write (cancelling, already needed for deletion), Refunds
write, and Invoices and Charges read. The billing page's own refund
(*Refund of the first payment*) uses the same four, and so does the
webhook's refund of a payment that lands on a deleted account (*Deletion*:
Subscriptions write to cancel, Invoices read for the invoice, Charges read
for its charge, Refunds write). Without the Stripe
secrets the user page shows the stored row alone and offers no
cancellation or refund, and the billing page offers no refund either.

### The `account_blocks` table

One row per blocked account, deleted when the block is lifted or the
account is deleted: `user_id`, `reason` (the operator's note, never an
address), `created_at`, `by_user_id` (the operator's user id) and
`paused` (the searches whose delivery the block turned off). It is at
the end of `accounts_schema.sql`; apply the schema again before deploying
the console. Until it is applied no account can be blocked, and sign-in,
keys and the console read every account as not blocked.

### Known limits

- A sign-in already past its code check when a block is written can start
  a session just after the block revokes the account's sessions. The user
  page then shows a signed-in browser; Sign out everywhere ends it, and
  the next sign-in is refused.
- A blocked account still holding Pro is counted by the same-day refresh's
  gate (`LIVE_PRO_SQL`), as any live Pro row is.

## Watches

A watch follows one page: an organization, a buyer (optionally narrowed to one
UNSPSC segment), a single record (an award notice, a PSPC history record or a
published contract) or an open tender notice, and lists what happens to it.
Every signed-in account keeps watches: 3 on Free, 25 on Pro, 100 on Ultra (`watchlists`,
held to the cap inside the insert, as `addSearch` holds its own), plus the
organization watch on the organization it claims (*Your organization*), which
is outside the cap. Pro also gets the events by email (`watch_mail`). The code is `site/src/account/watches.ts`
(the rows, merges, console figures), `watch_events.ts` (the records database's
statements), `watch_pages.tsx` (the control and the page) and `watch_mail.ts`
(the mail); the tests are `site/test/accounts-watches.test.ts`. The events come
from `rec_events` in the records database (`docs/analytics.md`, *Events*).

### The control and the page

- A `Follow` button (`Suivre`) under the head of every organization, buyer,
  award notice, history record, published contract and open tender notice
  page. With the switch off it is not rendered and the page keeps every byte.
  Not signed in: a form on the page itself, an address field and `Follow`
  with one line under them (free, a sign-in link to that address, no
  password, what following shows). It posts to `/account/sign-in` with the
  honeypot, `lang`, `next` (this page) and `follow`, the kind and the target
  in one field (`<kind>:<target>`, for example `organization:org-a000000001`
  or `contract:award:cb-400-40000004`; `watch_events.ts` `followOf`). The
  form is the same for every reader not signed in (no token, no nonce), so
  the page's public cache is unchanged. A buyer's form follows the whole
  buyer; the segment choice is the signed-in form's. The code form, the
  emailed link and its confirm page carry `next` and `follow`, so either way
  of finishing keeps them; a sign-in returns to `next` (a path on this site
  only, never the sign-in pages). `follow` is read by the watch post's own
  rules (`isWatchKind`, `targetOf`); anything else is dropped without a
  word, as an unsafe `next` is. After the code or the link is verified and
  the session starts, `POST /account/check` adds that one watch for the
  account the address signs in to, by the watch post's steps (the label from
  the data, the merges, the insert held to the plan's cap), and audits
  `watch_added` with the detail `<kind> at sign-in`; at the cap nothing is
  added, a page followed already stays as it is, and any fault in this step
  is logged without detail and never fails the sign-in. No GET adds a watch:
  `/account/sign-in?next=&follow=` (an old link) and the link's page only
  carry `follow`. A post that carries `follow` without `Sec-Fetch-Site`,
  `Origin` or `Referer` of the site's own page sends nothing and answers the
  sign-in page with the address kept and `follow` dropped (*Security
  posture*). Errors on the form (an incomplete address, the honeypot, the
  hour's limit, a message not sent) answer on the sign-in page with its own
  lines, the address, `next` and `follow` kept. Signed in: a form
  that posts the kind and the target with the session's CSRF value; a buyer's
  form adds a choice of the whole buyer or one of the 57 segments. The label
  is read from the data, never typed. A followed page reads `Following` and
  links the watches page. A Free account at its cap sees the cap with the Pro
  chip instead of the button; a paid account at its figure sees what it
  follows of it: "This account follows 25 of 25 pages. Ultra follows up to
  100." while Ultra is on sale above the plan's figure, "This account follows
  25 of 25 pages, the most an account keeps." otherwise (`watch_pages.tsx`
  `paidWatchCapLine`; the watches page's notice for a refused post says the
  same). The line under the button says the events come by email only while
  the account's own watch mail is on (its `watch_mail` row, on when there is
  none yet, since the first watch writes it on); a Pro account that turned
  its watch mail off reads that they show on the watches page.
- `/account/watches` lists each watch with its events of the last 30 data
  dates (the 10 newest of each kind, then how many more), the newest day any
  event was found on, the kinds it follows (checkboxes, at least one) and, on
  Pro, daily or weekly. Free accounts see the page in full; the mail panel
  carries the Pro chip. A post at the cap answers 403 with the page's own line.
- Under the watches, the Calendar Feed panel (Pro): the watches' calendar
  feed, with its address, copy button, rotate and remove, the day a calendar
  last read it and how many events it holds now, or the button that makes it
  (*Calendar feeds*). The kinds a watch follows set how far ahead its end
  dates reach in the feed. Free accounts see the Pro chip and one line.
- What a watch follows by default, and can narrow to: an organization: award,
  grant, amended, cancelled, ends_12m, ends_6m, ended, instrument_gained,
  instrument_lost, instrument_expires_6m (the standing offers and supply
  arrangements it holds, `docs/sosa.md`); a buyer: notice,
  notice_amended, award, amended, cancelled, ends_12m, ends_6m, ended (a buyer
  not narrowed reports an amendment only when the value moved by CA$100,000 or
  50 percent, `EVENT_NOTABLE_CENTS`, `EVENT_NOTABLE_SHARE`; a narrowed one
  reads its segment's rows alone, every amendment, and no published contract
  or grant, which carry no segment); a single record: amended, cancelled,
  ends_12m, ends_6m, ended; a tender notice: notice_amended, notice_closed,
  notice_cancelled, notice_awarded. A watch reports from the data date it was
  added on (`last_sent_day` starts there). A watch keeps the list stored when
  it was made: an organization watch made before the three instrument kinds
  existed follows none of them until its reader ticks them on the watches
  page, where they are listed unticked; no stored row is rewritten.
- Merges. A watch follows an id. When the nightly retires an organization id
  (`aliases/<shard>.json`) or a buyer id (`buyers/aliases.json`) into
  another, the next page view or mail run points the watch at the surviving
  id (`followAliases`); when the account already follows that id (with the
  same segment), the retired watch is deleted, and the page says how many
  moved and merged.
- The claimed organization. An organization watch on the organization the
  account claims (*Your organization*) does not count toward the cap; every
  other watch does. The rule needs no table of its own. The insert
  (`ADD_WATCH_SQL`) reads the claim in the same statement, through a
  subquery on `org_claims` by the account's key, and counts every watch but
  that one. A watch passes while the counted watches are under the cap; the
  claimed organization's passes at the cap too, never over it. It is one
  statement, so two posts at once cannot both pass.
- A claim made (`POST /account/organization`) adds that watch when the
  account has none on the organization: the default kinds, the account's
  watch mail as it stands (a first watch makes the row, on), audited
  `watch_added` as the watch post is. A second claim of the same
  organization adds nothing. When the claim changes or is removed the watch
  stays and counts from then on; nothing deletes a watch for it. An account
  that a claim change leaves over its cap is refused its next watch, and the
  new claim's watch waits (the page says so) until the account is back within
  its plan, so moving the claim cannot pile watches up past the cap. An
  account holds 101 watches at most (Ultra's 100 and its own); a read covers
  101 subjects of a kind (`TARGET_SLOTS`), 25 to a statement
  (`TARGET_CHUNK`; *Ultra, Its figures*).
- The watches page marks that watch "Your organization, outside the limit"
  ("Votre organisation, hors de la limite") and its count, like the
  overview's, reads "N of 25, plus your organization" ("N sur 25, plus votre
  organisation"). On the claimed organization's own page the Follow button
  stays at the cap.
- The claim's merges. The claim and the watches follow merges apart
  (`followClaimedId`, `followAliases`); the watches page and both posts that
  add a watch point both at the surviving ids before anything is counted or
  added, so a merge does not turn the free watch into a counted one.

### The mail

The delivery job's last step (`runWatchMail`, after the saved searches, in the
same run and the same cap of 300 messages). For each account whose watch mail
is on, whose plan allows `watch_mail`, that is not blocked and not covered for
today's data date: its watches after the merges, the due ones (daily: not
covered for this data date; weekly: never, or seven or more days ago), each
read on the days after the data date it was last covered, at most seven. One
message per account, grouped by watch in the order single records,
organizations, buyers, notices; an event two watches reach is listed once,
under the first, with "Also on your watch of ..."; the kinds each follows
only; 50 rows in all, then a line per kind with how many more (a count row
counts what it stands for). The watches reached once the 50 rows are listed
are one line, "3 more pages with news are on your watches page" ("3 autres
pages avec des nouveautés figurent sur votre page des suivis"), linking the
watches page: with up to 100 watches a message would otherwise pass the size
at which a webmail client clips it and hides the stop link. The account's
first message of the week (no data date since the week's Monday covered yet,
`weekAnchor`: Monday, or the next data date when Monday had no run) also
carries the week's matching notices for the organization it claims, unless
its weekly email takes them (*Matching notices*, By email). Nothing new
writes `empty` and sends nothing: no empty message is ever sent. The
account is claimed for the data date before
its message goes (`watch_mail.last_day`), only while its mail is on, so a
stop link clicked after the run read its list stops that run's message; the
claim is given back when the send does not go; a refusal that is not a
sending limit sets `failed_day` and the account waits for the next data date.
After a message went, the account's row, its run and each watch's coverage
(`last_sent_day`) are written once more when the write fails, so a passing
fault does not leave the next data date repeating the events. Each run of an
account is a `watch_deliveries` row (kept 90 days). An account read and passed
over because its plan has no `watch_mail` (Free, or a plan that lapsed) is
marked for the data date (`last_day`, nothing else, no run row, one batch for
up to 100 of them), so the accounts that follow pages on Free do not fill the
1,000 the run reads ahead of the accounts that pay for the mail. The list
(`WATCH_DUE_SQL`) also puts the accounts whose cached plan (`users.plan`) is
paid first: each Free follower still costs a plan read once a data date, and
past a few thousand of them the run's query budget would otherwise run out
before the accounts that pay. The cached plan only orders the list; `planFor`
decides at the send, so an account cached as paid that is Free now is passed
over, and a paying account whose cache still says Free is reached after the
Free followers. Until the
records database is ready at today's data date (absent, loading, failed,
stale) every account waits unclaimed and the run's report says why
(`watch.records`).

Subject: `{n} updates on what you follow: {first two watch labels}` (`1 update
on what you follow: {label}`); in French `{n} nouveautés sur ce que vous
suivez : ...`. Each row: the
title linking its page; what happened with its figures (an amendment's value
before and after with the change in dollars and percent, the end date moved
and the amendment number; a cancellation's value before; an end date; a
notice's closing, its closing moved or its winner); then the data date it was
first seen. A standing offer's or supply arrangement's row is titled with its
agreement number, linking `/instruments/<agreement>` (one escaped path
segment), and gives the type and region, the description, "expires {date}"
("expire le {date}") and its active holders now ("14 holders", read with the
events through `rec_instruments_agr`, left out when the records database no
longer holds the instrument). Then the footer's note, the watches page and the
stop link.

The stop link is `/account/stop?w=<user id>&t=<secret>`, in the footer and in
`List-Unsubscribe` with `List-Unsubscribe-Post`. It turns the account's watch
mail off (`watch_mail.mail`), not the watches. GET shows a button; POST and
the one-click body act; a wrong secret is the site's 404; `STOP_LIMIT`
applies as it does to the searches' link. The secret is 16 random bytes made
with the first message.

After the messages, the run ends the watches of notices that closed or were
cancelled: one whose event was covered by its account's message, or found
seven or more days ago (shown on the page for a week), is deleted
(`TENDER_SWEEP_MAX` 250 oldest a run).

### Tables

| Table | Holds | Never holds |
|---|---|---|
| `watches` | kind, target (the page's id or the record's ref), segment, the site's label, the kinds followed, daily or weekly, created, the data date its mail last covered | anything typed |
| `watch_mail` | on or off, the stop secret, the last data date covered and how that run ended, the data date a message was refused for | a copy of a message, the address |
| `watch_deliveries` | one row per run of an account: when, the data date, how many events, sent, empty or failed | the message |

All go with the account (`deleteWatchesOf`, before the deletion batch; a
database without the tables yet is no fault there). The console's overview
shows the watches by kind, the accounts with the mail on, the last week's runs
by status, and the records database's data date with its events by kind (and
how many subjects went past the cap); the user page lists the account's
watches (kind, subject, segment, cadence, added, covered to), whether its mail
is on and its last 20 runs.

### The browser watchlist

`/watchlist` and its `Add to watchlist` button on a profile
(`public/watchlist.js`) are unchanged: a list of organizations kept in the
browser alone, compared by counts since the last visit, for any reader with or
without an account. The account's watches are separate rows on the server,
cover buyers, records and notices as well, list dated events and send mail. A
profile shows both controls while the switch is on; nothing moves one list
into the other yet.

### Operator steps

```
npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
npx wrangler d1 execute awardwatch-records --remote --file=../pipeline/records_schema.sql
```

Both are idempotent; the nightly applies the second itself. Until the first
runs the watch mail logs `no watch_mail table` and the watches page answers
503; apply it before deploying. The first night with the events step writes
only award, grant, notice, notice_amended and notice_awarded rows (it has no
previous night to compare with, and no award rows if the ledger is empty); the
second night writes every kind.

## Your organization

An account names the organization it is, and `/account/organization` shows
that organization's figures in one place. The claim is self-declared and
unchecked: the site checks only that the id is one the profiles hold. It
grants no data the profile and the analytics views do not already show a
Pro reader, it is shown to that account alone (and to the operator's
console), and it changes nothing public: no page, feed, sitemap or file
names it, and the profile reads the same in every byte for every reader. Two
accounts may claim the same organization; nothing ties one to the other. The
code is `site/src/account/org_claim.ts` (the claim, the statements, the
weekly block) and `org_pages.tsx` (the page and the files); the tests are
`site/test/org-claim.test.ts`.

### The page

- Unclaimed: a search box that reads the hosted search with the statements
  `/search` runs (`search_db.ts`), or a pasted profile address (or an id),
  read from the files. Each result shows the name, city and province and the
  records count, with a "This is us" button (`C'est nous`). The page says the
  choice is private and changes nothing public. The post stores only an id
  the profiles hold; a retired id is stored as the one that took its records.
  A second claim replaces the first (another organization resets the
  segment and the claim's date; the competitors stay).
- Claimed: the organization linked to its profile, a Change link, a remove
  button, the line "You have told the site this is your organization. The
  site does not check this and shows it to no one else.", then the
  organizations to compare (up to 5, `COMPETITORS_MAX`, added by the same
  search, each with a remove button, kept in the order added), then the
  blocks.
- The blocks, all over the 10 fiscal years ending with the data date's:
  records by fiscal year, each source apart (`ORG_COUNTS_SQL`), listed a
  row a fiscal year and source with the profile's switch that shows one
  source or all of them, a year without records at 0; records by
  segment, award notices and PSPC contract history apart, each record once
  in its first segment, with the published contracts and grants (no segment)
  counted beside; the share of one segment's counted value for the
  organization and its competitors, one source at a time (award notices by
  default, PSPC contract history as a tab), the segment chosen or else the
  organization's largest: a chart by fiscal year, a panel each on one scale,
  then a table a row an organization (its own first, marked as its own, then
  the competitors in their order, each linked to its profile) with its share
  and its value in one fiscal year or over the whole period, the whole
  period by default. A line above the table says what it shows and gives the
  segment's whole value there, the denominator (supplier-withheld records
  count in it and in nobody's share; an organization with no record there
  shows 0% and no value). The fiscal year is a select with its Show button,
  a get that writes `?year=<first calendar year>` (`?year=2025` is 2025-26)
  into the address beside `?source=`; the source tabs keep the year, the
  year's form keeps the source, and the segment's post carries both back. A
  year outside the ten, or any other value, reads as the whole period. The
  table is 372 px at its least (the organization, a share, a value), so it
  fits from a 700 px window with five competitors as with none;
  its contracts ending within 12 months, the radar's own rows for
  `/expiring/12m?supplier=<id>`, 25 shown; the buyers it has records with
  (up to 100 by records over ten fiscal years, 25 shown), each source's
  records and value apart, each buyer's open notices from the buyers index
  (linked `/tenders?buyer=`) and its contracts ending within 12 months
  (linked `/expiring/12m?buyer=`); the standing offers and supply
  arrangements it holds (`docs/sosa.md`), the soonest expiry first and no
  expiry last, each with its agreement number linked to
  `/instruments/<number>` (the number escaped as one path segment), its
  type, description, regions, end user (linked to the buyer when the source
  names one) and expiry, 25 shown and a link to the profile's section for
  the rest, the count in the panel head, or a line that it holds none; and
  the registry match as the profile shows it.
- Free sees the first block for the latest 3 fiscal years and every other
  block's title with the Pro chip and one line of what it holds. Pro
  (`analytics`) sees every block and a CSV file of each:
  `/account/organization/<years|segments|share|ending|buyers|instruments>.csv`,
  at most 10,000 rows, sent `private, no-store`, a download under the per-address
  limit; anyone else gets the site's 404, and a records database that cannot
  answer gives 503.
- The page is `private, no-store` and `noindex`. With the records database
  missing, loading or failing it still shows the claim and the competitors
  and says the figures are not available right now.
- Merges: a claimed id the nightly retired is pointed at the surviving one on
  the next view (`loadAlias`, as watches follow it); a competitor merged the
  same way follows; one that no longer exists, or became the same as another,
  is dropped with a line.

### Statements and bounds

One claim per account; 5 competitors (held in the update, which writes only
over the list the page read, and by the table's CHECK); 10 fiscal years in
any statement; 100 buyers, 25 shown; one records batch per page view, the
state row and at most 8 statements (7 for Pro, 1 for Free); CSV files of at
most 10,000 rows. Every records statement is a constant bound to checked
values and ends in a LIMIT; the test reads each plan. The share statement
keeps the rows and binds of the organization view's (`ORG_SHARE_SQL`) for
the six organizations named, and reads them through `records_org` rather
than the whole segment through `records_segment` (the organization view also
offers the segment's largest others, which needs the whole segment); the
test holds its rows equal to `ORG_SHARE_SQL`'s. The buyers block reads
`rec_details_org` and, per buyer, `rec_expiring_buyer` over the radar's
window. The instruments block (`CLAIM_INSTRUMENTS_SQL`) reads `rec_holders`
by the organization's number, one row an instrument with its regions,
joined to `rec_instruments` by its key, at most 10,000 rows for the page and
the file alike. `rec_holders` has no index by organization (its one index
leads with the instrument), so this statement scans it, one row per active
holder and region, and is the one statement of the page that scans; `CROSS
JOIN` keeps the holders the outer loop, so each instrument is then read by
its key. The test reads its plan.

### The claimed organization's watch

The claim follows the organization as a watch outside the plan's cap
(*Watches*): the claim post adds it with the default kinds when the account
has none on the organization, and a second claim of the same one adds
nothing. Changing or removing the claim leaves the watch, which then counts
toward the cap; nothing deletes it. The watch and the claim follow a merge
alike, and the watches compare their targets with the claim's surviving id.

### The weekly block

`orgWeekOpening` builds the block the spec puts at the head of an account's
weekly watch mail: "Your organization: <name>", then up to three lines, each
a count with its link (new records naming the organization in the last 7
data dates, from `rec_events` through `rec_events_org`; its contracts ending
within 12 months, with the soonest end and their value; the buyers it has
won from that posted new notices in the week, from `rec_events` through
`rec_events_buyer`). A week with nothing is the single line "Your
organization: nothing new this week." The records database must be at the
run's data date, or the block is left out. `watchDigest` (`digests.ts`) takes
it as `opening` and puts it before the watches; a message with the block and
no watch event carries the block alone, under its own subject. The watch
mail's run (`watch_mail.ts` `runWatchMail`) reads it on the account's weekly
day (a day one of its weekly watches is due, or the account's first message
of the week: no data date since the week's Monday covered yet, so Monday, or
the next data date when Monday had no run) and sends a message that would
otherwise be empty when the block has a line; a fault in reading it leaves
the message without the block. The block always reads the 7 data dates
ending with the run's, so when it goes on a Tuesday, the next Monday's block
counts that Tuesday again. The week's matching notices, when the
message carries them, follow this block (*Matching notices*, By email).

### Privacy and the console

The row is a user id, an organization id, up to five organization ids, a
segment and two times. The audit row `org_claimed` carries the organization
id (not personal data), never the address; `org_unclaimed` and `org_compare`
carry a fixed word. The row goes with the account (`deleteClaimOf`, before
the deletion batch). The console's overview shows the claims in all, those
of the last 7 days and the 10 most-claimed organization ids (a spike on one
id may be accounts claiming a rival, which reads nothing the profile does not
show); the user page shows the account's claim, its competitor ids and its
segment.

### Operator step

Create the claims table (idempotent; the schema's other tables already
exist):

```
cd site
npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
```

## Matching notices

`/account/matches` lists the open tender notices ranked by what each has in
common with the records of the organization the account claims (*Your
organization*). It is the site's first advisory feature: a calculation by
fixed rules, never a statement about the business and never a chance of
winning. The code is `site/public/fit.js` (the rules and the points, one copy
for the Worker and the browser), `site/src/fit.tsx` (the block's check, the
words of a band and a reason, the disclaimer),
`site/src/account/fit_pages.tsx` (the page) and
`site/src/account/fit_panels.tsx` with `site/public/fit-panel.js` (the
panels on other pages, *On the site's pages*); the pipeline writes the block
in `pipeline/awardwatch_pipeline/profile_matching.py`. The tests are
`site/test/fit.test.ts`, `site/test/fit-pages.test.ts`,
`site/test/fit-panels.test.ts` and `pipeline/tests/test_profile_matching.py`.

### The block

Each profile in `profiles/<abc>.json` with a record or a held instrument in
the 5 fiscal years ending with the data date's carries `matching`: the
records counted per source (award notices, PSPC contract history, published
contracts), the award notices and history records with a UNSPSC code, the
newest record's date, and per source the UNSPSC classes (40 at most),
families (20), segments, buyers (25, listed buyers only), provinces of
delivery and notice types, and the standing offers and supply arrangements
held by type and segment. A history record counts under its client and under
PSPC. Published contracts add counts and buyers only; their amendments are
not counted. Grants and lobbying reports are never read, and a withheld
supplier's record counts for no organization. `stats.json` carries
`matching_fy`, the window the night's blocks count, so the page can tell a
profile with nothing in the window from a file written before the block
existed.

### The rules

Four parts out of 100, the highest line of each counting, a count always the
largest of one source and never a sum: the kind of work (a shared UNSPSC
class 45 or 35, family 25 or 20, segment 10 or 5), the buyer (25 or 15), the
province (a province of delivery 15 or 10, the profile's province 8, a
notice naming none 5) and the notice type (an RFP against a supply
arrangement while one is held in a notice segment 15, else a type the
organization was awarded under 10 or 5). The first figure of each pair is
for 3 records or more of one source. A notice is matched only when it shares
at least a segment. Close from 60, partial from 30, weak below; the list
shows close and partial. An organization needs 3 records with codes in one
source for a ranking. The Methodology page (`/methodology#matching`) prints
the table from `fit.js`'s constants.

### The page

- No claim: a line and the page's one filled button, to `/account/organization`.
- A profile written before the block: "Matching notices appear here after the
  next nightly data refresh." The page never errors; a block that does not
  read is treated the same way.
- Nothing in the window, published contracts only, or too few records with
  codes: one line saying which, with the counts and the fiscal years.
- The ranking: what the matches read (the first 5 classes, buyers, provinces
  and notice types, the instruments held, the counts and the newest date),
  then the matching notices, each with its band, its total ("95 of 100
  points") and every reason with its points. Free lists the first 5 and says
  what each plan lists (`RULES.free.matches`, `RULES.pro.matches`,
  `MATCH_PAGE`); Pro lists up to 200, 50 a page. A notice whose closing time
  has passed is left out, and the notices with no UNSPSC code are counted.
- Every state carries the disclaimer, linked to the Terms' No Warranty
  section, which holds the paragraph on these calculations, and the way to
  the rules; the ranking adds that a match is not a chance of winning, that a
  notice with no match may still suit the organization, and the licence line.
- The page reads the claim (one accounts row), the profile entry, `stats.json`
  and, for a ranking, `tenders/open.json` and `tenders/open-levels.json`
  (both kept parsed while their ETags hold); the buyers index only for a
  buyer the profile and the open notices do not name. It never writes: a
  claim on a retired id is followed to the surviving profile for display and
  repointed by the organization page. It reads the records database only for
  may follow's line under each listed notice, while `FOLLOWS_PANEL` is "on"
  (one statement for the page's notices, *May follow*). It is
  `private, no-store` and `noindex`.
- The overview links it beside the claimed organization.

### On the site's pages

The same matches appear where a signed-in reader already is. Free and Pro see
the same three surfaces; only `/account/matches` and the email list more on
Pro.

- **An open notice's page.** After Key Dates and Buyer, before Documents:
  "Match With Your Organization", what the notice has in common with the
  claimed organization's records, the band and its total ("95 of 100
  points"), every reason with its points, the records counted ("From 7
  award notices, ..., fiscal years 2022-23 to 2026-27.") and the disclaimer
  with the way to the rules. A notice that shares no UNSPSC segment reads
  "No match" and says why (or that it carries no code), then states the
  buyer, province of delivery or notice type it still shares, as facts
  without points. A signed-in account without a claim gets one line under
  the Follow control instead, linking `/account/organization`. A closed
  notice shows neither: a match is about what can still be answered.
- **`/tenders`.** Over the toolbar: "Notices Matching <name>", the first 5
  matches, closest first, each its band and title, then its buyer, closing
  day and first reason (the work in common) without points; "All 12 matching
  notices" linking `/account/matches`, which lists what the plan allows; the
  disclaimer. The server writes the panel's frame and, in a JSON block
  (`#fit-data`), the organization's id, name and province, its matching
  block, the words and the titles of its segments. `public/tenders.js` loads
  `public/fit-panel.js` only for such a page and hands it the full list it
  already fetches; `fit.js` scores it in the browser, and the families' and
  classes' names come from `tenders/open-levels.json`. Without JavaScript the
  panel holds a link to `/account/matches`. Apply stays the page's one filled
  button.
- **`/account/organization`.** After the claim and compare panels: the same
  5 rows with the link to all, drawn on the server by `fit-panel.js` from the
  same data, and the disclaimer; or the one line that says why there are
  none (no open match, the open notices unreadable, or a block that cannot
  rank, in `/account/matches`' words).
- **A reader not signed in** gets, on an open notice's page, a short panel
  in the match panel's place under the same title: a free account that names
  its organization sees there what the notice has in common with that
  organization's records, with "Create a free account or sign in" linking
  `/account/sign-in?next=/tenders/<reference>`. On an organization's profile,
  one line after the Follow control asks "Is this your organization?" and
  links the sign-in with `next` set to `/account/organization?q=<id>`, the
  claim page opened on that profile as its one result, one press from naming
  it. A signed-in account that names no organization gets the same line
  linking `/account/organization?q=<id>` itself; one that names any
  organization gets nothing. The line shows only on a profile with an award
  notice, a contract history record or a published contract, read from the
  counts the profile already holds; grants and lobbying are never matched.
  Both read only what the Follow control reads (the session and, signed in,
  its one statement, which also says whether the account claims an
  organization), and neither carries a filled button. A closed notice shows
  nothing, and with the switch off neither exists.
- **Nothing more** on `/tenders` for a reader not signed in, and on the
  notice page and `/tenders` nothing while the claimed organization's block
  cannot rank notices (no block yet, nothing in the window, published
  contracts only, too few records with codes, or the organization gone from
  the data): the account pages say which.
- **Caching.** The notice page, the profile and `/tenders` are public pages:
  signed out, every reader gets the same bytes with the same headers as
  before (`public, max-age=300`, with `Vary: Cookie` while accounts are on),
  the invitation and the profile's line included. A panel
  or the line is drawn only for a session the request reads, and the shell
  then names the signed-in address, so `layout.page` sends the response
  `private, no-store`, as for the Follow control and Save this search. Only
  the account's own claim is read, so one reader's organization never
  reaches another's page.
- **Reads per page view** of a signed-in account, besides what each page
  already read: on the notice page, the claim (one accounts row,
  `CLAIM_READ_SQL`), the claimed profile's shard entry (two more files for a
  retired id) and `tenders/open-levels.json` when a reason names a class or
  family; the notice is scored alone. On `/tenders`, the claim and the
  profile entry; the server never parses `tenders/open.json` for the page.
  On `/account/organization`, `tenders/open.json` and
  `tenders/open-levels.json` (kept parsed while their ETags hold) and about
  a thousand notices scored; the claim and profile are the page's own. No
  records-database read and no write anywhere. `site/test/cpu-budget.test.ts`
  times each page for a signed-in account, its accounts database answered
  from memory, with 900 open notices. On the notice page the claim, the
  profile shard's read and the panel add about 70 percent to the page's time
  for that account (measured 2026-11-11).

### By email

`site/src/account/fit_mail.ts` builds the block a week's message carries
(`fitDigestBlock`), and `digests.ts` draws it (`DigestMatches`). The tests
are `site/test/fit-mail.test.ts` and the mail suite (`docs/mail.md`).

- What it lists: the open notices first seen (`first_seen`) in the 7 data
  dates ending with the run's, whose closing time has not passed at the
  run's time, that are close or partial matches, closest first, as the page
  ranks them. Free lists `RULES.free.match_mail` (3), Pro
  `RULES.pro.match_mail` (10). The plan cards state each plan's figure on a
  row of their own after the matching notices' (`plans.match_mail`, feature
  `match_mail`): "3 matching notices a week, by email" and "10 matching
  notices a week, by email" ("3 correspondances par semaine, par
  courriel").
- Each row: the band and the title ("Close match: Snow removal ..."),
  linking the notice; then the buyer, the closing date and the first reason
  (the work in common) without its points. Then, when more matched than are
  listed, "9 more on the site" linking `/account/matches`; for Free, "Pro
  lists up to 200 matching notices on the site and 10 a week here." (both
  figures from `RULES`); the disclaimer, its Terms of Use a full https
  address (`/terms#warranty`, `/terms?lang=fr#warranty` in French); the
  licence line.
- Which message: a Free account's weekly email (*Weekly email*). A Pro
  account's weekly email when that is on; otherwise its watch mail
  (*Watches*), in the account's first message of the week (the account
  covered no data date since the week's Monday, `briefings.ts`
  `weekAnchor`), after the "Your organization" block and before the
  watches. The watch mail leaves the block out when the account's weekly
  email is on from before that Monday and no message to it was refused that
  week (`failed_week`), or went that week (`weeklyTakesMatches`), so a Pro
  account with both is sent the same matches once, and a week whose weekly
  email was refused leaves them to the watch mail. A watch message already
  sent that week before the refusal does not carry them again. A watch message with no event and nothing in the
  organization's block still goes for the matches, under the organization
  block's subject (or the matches' heading when that block did not read).
- No block, and the message goes as it would without it: no claim (or no
  claims table), the organization gone from the data, a profile without a
  block or one that does not read, a record too thin, published contracts
  only or nothing in the window, no new match in the week, and any read
  that fails (the claim, the profile shard, `tenders/open.json`). A
  `tenders/open-levels.json` that does not read leaves a class or family
  named by its code alone, as on the page. Nothing here throws, and nothing
  new is logged.
- Reads: per account, the claim (one accounts row, `CLAIM_READ_SQL`) and
  the profile's shard entry (two more files for a retired id); in the watch
  mail, the weekly email's row too (`WEEKLY_MATCHES_SQL`, by its key), and
  only on the account's first message of the week. `tenders/open.json` and
  `tenders/open-levels.json` are read once a run (`weekNotices`), and the
  week's rows are ranked per account. No records-database read: the block
  needs only the static files, and the weekly email and the watch mail
  already wait for the records database for their own parts. No write and
  no new table. The run's caps are unchanged: a message with the block is
  one message, and the one the block alone sends (a Pro account's watch
  message on a week with nothing else, at most once a week) counts against
  the same 300 messages a run.

## Holder's record

Under the holder of each contract on the radar, a signed-in reader sees the
holder's record with the buyer: its contracts of the same kind of work with
the same buyer, each source counted apart, and a label that names the
records ("Long run", "Earlier records", "No earlier record"; "Longue série",
"Dossiers antérieurs", "Aucun dossier antérieur") with its figure. It is the
site's second advisory feature, covered by the same Terms paragraph as
matching notices. The code is `pipeline/awardwatch_pipeline/lines.py` (the
rules and the nightly stage), `records_db.py` (`rec_lines`),
`site/src/lines.ts` (the constants, the row's check, the label),
`site/src/lines_view.tsx` (the radar's mark and its lines),
`site/src/pages/holders.tsx` (the panel on a contract's page), and
`radarLines`, `sectionLines` and the holder's record filter in
`site/src/pages/expiring.tsx`. The tests are
`pipeline/tests/test_lines.py`, `pipeline/tests/test_records_db.py`,
`site/test/lines.test.ts`, `site/test/lines-pages.test.ts` and
`site/test/lines-places.test.ts` (the third slice's pages).

### The rules

A line is one source's records of one buyer and one kind of work, dated in
the 10 fiscal years ending with the data date's (`LINE_YEARS`). The buyer is
the radar row's client department, else its buyer; the kind of work is the
UNSPSC class of an award notice or history record (its family when it has
no class), or the first 4 characters of a published contract's commodity
code (`CODE_CHARS`). A row is counted in its own source and in the source of
each row the radar's duplicate rule dropped against it (`expiring_twins`)
when the same organization holds that row. In each source: the holder's
records that start on or before this one (held, this one included), the
first start, how many ran back to back (each later one starting no more
than 120 days after the earlier one ends and no more than 60 before,
`RUN_GAP_DAYS`, `RUN_OVERLAP_DAYS`; never two call-ups against one standing
offer), the records in the line whoever held them and the other
organizations among them, and how the held ones were awarded. A long run is
3 or more back to back in one source (`LONG_RUN`); earlier records, one
earlier record or more in one source; no earlier record, none in a source
with a kind of work. Organizations of a similar name (the same match key,
the same first 20 characters of the normalized name, `SIMILAR_PREFIX`, or a
corporate family in common) are listed under their own names and never
added to the holder's. An opening that more than 12 holders of one line
share (`SIMILAR_GROUP_MAX`) is a common phrase and lists no one there: on
the first production night "Harbour Authority of" opened the names of 163
holders of one line, each a body of its own, and the largest group that was
one organization's spellings and divisions had 11. A record lists 50 similar
names at most (`SIM_MAX`), those with the most records, because the site
refuses a record that carries more. The pipeline's constants and `lines.ts`'s are held
equal by `test_lines.py`; the Methodology page (`/methodology#holders`)
prints every figure from `lines.ts`.

### The nightly

- The stage `lines` runs after `expiring` and before `export`, with its own
  `sources_log` row (the counts by label, the rows written and the
  seconds; no notice, and no account or reader figure). It reads the radar
  rows with a named holder and their twins, then one pass over each source,
  keeping only the records a row's line reads, and rebuilds
  `expiring_lines` (source key, `j`) whole in one transaction. A fault rolls
  the transaction back, so the table keeps the night before's rows; the
  stages after it still run, and the run is marked failed like any stage.
- `expiring.py` keeps the pairs its duplicate rule collapsed in
  `expiring_twins`, rebuilt with `expiring_contracts`.
- The records sync writes `rec_lines` (code 18) from `expiring_lines` and
  the static export's 12-month window: one row per window row whose holder
  was counted, keyed as the row is in `rec_expiring`, `sk` its kind and URL
  reference in lower case. Both pipeline tables are in `schema.sql`, which
  every connection applies, and `rec_lines` is in `records_schema.sql`,
  which the nightly applies before each sync: no operator SQL, no full
  reload, `LAYOUT` stays 2.
- The review file `data/out/review/holder-lines.txt`: the labels by source
  and window, 50 rows of each label sampled by a hash of their key, and
  every similar-name pair. The workflow saves it to the bucket's private
  `review/` prefix with the other review files. It names organizations and
  records, never an account or a reader.
- On the development copy (1,906 radar rows, data date 2026-11-01): 1,894
  rows written (12 withheld or unnamed), 22 long runs, 328 earlier records,
  1,485 no earlier record, 59 without a kind of work, 11 similar-name pairs;
  `j` averages 355 bytes (672 KB in all), and the stage took under a second.

### Where it shows

- A radar window's page (`/expiring/3m`, `/6m`, `/12m`, the full list and
  the free view): under each named holder of a row ending within the plan's
  days, Free 91 (the 3-month list's) and Pro 365 (the 12-month list's), one
  muted line: "Long run · 7 back to back", "Earlier records · 8 earlier",
  "No earlier record", with "· similar name" when the line lists one. Under
  the table: what the line means, the disclaimer with its link to the
  Terms' No Warranty section and to `/methodology#holders`, and the
  licence line. Rows the plan covers with no record yet: "Holders' records
  appear here after the next nightly update." A database that cannot
  answer: one line saying so. A reader not signed in: "Signed-in readers see
  each holder's record with the buyer under its name. Sign in", the same for
  everyone, so the page stays public (`public, max-age=300`, `Vary:
  Cookie`).
- A contract's page (`/awards/<ref>`, `/history/<ref>`,
  `/contracts/<department>/<ref>`), after the dates: the panel "The Holder's
  Record With This Buyer" with the lead, the label and its figure, each
  source's lines, this contract's method, bids and amendments, the similar
  names (each linking its own profile), the basis, that the counts say
  nothing about the chances of any bid, the disclaimer and the licence
  line. A contract without a kind of work says why it has no label. Free,
  past its 91 days: one line saying what each plan shows, with a link to
  the plans. Nothing for a reader not signed in, a contract the radar does
  not hold (ended, cancelled, beyond 365 days, a twin, an older version of
  a published contract), a supplier withheld as a person, or a row that
  does not read in full.
- The radar's overview (`/expiring`), on its first 50 rows (the 3-month
  list's first), and the "Contracts ending" section of a profile and of a
  buyer page (`sectionLines`): the same mark by the same rules of days, and
  the same lines under the table (what the mark means, the disclaimer, the
  licence line; "not available right now" when the database cannot answer;
  the next night's line when the rows the plan covers have no record yet).
  On a buyer page the mark is under the holder's name; a profile's table has
  no supplier column (every row is the profile's own), so there it is the
  contract cell's last line and no column is added. A reader not signed in
  gets these three pages byte for byte as before, with no sign-in line, and
  they keep `public, max-age=300` with `Vary: Cookie`.
- The holder's record filter on a window's full list (`?line=run`,
  `earlier` or `none`; "Holder's record", "Dossiers du titulaire", its
  choices the three labels): only for a signed-in reader while the accounts
  switch is on, so Free on the 3-month list and Pro and Ultra on every
  window. It reads the window's rows whose holder is named and whose record,
  of the form the page reads, carries that label, and only those ending
  within the plan's days (`radarParams`' `lineDays`), so a filter never
  picks a row by a label the plan does not show. It works as the window's
  other filters do: a select in the toolbar (its choices not counted, as the
  provinces are not, since counting them would read every row's record for
  every view), a chip, the address in a fixed order kept by the pages, the
  heads and the window tabs, the matches over the whole window from the
  records database, the view `noindex` with no canonical address, and the
  matches' CSV for Pro with the band applied and no label in the file. A
  deeper window's free view sets it aside with its other filters and says
  so. For anyone else the address's `line=` is not read at all: the page,
  its headers and its reads are those of the same address without it. A
  saved search and an email list never keep it (*Save this search*). A
  records database without `rec_lines`, or one that cannot answer, sets it
  aside with "The holder's record filter is not available right now; the
  list shows every contract."
- The plan cards: "Holder's record: the 3-month list" on Free, "the
  12-month list" on Pro (`plans.lines`, feature `radar_depth`).
- Every page showing a record is signed in, so `page()` sends it
  `private, no-store`. Nothing is added to a static file, a feed, the open
  API or a CSV.

### Reads and bounds

- A window's page, signed in: one records statement (`LINES_BY_KEY_SQL`),
  the keys of the rows the plan covers bound as one JSON list, at most 500
  (a page file's rows), each found through `rec_lines_sk`: up to 500 index
  reads and about 180 KB of `j`, then each row checked and its mark drawn.
  The CPU guard times a Pro reader's 500-row 3-month page at 31.6 times the
  yardstick against 27.2 for the same page signed out (bound 95).
- An award notice's or history record's page, signed in: one statement
  (`LINE_BY_KEY_SQL`, one row with the buyer's and the holder's names, under
  1 KB), only when the contract can be on the radar; plus the open notices'
  class and family names (`tenders/open-levels.json`, kept parsed while its
  ETag holds) when the record names a class or family.
- A published contract's page, signed in: the same statement in the page's
  own batch (four statements where it had three).
- The overview, a profile and a buyer page, signed in: one statement more
  (`LINES_BY_KEY_SQL`, one batch with the state row), for the rows the plan
  covers whose holder is named: at most 50 keys on the overview and 25 on a
  profile or a buyer page; none when no row qualifies.
- A window narrowed to one label: the window's one batch as for any filter,
  its page of matches and their count read by the band's statements
  (`RADAR_LINE_SQL`), each window row the other conditions keep looking up
  its record once through `rec_lines`' primary key (its `rec_expiring.k`),
  so the filter reads no more than the window's rows and needs no index;
  then the marks' statement as above. A database without `rec_lines` is read
  once more without the band.
- The CPU guard (measured 2026-11-15, against the yardstick): a Pro reader's
  overview with 50 marks 5.13 (bound 16), the profile 4.96 against 5.28
  signed out (bound 22), the buyer page 2.22 against 1.91 (bound 7), and a
  3-month list narrowed to one label with 100 matches 8.17 (bound 25).
- A reader not signed in: no read at all; the contract pages, the overview,
  the profiles and the buyer pages are byte for byte as before, which
  `lines-pages.test.ts` and `lines-places.test.ts` hold.

### Later

The mail (the Pro weekly briefing's contracts ending, the watch mail's
`ends_*` events, the matching block) and the CSV columns are later slices.
May follow, the second slice, is below (*May follow*), behind a switch of its
own; its line on the matching notices is there too.

### Operator steps

None for the tables. After the first nightly with the stage, read
`review/holder-lines.txt` in the bucket: the split by label and source, the
sampled rows and the similar-name pairs. The constants are confirmed there.

## May follow

On an open notice's page, a signed-in reader sees the earlier contracts of
the same buyer the notice may follow, each with what matched: "Earlier
Contracts This Notice May Follow" ("Contrats antérieurs auxquels cet avis
pourrait faire suite"). It is the holder's record's second slice and the
site's third advisory feature. The code is
`pipeline/awardwatch_pipeline/follows.py` (the rules, run inside the `lines`
stage), `records_db.py` (`rec_follows`), `site/src/lines.ts` (the constants,
the switch and the row's check), `site/src/pages/follows.tsx` (the panel) and
`loadEarlierAwards` in `site/src/pages/backbone.tsx`. The tests are
`pipeline/tests/test_follows.py`, `pipeline/tests/test_records_db.py`,
`site/test/follows-pages.test.ts` and `site/test/lines.test.ts`.

### The switch

`FOLLOWS_PANEL` in `site/wrangler.jsonc` ships "on", since the hand check of
the production matches of 2026-11-15 passed (it shipped "off" until then).
"On": the panel shows, the Methodology section is "Holder's Record and
Earlier Contracts" with its paragraph (`#follows`), and the Terms read
`terms.advisory_follows` (section 9.2 of the design). Anything but "on": the
notice page is the same for every reader whatever `rec_follows` holds, it runs
no records statement for may follow (its batch is the state row and the
earlier awards, as before), the Methodology section is "Holder's Record"
without the paragraph, and the Terms' advisory paragraph names matching
notices and the holder's record only (`terms.advisory`). The plan cards' row
(`plans.follows`) is static and stays whatever the switch. The pipeline
computes, syncs and reviews the matches whatever the switch.
`follows-pages.test.ts` holds both states.

### The rules

For each notice open on the data date and every award notice, PSPC history
record and published contract of the notice's buyer, or of the client
department it names first among its end users, dated in the 10 fiscal years
ending with the data date's (`LINE_YEARS`) and no later than the day the
notice was published:

- **Number match**: the record carries the notice's solicitation number, or
  the notice's title or description names one of the record's numbers (an
  award notice's solicitation and contract number, a history record's
  solicitation, contract and procurement numbers, a published contract's
  reference and procurement id), each folded to its letters and digits, 5 at
  least. The notice's own numbers, the numbers of standing offers and supply
  arrangements (from CanadaBuys' instrument types, the published call-ups'
  `standing_offer_number` and the standing offers file), and a number that
  the buyer's earlier records of more than one organization carry are not
  compared. The last rule came from the development copy: read over its award
  notices as if they were open, the awards of one call number (five
  organizations) matched each other by number with no title word in common,
  and same-solicitation matches were the closest for 115 of 136 notices; with
  the rule, 8 of 41.
- **Text match**: the record shares a UNSPSC class with the notice (a family
  when the notice has none), their titles share at least 2 distinct words
  (`FOLLOW_WORDS_MIN`) and at least half their distinct words (`FOLLOW_MIN`;
  words of four letters or more, no digit, outside the earlier awards' stop
  list and thirteen procurement words, English else French), and the record
  ends from 180 days before the notice's expected start to 120 after it
  (`FOLLOW_BEFORE_DAYS`, `FOLLOW_AFTER_DAYS`), or its publication date when it
  states none. Close from three quarters of the words (`FOLLOW_CLOSE`),
  partial below. A published contract has no UNSPSC code and follows by number
  only. The floor of 2 words came from the hand check of 2026-11-15: of the
  first ten close matches, eight read as plausible, and the clear miss was two
  equal one-word titles ("1/1", the whole share). A number match needs no word
  in common.
- Standing offers and supply arrangements themselves, cancelled notices and
  records awarded after the notice was published are left out.
- Order: number matches, then the share of words, then the end nearest the
  start, then the record's key; one contract published in two sources (a
  contract number in common, or the same organization ending within 3 days)
  is kept once; 3 kept (`FOLLOW_MAX`).
- Each kept record carries its holder's record in its own source, counted by
  the radar rows' code (`lines.own_figures`: the same line, the common-opening
  rule and the 50 similar names at most), so an ended contract has one too. A
  holder withheld as a person is kept, shown as "Individual, name withheld"
  and given no record.

The pipeline's constants and `lines.ts`'s are held equal by `test_lines.py`;
the stop list is held to `backbone.tsx`'s by `test_follows.py`; the
Methodology paragraph prints every figure from `lines.ts`.

### The nightly

- The `lines` stage reads the open notices, then, before its one pass over
  the sources, the records that could match: by SQL, those ending near some
  notice's start and coded in a class or family some notice carries, and
  those carrying a number some notice seeks (the separators dropped in SQL,
  then folded exactly; the published contracts through `idx_contracts_buyer`
  for the notices' buyers only). It indexes them by buyer and kind of work,
  each list in order of end, and by buyer and number, so a notice reads only
  its own buyers' records ending in its own window and the records carrying
  its numbers. The kept records' lines join the pass's cells, so the pass
  fills them with the radar rows'.
- `tender_follows` (notice reference in its URL form, lower case; rank; `j`)
  is rebuilt after `expiring_lines`, in a transaction of its own. A fault in
  may follow is raised once the holders' records are written: the stage reads
  as failed, `expiring_lines` is tonight's and `tender_follows` keeps the
  night before's rows. The stage's log row adds the `follow_` counts (open
  notices, records read, notices matched, by degree, kept, matched past 3,
  similar names cut, seconds).
- The records sync writes `rec_follows` (code 19) from `tender_follows`, keyed
  by notice and record. `rec_follows` is in `records_schema.sql`, which the
  nightly applies before each sync: no operator SQL, no full reload, `LAYOUT`
  stays 2. The workflow's count statement (`COUNT_SQL`) names it.
- The review file `holder-lines.txt` gains a section: the counts, then the
  closest match of 100 open notices that have one, sampled by a hash of the
  reference, with both titles, the degree, the holder, what matched, the
  words, the end, the days and the holder's label.
- On the development copy (25 open notices, data date 2026-11-01): 1 notice
  kept 3 records, the design's worked example to the figure (7 of 8 words,
  ending 31 days before the start, Earlier records · 1 earlier; then two
  partial matches of 6 of 9 words), 474 records read, under a second for the
  whole stage.
- At about production's size (an inflated copy: 1.32 million published
  contract rows, 291,600 award notice versions, 295,920 history versions,
  975 notices), may follow's own work took 23 s: the standing offers' numbers
  3.4 s, the SQL that finds the records that could match 7.3 s, reading the
  265,080 it found 10.4 s, indexing and matching 2.0 s. Every copy there ends
  inside the notices' window, which production's records do not, so the copy
  overstates the records read. The stage's log row gives `follow_seconds`
  from the first night; the stage took 43 s on 36,730 radar rows before may
  follow. Reading the numbers of 884 descriptions of 10,000 characters in
  each language takes under 2 s even with a number every 37 characters.

### Where it shows

After the instruments' current holders, before "Earlier awards like this
one", on an open notice's page, for a signed-in reader while the switch is
on: the lead, a table (earlier contract with its source and end; holder; what
matched: the degree in bold over one line each for the number, the buyer or
client department, the classes or families shared, the words shared and the
end date against the expected start or the publication), the disclaimer with
its links to the Terms' No Warranty section and `/methodology#follows`, and
the licence line. Free: the closest one, without its holder's record, and
when more were kept, one line with each plan's figure and a link to the
plans. Pro and Ultra: up to 3, each named holder with its label and figure
under its name, as on the radar. None kept: one line saying so; a notice first
seen after the records database's data date: one line saying it is matched
after the next night; a database that cannot answer: one line; a database
without `rec_follows`: the page as it was. No chip and no filled button are
added. Nothing for a reader not signed in, a notice that is not open, or while
the switch is off. Nothing reaches a static file, a feed, the open or keyed
API, a CSV or a sitemap.

On `/account/matches` (the third slice, `FollowLine` in
`site/src/pages/follows.tsx`), while the switch is on: in the Notice cell of
each listed notice, under its buyer and notice type, one muted line for the
closest earlier contract (rank 1), "May follow <title> (<holder>), ended
2026-10-23" ("Pourrait faire suite à ... terminé le ..."; "ends" for one
still running on the records' data date; no end, no date), the title cut at
60 characters (`FOLLOW_LINE_TITLE`) and linking the notice page's panel
(`/tenders/<reference>#follows`), where it shows with what matched. The
holder is named as the panel names it, a withheld one "Individual, name
withheld"; no holder's record here, on any plan. Free gets it on its 5 rows,
Pro and Ultra on each row of the page they open (50 a page). The page's
disclaimer block, above the matches, gains may follow's disclaimer beside the
matches' once a listed notice carries a line; the licence line is the page's
own. A database that cannot answer: one line under the list; without
`rec_follows`, or with the switch off, the page is byte for byte as before
and reads nothing more.

### Reads and bounds

- A signed-in reader on an open notice with a class, switch on: one statement
  more in the earlier awards' batch (`FOLLOWS_SQL`, three rows at most through
  `rec_follows_tref`, with the holder's and the buyer's names); a notice
  without a class reads it alone. Signed out, or switch off: no read.
- The CPU guard times a Pro reader's notice with three rows at 2.29 times the
  yardstick (bound 10); the same page with the panel off measured 3.25 in the
  next run, inside the machine's noise.
- `/account/matches`, switch on, a ranking listed: one records statement
  (`FIRST_FOLLOWS_SQL`, one batch with the state row), rank 1 of the page's
  notices bound as one JSON list, each found through `rec_follows_tref`, at
  most `FIRST_FOLLOWS_MAX` (`MATCH_PAGE`, 50) rows with the holder's name:
  fewer than the design's 200, since a page lists at most 50. Nothing for an
  account without a claim or a ranking. The CPU guard times a Free account's
  page with its 5 lines at 4.33 against 4.40 without them in the same run
  (measured 2026-11-15; bound 21, the page's own).
- `RULES.follows`: Free 1, Pro 3, Ultra 3 (`followCap`); the plan cards' row
  (`plans.follows_one` or `plans.follows`, after the holder's record) reads
  each plan's figure from it.

### Operator steps

None for the tables. The design's gate, 7 or more of 10 close matches of the
may-follow section of `review/holder-lines.txt` reading as plausible, passed
on the nightly of 2026-11-15 (8 of 10), with the floor of 2 title words
added. `FOLLOWS_PANEL` is "on" and the plan cards carry the row "1 earlier
contract per open notice" on Free, "3 earlier contracts per open notice" on
Pro and Ultra (`plans.follows_one` for a figure of 1, else `plans.follows`),
each figure read from `RULES.follows` and written first, so the ellipsis of a
320 px card never cuts it. The switch reaches the site with the Worker's next
deploy. The floor needs no stamp: the `lines` stage rebuilds
`tender_follows` whole every night and the records sync deletes the
`rec_follows` rows that are gone, so the first nightly after the change drops
the matches the floor removes.

## Weekly briefings

A weekly briefing is one message a week about one UNSPSC segment or one buyer
(optionally narrowed to one segment): the week's new notices, the awards with
their winners and values, the contracts ending next fiscal quarter with their
holders, the notable amendments, the fiscal year's largest records, and the
standing offers and supply arrangements ending within 6 months with their
holders' count. Pro (`delivery`) gets the message; a Free account keeps the
briefing with its email off. The code is `site/src/account/briefings.ts` (the rows, the records
statements, the run, the console figures), `briefing_pages.tsx` (the control,
the searches page's panel, the stop page, the public sample and its message's
frame) and
`digests.ts` `briefingDigest` (the message, in the digest shell); the tests
are `site/test/briefings.test.ts`.

### Subscribing

- Each segment page and buyer page has a Weekly Briefing panel (`Bulletin
  hebdomadaire`) under Email Lists, with a link to this week's sample. With
  the switch off it is not rendered and the page keeps every byte. Not signed
  in: Subscribe links to `/account/sign-in?next=<this page>&brief=<kind>:<subject>`
  (`segment:81`, or `buyer:<id>` for the whole buyer; `briefings.ts`
  `briefOf` reads it by the post's own rules and drops anything else without
  a word). The link is the same for every reader not signed in, so the page's
  public cache is unchanged. The sign-in page, the code form, the emailed
  link and its confirm page carry `brief` beside `next` (and beside `follow`,
  when a sign-in carries both: each is added by its own steps), with a line
  saying that signing in also saves the briefing. After the code or the link
  is verified and the session starts, `POST /account/check` saves that
  briefing for the account the address signs in to, by the post's own steps
  (the label from the data, the shared cap, one briefing of a subject, the
  email off on Free), and audits `briefing_added` with the detail `<kind> at
  sign-in`. At the cap nothing is added and the page shows the cap; a
  briefing saved already stays as it is; a buyer no longer in the data adds
  nothing; any fault in this step is logged without detail and never fails
  the sign-in. The reader lands on `next`, which reads "Briefing saved". No
  GET adds a briefing (*Security posture* has the guards). Free: Subscribe
  saves the briefing with delivery `off`, beside a gate note with the Pro chip
  saying the weekly email is Pro's. Pro: saved with delivery `weekly`, "Sent
  each Monday by email". A buyer's form adds a choice of the whole buyer or
  one of the 57 segments. A subscribed page reads "Subscribed" and links the
  searches page.
- `POST /account/briefings` takes the kind, the subject (checked as the page
  checks it) and a buyer's segment; the label is the site's ("81
  Engineering", a buyer's name from the data, "Fisheries and Oceans Canada ·
  81 Engineering"), never typed. A buyer no longer in the data adds nothing.
- Briefings and saved searches share one cap (3 on Free, 25 on Pro, 100 on Ultra): each
  insert counts both tables inside the statement, so two posts at once cannot
  pass it. `addSearch` does the same (it counts the searches alone while the
  `briefings` table is not on the database yet). Every page states that one
  count, both tables with the same fallback (`searches.ts` `heldCount`): the
  overview's "Saved searches and briefings" row, the searches page's count,
  Save this search and each cap line, which says what the account holds
  ("This account holds 20 of 25 saved searches and briefings"). The plan
  cards' row and the Pro page's answers name both: "25 saved searches and
  briefings, by email".
- `/account/searches` lists the briefings in their own panel: delivery
  (weekly or off; Free sees the gate note), the newest run, Remove. Turning
  delivery on is Pro's (`POST /account/briefings/:id`).
- Nothing turns a briefing's email on by itself: one saved on Free (or with
  its email turned off) stays off after a plan with delivery starts. To such
  a plan, a saved briefing whose email is off says so, "Its weekly email is
  off.", under "Briefing saved" on its page with `Turn it on`, which posts
  `deliver=weekly` and `next` (the page, held to `safeNext`, where the
  answer returns), and under its delivery on the searches page.

### The message

For a subject S at data date D, the span is the data dates after the last
one covered, up to D: seven for a first message, six when the last message
went on a Tuesday (a Monday whose nightly came late), and after a message
that failed back to the last one covered, at most 14. So no day is reported
in two messages.
Each section opens on its heading in a tinted band with its count, in
capitals ("AWARDS THIS WEEK: 19"; the plain-text part in capitals too), and
its rows follow (docs/mail.md, *The shell*).

| Section | Rows | Read from |
|---|---|---|
| New notices this week | the count, then up to 10, soonest closing first, with the buyer and the closing and time left; a line for the rest linking the open notices | `rec_events` kind `notice` by `sid` (segment) or `buyer` in the span, buyer names from `rec_buyers`; a count row counts what it stands for |
| Awards this week | the count, then each source's own figures (count, counted value, how many without one; nothing added across sources), then up to 10 by value with the winner and the buyer (on a buyer briefing, the winner's segment), the value and the source | `rec_events` kind `award` (grants are their own kind and stay out); a count row is a line of its own, not in the totals |
| Contracts ending next quarter | the quarter named ("Q4 2026-27 (January to March 2027)"), the count, total and how many without a value; how many are new to the list this week; up to 10 by value with the holder, the buyer, the end date, the value, the amendments and growth, "new this week" on those new to it; a link to the 6-month radar filtered the same way | `rec_due` for the count and total (a buyer narrowed to a segment: the list's own counts, since `rec_due` holds a buyer or a segment); `rec_expiring` by `endd` in the quarter with `buyer` or the segment mark, through `rec_expiring_end` or `rec_expiring_buyer` |
| Notable amendments this week | up to 10 whose counted value moved by `EVENT_NOTABLE_CENTS` (CA$100,000) or `EVENT_NOTABLE_SHARE` (50 percent) of the value before, largest change first, with before, after, the change and the end date moved | `rec_events` kind `amended` |
| Largest records this fiscal year | the ten largest counted records in the data date's fiscal year, one line each with the other party, the value, the date and the source; then the subject's analytics view | `records` by `sid` (award notices and history, every row of the segment) or `bid` (award notices, history and published contracts, `extra = 0`; narrowed, the segment's rows), the date from `rec_details` |
| Standing offers and supply arrangements ending within 6 months | the count, then up to 10, soonest expiry first, one line each with the agreement number, the type, the description, the end user (on a segment briefing; on a buyer's it is the buyer), the expiry and the active holders, then the instrument's page; a "See all" line linking the instruments index with the same filters | `rec_instruments` with an active holder (`n > 0`), `expiry` from D to 182 days on, carrying the segment (`segs`) or whose end user is the buyer (`buyer`, and the segment when narrowed) |

"Next fiscal quarter" is the quarter after the one D falls in, stable from week
to week; a row is "new this week" when the span holds an `award` event for it
(new to the records) or an `amended` event that moved its end date from
outside the quarter (the 12-month crossing, `ends_12m`, cannot fall in the
next quarter). The last briefing of a quarter adds "The fiscal quarter turns on
2027-04-01; next week's briefing lists Q2 2027-28 (July to September 2027)."
The note repeats the caveats: the newest amendment's value, nothing added
across sources, "ends" is the stated date; a segment briefing adds that a
week's line lists a record under its lowest segment (rec_events carries one);
a narrowed briefing says once that published contracts and grants carry no
segment.

Section 6 uses the instruments index's 6-month window (`WITHIN_DAYS["6"]`,
182 days, both ends included), so its count matches the page its "See all"
link opens: `/instruments?segment=81&within=6`, a buyer
`/instruments?user=<buyer id>&within=6`, a narrowed buyer
`/instruments?segment=81&user=<buyer id>&within=6` (`&lang=fr` added in
French). A row is

```
- E60ZT-120002/001/ZT · Regional Master Standing Offer · Environmental consulting services · Fisheries and Oceans Canada · expires 2027-03-31 · 14 holders
  https://awardwatch.ca/instruments/E60ZT-120002%2F001%2FZT
```

with the number escaped as one path segment; "none" when nothing ends in the
window, and then no link. A segment's statement reads the instruments ending
in the window through `rec_instruments_expiry (expiry)`, a buyer's through
`rec_instruments_buyer (buyer, expiry)`, and sorts its matches for the first
10; `COUNT(*) OVER ()` counts all of them. No index serves the segment, which
is tested on each row of the window.

Subject: `{name} this week: {n} new notices, {n} awards, {n} contracts ending
next quarter` (each part only when not zero); in French `{name} cette
semaine : ...`. The preview line names the awards and the
quarter's count, total and new rows. The footer: "You receive this each week
for a briefing in your account.", the searches page, and the stop link.

### The run

The delivery job's third part (`runBriefings`, after the watch mail and before
the weekly email and the saved views, inside the same cap of 300 messages a
run). For each briefing with delivery `weekly`,
whose account is active, not blocked and on a plan with `delivery`, not
covered since the week's Monday (`BRIEFING_WEEKDAY`; a Monday whose nightly was
late sends on the next data date of the week, and a first subscription sends
on the next run), with no message refused for it since that Monday: one
D1 batch on the records database (the state row and eight statements, seven
for a narrowed buyer; each a constant with the subject bound, each ending in a
`LIMIT` of 10), read once per subject and span in a run. Until that database
is ready at today's data date every briefing waits unclaimed (`records`:
absent, loading, failed, stale; `no_table` before `accounts_schema.sql` is
applied). A briefing with anything in the week's sections or a contract ending
next quarter is sent; one with nothing in either writes `empty` and no message
(the year's largest records and the instruments ending within 6 months alone
are not news: both lists stand from week to week). The claim, the send, `sent`,
`failed` and `empty` are the saved searches': claimed for the week before the
message goes, given back when the send does not go; a refusal that is not a
sending limit writes `failed` and leaves `last_delivered_at`, so next week's
message covers both weeks with the span in its lead. Each run of a briefing is
a `briefing_deliveries` row (kept 90 days); after a message went, the row is
written once more when the write fails. The log line adds `briefings: n
sent, n failed, n with nothing new, n not on a plan with delivery` (and, when
some went grouped, how many of the messages were grouped and how many
briefings they carried).

More than five of an account's briefings with something to send in one run
(`GROUP_OVER`, the saved searches' figure) go in one message, as its saved
searches do (*Phase 2: delivery*, What it sends and writes). An account with
more than five briefings due in the run's list is read whole where its first
one stands, each of its briefings read before any is sent; the plan's figure
and a seat's allowance come first (the briefings past them are passed over as
above), and those left with something to send are counted: more than five go
as one message (`digests.ts` `briefingGroupDigest`), five or fewer go one
message each, exactly as before grouping. Every other account's briefings go
in the list's order, one message each, statement for statement as before
(`site/test/mail-group.test.ts` holds both to what the run sent before this
change). The grouped message:

- is in the account's mail language (`users.lang`); each briefing is named as
  the searches page names it (a segment's name written in that language, a
  buyer's as saved);
- has a section a briefing in the account's order: its name in a band, its
  week's counts linking its subject's page, its first rows (the new notices,
  then the awards, the contracts ending next quarter and the notable
  amendments, each as its own message writes it, so a supplier the records do
  not name stays unnamed), a line for the rest, and its own stop link (`?b=`);
- holds the whole message to 30 rows and a section to 5 (`GROUP_ROWS_MAX`,
  `GROUP_SECTION_ROWS`, the searches' figures; a briefing's row is smaller than
  a search's), and past them names each briefing on one line with its counts
  and its page, so an Ultra account's 100 stay under the size at which a
  webmail client clips a message;
- carries the notes its briefings' own messages carry, once each, the button
  to the searches page, the reason line, and one stop link for the whole
  message (`?gb=`, *Stopping a delivery*) in its footer and in
  `List-Unsubscribe` with its one-click partner;
- counts once against the run's cap, the day's ceiling and the run log's
  `sent`; each briefing keeps its own claim (one batch for all) and its own
  `sent` row (one batch, tried once more on a fault), and a send that does not
  go gives every claim back together, with each one's `failed` row when the
  refusal is not a sending limit. From its claims to its last write it costs
  at most `GROUP_QUERIES` (4) queries: the claims, the stop secrets it lacks
  with the account's language, the rows and their retry.

A briefing read and passed over because its account's plan does not send it
(no `delivery`, or past the plan's figure after a move to a smaller plan) is
marked covered for the week (`last_delivered_at`, no run row, one batch for
up to 100 of them), so the briefings of accounts that moved down do not fill
the 1,000 the run reads ahead of the ones paid for; a plan restored that week
sends from the next Monday. The list (`BRIEFINGS_DUE_SQL`) puts the briefings
of accounts whose cached plan is paid first, as the watch mail's does; the
cache orders and `planFor` decides. A buyer briefing whose buyer the nightly merged
into another is read, and its links written, at the surviving buyer
(`watches.ts` `survivorOf`); its row and its label keep the buyer saved.

The stop link is `/account/stop?b=<briefing id>&t=<secret>`, in the footer and
in `List-Unsubscribe` with `List-Unsubscribe-Post`; it turns that briefing's
email off (the briefing stays on the searches page). GET shows a button; POST
and the one-click body act; a wrong secret is the site's 404. The secret is 16
random bytes made with the first message.

### The public sample

`/pro/briefing-sample` shows this week's briefing for segment 81
(Engineering) as an inbox shows it, built with the same reader and the same
message as a subscriber's, from the seven data dates ending with the site's
data date, headed "A sample of the weekly briefing, built from this week's
data". It is linked from the briefing panels, `/pro` and the Email lists page.

The page holds a reading pane, 640 px wide at most and the screen's full
width on a phone: the inbox's line for the message (the sender's name and
`MAIL_FROM`, read by `sender.ts` `mailSender` as the mail job reads them, the
subject, the preview line), then the message in a frame, with two tabs,
"Light inbox" and "Dark inbox" (`Messagerie claire`, `Messagerie sombre`).
The frame is the message's whole document, served at
`/pro/briefing-sample/message/light` or `/dark` (`?lang=fr` on a French page):
`digests.ts` `briefingDigest`, the subscriber's own builder, with the shell's
view (`mail_html.ts` `Shell.view`). A frame follows the browser's scheme and
not the site's theme switch, so each address forces its scheme, and the
document differs from a subscriber's message in these lines alone:

| Line | A subscriber's message | The sample's frame |
|---|---|---|
| `<meta name="color-scheme">`, `<meta name="supported-color-schemes">` | `light dark` | `light`, or `dark` |
| `<base target="_blank">` after the title | absent | present: links open a new tab, as a webmail client opens them, never inside the frame |
| The dark rules in the head's `<style>` | under `@media (prefers-color-scheme: dark)` | dark: the same rules with no query, as a dark client applies them; light: left out |
| The footer's stop link | `/account/stop?b=<briefing id>&t=<secret>` | `/alerts`, the Email lists page: no briefing, no secret |

The footer's "Briefings and delivery" link is the subscriber's own,
`/account/searches`, which carries nothing about anyone. The briefing's
message prints no mailing address (that line is the weekly email's,
*Weekly email*), so the sample has none either. Without `?scheme=` the page
starts on the site's theme: both frames are in the page (`loading="lazy"`)
and the stylesheet shows the one the theme names. The tabs are links to
`?scheme=light` and `?scheme=dark`; with script, `public/briefing-sample.js`
switches in place, sizes each frame to its message so the page scrolls as
one, and stays on the reader's choice. Without script each frame is 80% of
the window high and scrolls inside the pane. On a phone the frame is as wide
as the screen, so the mail's own narrow rule (`max-width:620px`, read against
the frame's width) lays out the card as a phone's mail app does.

The frame's `sandbox` is `allow-same-origin allow-popups
allow-popups-to-escape-sandbox`: the page reads the document's height, and
its links open an ordinary new tab; no script, form or navigation of the page.
The message route answers with its own `Content-Security-Policy`
(`default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri
'self'; form-action 'none'; frame-ancestors 'self'`), `X-Frame-Options:
SAMEORIGIN` and `X-Robots-Tag: noindex`, set by `sampleFrameHeaders` after the
site's own headers; every other answer, its 404 and 429 included, keeps the
site's.

Neither reads a session (the same page for every reader, the rail's Sign in
item for all), keeps anything about the reader, or reads the records database
more than once (one batch each); both are cached `public, max-age=3600`
(`layout.tsx` `publicPage` for the page). A database that cannot answer gives
the page's shell with "not available right now", and the frame that line
alone, each 503, never stored. With the switch off both are the site's 404.

### Bounds and privacy

Briefings share the saved searches' cap (25 on Pro, 100 on Ultra); 10 rows a section, six sections, so 60 rows a
message; one batch a briefing; 300 messages a run shared with the saved
searches and the watch mail; one fiscal year for the largest records. A
briefing row keeps the kind, the subject (a segment code or a buyer id), the
segment, the site's label, the language, delivery, the last run and the stop
secret; the message names public records and totals, nothing about the
reader. The console's overview counts briefings by kind and delivery and the
last seven days' runs by status; the user page lists the account's briefings
(kind, delivery, added, newest run) and its last 20 runs, never the secret.
Deleting a briefing deletes its runs; deleting the account deletes both
(`deleteBriefingsOf`, before the deletion batch).

Not built yet: the notices' provinces are not in `rec_events`, so a notice's
line names its buyer and closing only.

### Operator step at landing

```
npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
```

Idempotent. It adds `org_claims` and its two indexes. Until it runs,
`/account/organization` answers 503 and the overview leaves its line out;
the watches' cap reads `org_claims` too, so a Follow post answers 503 and
the Follow button and the overview's watches line are left out. Apply it
before deploying.

Idempotent; it adds `briefings` and `briefing_deliveries`. Apply it before
deploying: until then a signed-in reader sees no briefing panel, the run logs
that the accounts database has no briefings table, and saved searches count
against the cap alone.

## Weekly email

One message a week to any account, Free or Pro, that turned it on: what
changed in the week on the pages it follows, or, when it follows nothing or
nothing changed, the site's week in figures; and, for an account that names
its organization, the week's matching notices. It is the only list mail a Free
account can receive. No account is ever enrolled except by its own
choice: existing accounts are not, and nothing turns it on for them. The code
is `site/src/account/weekly.ts` (the choice, the site's figures, the run),
`digests.ts` `weeklyDigest` (the message), `pages.tsx` (the box, the account
page's row, the unsubscribe pages) and `routes.tsx`; the tests are
`site/test/accounts-weekly.test.ts` and the mail suite (`docs/mail.md`).

### Turning it on and off

- The sign-in page's own form (`/account/sign-in`) has a box, never ticked
  by the site, also not after an error: "Send me the weekly email: each
  Monday, what changed on the pages I follow, or the week on the site in
  figures. Each message has a link to unsubscribe." (French: "Envoyez-moi le
  courriel hebdomadaire : ..."). No address ticks it (the page reads no
  `weekly=`). The Follow form on public pages and the Save this briefing link
  have no box.
- A tick rides with the sign-in the way `next`, `follow` and `brief` do: the
  code form carries `weekly=1`, the emailed link carries `&weekly=1` and its
  confirm page carries it to its button, and both pages say "Signing in also
  turns on the weekly email." Nothing is kept until the code or the link is
  verified and the session starts: `POST /account/check` then writes the
  `weekly_mail` row (`via` `sign_in`, `on_at` the time) for the account the
  address signs in to, and audits `weekly_on` with the detail `at sign-in`.
  An email that was off is turned back on; one already on stays as it is,
  with no second audit row. Any fault in this step is logged without detail
  and never fails the sign-in; it is one statement after the session starts.
  "Ask for a new code" does not carry the tick: the box is ticked again.
- The account page (`/account`) has a row "Weekly email" with the state (On
  or Off) and one link-styled button that turns it the other way (`POST
  /account/weekly`, `mail=on|off`, with the CSRF value), and a note on what
  the message holds. The page's one filled button stays its own. Turning it
  on writes `via` `account`; the page says "The weekly email is on. The first
  one goes out on the first Monday after today." The audit rows are
  `weekly_on` and `weekly_off` with the detail `account`.
- Turning it off keeps the row, off, with `off_at`; the record of the choice
  (`via`, `on_at`) is kept while the row is. Deleting the account deletes the
  row.

### The message

In the account's language (`users.lang`), in the site's one mail shell.

| Part | What it holds |
|---|---|
| Heading and span | "Your Week on Award Watch" when a page it follows had news, else "The Week on Award Watch"; "Data dates 2026-10-27 to 2026-11-02." (the seven data dates ending with the data date) |
| The watches' news | "8 updates on 3 of the 4 pages you follow." ("on the page you follow" when it follows one); then one line per watch with news, in the watch mail's order and grouping (`watch_mail.ts` `groupsFor`: single records, organizations, buyers, notices, an event reached twice listed once), at most `WEEKLY_LINES` (5): the watch's name and kind linking its page, and each kind of event with its count ("New award or contract: 2, Contract amended: 1"); a line for the rest ("3 more pages with news are on your watches page"); the button "Open your watches" |
| The site's week | when there is no news: "Nothing changed this week on the 4 pages you follow" linking the watches page, or, for an account that follows nothing, how to follow a page; then four figures, each linking its list: new tender notices (`/tenders/new`), notices closing within 7 days (`/tenders?closing=7`), new award notices (`/awards`), contracts ending within 3 months (`/expiring/3m`) |
| Matching notices | for an account that names its organization (*Your organization*), when some of the week's new notices match: "New open notices this week that match <name>", up to `RULES.free.match_mail` (3) or `RULES.pro.match_mail` (10) rows, how many more are on `/account/matches`, for Free the line on what Pro lists, the disclaimer with the Terms as a full https address, and the licence line (*Matching notices*, By email) |
| What Pro adds | for an account whose plan does not mail its watches (Free) only: "Free: 3 watches and 3 saved searches and briefings, on the site. Pro: 25 watches, each change by email, and 25 saved searches and briefings, by email." (the figure the saved searches and the briefings share, as the plan rows name it) and "Plans and prices" (`/pro`); the figures are read from the plans (`RULES`), each plan's own, never compared |
| Footer | "You receive this because you turned on the weekly email for your account.", the account page, "Unsubscribe" (the stop link), then "Sent by Award Watch, <MAIL_ADDRESS>." on the next line; then the shell's tagline and contact address |

The site's figures, read once a run (`readWeek`): the new notices of the
span's days from `tenders/new/<day>.json`, each notice once, as `/tenders/new`
lists them; the open notices closing within 7 days at the run's time, as
the rail counts them (`stats.json`); the award notices new to the records in
the span, `rec_events` kind `award` with `src = 1` and no count row (one row
per notice whatever subjects it names), through `rec_events_day`; the
contracts in the radar's 3-month window (`expiring/index.json`). A figure
whose file does not read is left out of the list, and the subject then names
no count.

Subject: "Your week: {n} updates on what you follow", or "The week on Award
Watch: {n} new tender notices" ("The week on Award Watch, to {date}" without
that figure); in French "Votre semaine : ..." and "La semaine sur Award
Watch : ...". With matching notices, their count follows after a comma:
"Your week: 8 updates on what you follow, 12 matching notices", "The week
on Award Watch: 412 new tender notices, 12 matching notices", "The week on
Award Watch, to 2026-11-02, 1 matching notice" ("..., 12 avis
correspondants"); it counts every match of the week, listed or not, and is
left out first when the two would reach 100 characters (`fitCounts`). The
message carries `List-Unsubscribe` and `List-Unsubscribe-Post` as the other
list mail does.

### The run

The delivery job's fourth part (`runWeekly`, after the briefings and before
the saved views (*Saved views*), inside the
same cap of 300 messages a run, and held to `WEEKLY_RUN_MAX`, 100, of them;
`WEEKLY_ACCOUNTS_MAX`, 1,000 accounts read). An account is due when its email
is on, the account is active and not blocked, the week (its opening day,
Monday, `briefings.ts` `weekAnchor`) is not covered yet, no message to it was
refused that week, and the email was turned on before that Monday: the first
message goes on the first Monday after the choice. So it goes on Monday's
first run, or, when Monday's nightly came late or the ceiling left it
waiting, on the next data date of the same week; never twice in a week. The
records database must be at today's data date (the watches and the award
figure read it); until then every account waits unclaimed, as the briefings
do. The matching notices read only the claim, the profile and the open
notices (*Matching notices*, By email); an account with nothing from its
watches and no figure still gets its message when they have a row.

Each account is claimed for the week before its message goes (one statement
that holds only while the email is on, the account active and the week not
covered), so two runs at once send it once; a send that does not go gives
the claim back. A refusal that is not a sending limit marks the week
(`failed_week`), so the account waits for next week; `E_DAILY_LIMIT_EXCEEDED`
or `E_RATE_LIMIT_EXCEEDED` stops the run and the next hour goes on. After a
message went, `last_status` is written once more when the write fails. Like
the other parts, it takes up no account past the run's query budget (*Phase
2: delivery*, What it sends and writes), and it stops at the day's sending
ceiling as the other parts do (*Sending mail*). A deleted account is never
due: its row goes with it, and the list reads active accounts only. The list
keeps its order of choice (`on_at`): every plan gets the email, so no account
is passed over on its plan to fill it ahead of another.

The run's log line adds `weekly email: n sent, n failed`, and, when accounts
waited, how many and why (the records database, `MAIL_ADDRESS` not set, or
nothing to send). Until `weekly_mail` exists the run reads nothing of it and
its line is the line without the feature.

### Unsubscribing

The link is `/account/stop?e=<user id>&t=<secret>`, in the footer and in
`List-Unsubscribe`. The secret is 16 random bytes made with the first
message, kept in clear as the other stop links' are; it turns this
account's weekly email off and nothing else. `GET` shows one button and
changes nothing; `POST` and the one-click body (RFC 8058) turn the email off,
audit `weekly_stopped` with `link` or `one_click`, and answer the page or a
line of text. A wrong secret, a deleted account or a database without the
table is the site's 404. `STOP_LIMIT` counts both methods.

### The mailing address

Canada's anti-spam law asks a commercial message to name its sender and a
postal mailing address. The address is the Worker secret `MAIL_ADDRESS`
(`env.ts`), read by `weekly.ts` `mailAddress` for each run: one line as the
footer prints it, spaces collapsed and a closing period dropped, at most 200
characters. It is never written into the repository, a workflow or a log.
While it is unset no weekly email is sent: the accounts due wait, and the
run's line says `MAIL_ADDRESS is not set`.

### Privacy and bounds

The row keeps whether the email is on, where and when it was last turned on,
when it was turned off, the week of the last message and whether it was
sent, the week a message was refused, and the link's secret; the message
names public records and figures only, and no copy is kept. The privacy page
says so. 5 lines of watches a message, 4 figures, 3 matching notices on
Free and 10 on Pro, 100 messages a run, 1,000 accounts read a run.

### Operator steps

1. Create the table (idempotent; the schema's other tables already exist):

   ```
   cd site
   npx wrangler d1 execute awardwatch-accounts --remote --file=accounts_schema.sql
   ```

   Until it runs, the feature is left out whole: no box on the sign-in form,
   no row on the account page, the unsubscribe link answers 404, and the
   delivery run reads and logs nothing of it.
2. Set the mailing address, one line, as it should print:

   ```
   cd site
   npx wrangler secret put MAIL_ADDRESS
   ```

   A secret rather than a variable, so the address never shows in a public
   workflow's log; a deploy keeps it. Until it is set nothing is sent, and the
   Monday mail check reports the weekly email `stubbed` with
   `no_mail_address` (`docs/mail.md`).

Checking a week:

```
npx wrangler d1 execute awardwatch-accounts --remote --command "SELECT mail, last_week, last_status, COUNT(*) AS n FROM weekly_mail GROUP BY mail, last_week, last_status ORDER BY last_week DESC LIMIT 20"
```
