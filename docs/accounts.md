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
  added by pasting a page's address; the site rebuilds the filter and writes
  its label, as the alerts form does. Requests made earlier through the
  alerts form are offered for import after sign-in.
- **Delivery by email.** On the Pro plan, any saved search can be sent
  daily or weekly: a tender list, a list of contracts ending, or the new
  records of an organization, a buyer or a segment (*Phase 2: delivery*).
  Every message carries a link that turns its delivery off without signing
  in.
- **Watches.** Any account follows up to 3 organizations, buyers,
  published contracts or open tender notices (Pro, 25) and sees what
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
  A public sample is built live at `/pro/briefing-sample` (*Weekly
  briefings*).
- **Calendar feeds.** On the Pro plan, a saved tender search becomes an
  address a calendar app subscribes to, its open notices' closings as
  events (*Calendar feeds*). Every notice and contract page also offers its
  closing or end date as a one-event file, to any reader.
- **API keys.** Issued and revoked on the account; shown once. A key of a
  Pro account opens the keyed API under `/api/v1` (*The keyed API*); the
  keys page shows each key's requests today and over 30 days.
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
steps*).

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
| `feeds` | one row per calendar feed: kind (`search`, `watchlist`, `all`), the saved search it follows, the address's secret, created and revocation times, the UTC day a calendar last read it | a time of reading, an address, a user agent |
| `org_claims` | one row per account that named its organization: the organization id, up to five organization ids to compare it with, the share block's segment, when it was chosen and last changed (*Your organization*) | anything typed, a name, any sign of which other accounts chose the same organization |

Limits: at most 25 saved searches per account (Free keeps 3), at most 5 live
API keys, at most 5 sign-in requests per address per hour, at most 5 wrong
codes per address per hour across all its requests, at most 5 bug reports
per account in any 24 hours, at most 600 keyed API requests a minute and
20,000 a UTC day per key.

Retention: sign-in requests and wrong tries are deleted after a day (and
with the account); sessions 90 days after they end; audit rows after 90
days; bug reports after 180 days (and with the account); the keyed API's
daily counts after 60 days (and with the account's keys, by the table's
cascade). The sweep runs with each sign-in request.

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
   days from the last use, at most once an hour. The `__Host-` prefix makes
   a browser refuse the cookie unless it is `Secure`, on `Path=/` and
   without a `Domain`, so no other host under the domain can set or shadow
   it. A session the browser already held, for this account or another,
   is revoked when the new one starts.
6. `POST /account/sign-out` ends the session on this browser, or on every
   browser (`scope=all`).

Both sign-in posts count against `AUTH_LIMIT` (5 a minute per address) while
the switch is on. Every signed-in form carries a CSRF value derived from the
cookie's secret, checked on the post.

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
`/data/expiring/12m/` answer the site's 404, and `/downloads/expiring-12m.csv`
the download route's 404. A Pro request gets the full pages and the files
(marked `private, no-store`). The overview, the 3-month window, its CSV
(`expiring-3m.csv`, which the overview, the 3-month list and the free view
link) and the feeds (which carry the 3-month window only) stay free.
`wrangler.jsonc` runs the Worker first for those two folders and the
12-month CSV so it can refuse them; while the switch is off it passes them
on as they are. `site/test/radar-gate.test.ts` proves both states.

The analytics views (`/buyers/<id>/analytics`, `/organizations/<id>/analytics`,
`/segments/<nn>/analytics`, feature `analytics`, `site/src/plan.ts`
`analyticsAccess`) exist only while the switch is on: off, each address and
each of their CSV files is the site's 404 and no page links them. On, the
buyer, profile and segment pages link them with the word Pro marked, and a
request without the feature sees each view's first chart for the latest
three fiscal years and a line on each other chart, with a link to
`/account/billing` (signed out, `/account/sign-in`); the CSV files answer
404 to it. `site/test/analytics.test.ts` proves both states
(`docs/analytics.md`).

While the switch is on, whatever leads to a page that comes with Pro
carries the Pro chip (`site/src/pro.tsx`), for every reader: the rail's
entries for the 6- and 12-month windows (each with its own count; the
"Contracts ending" parent has none), for `/tenders/same-day` and for the
Email lists, the radar's 6- and 12-month tabs and overview tiles, and the
links to the 12-month list on profiles and buyer pages. The free view's
panel names the price from `PRICE_MONTHLY_CAD` and `PRICE_YEARLY_CAD`,
taxes added at checkout, and leaves the line out when the checkout would
offer no price. On the Data page the 12-month file's row carries the chip
and, for a request without the feature, leads to the 12-month list's free
view; the file's own address still answers 404. A Free account's overview
lists API keys and bug reports with the chip, and its saved searches carry
one-line notes at the cap and in the delivery column.
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
`site/src/account/strings.ts`. It mirrors the sign-in prototype in
`design/email/`: the same tables, inline styles and dark-mode rules, the
code in a ruled band, a button carrying the link, and a footer with the
reason for the message, the site's tagline and the contact address. The
prototype's plain-text file is the shape of the plain-text part. A change to
the message belongs in `design/email/build.py` as well; running
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
   deletion goes on without them.
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
6. **Turn the switch on**: set `"ACCOUNTS_ENABLED": "true"` in
   `site/wrangler.jsonc` and deploy. Turning it back off hides everything
   again at once; the data stays. Before it, check:
   - `accounts_schema.sql` applied again on the account (step 1), so the
     tables added since the first application exist: `code_misses` (the
     hour's wrong codes; without it every code check answers "cannot be
     reached"), `delivery_tokens`, `delivery_marks`, `payment_customers`,
     `payment_events` and `payment_reversals`;
   - with payments set up (*Payments*, *Operator steps*): the webhook
     endpoint's six events, `charge.refunded` and `charge.dispute.created`
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

## Security posture

- **No passwords.** The only credential is control of the inbox. Losing the
  address is the one case with no self-serve path.
- **Hashes only.** Codes, link secrets, session secrets and API keys are
  stored as SHA-256 hashes and compared in constant time. A copy of the
  database signs no one in and holds no usable key.
- **Short-lived, single-use codes.** 15 minutes, one use, 5 wrong tries an
  hour per address, whatever requests it holds.
- **Rate limits per address and per email.** `AUTH_LIMIT` (5 a minute per
  IP address) on both sign-in posts; 5 requests an hour per email in the
  database. The keyed API adds `KEY_LIMIT` (600 a minute per key, keyed by
  the key's id) on top of `API_LIMIT` (60 a minute per address), and a
  daily quota per key in the database (*The keyed API*).
- **Cross-site posts refused.** Every POST checks `Origin`; the session
  cookie is `SameSite=Lax`; every signed-in form carries a CSRF value.
- **No account enumeration.** The sign-in page answers the same whether or
  not the address has an account, and the per-email limit applies to every
  address alike.
- **Sessions are revocable.** Sign out on one browser or on all of them;
  deletion revokes every session.
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

`/account/delete` asks for a ticked box, deletes the account's watches, its
claim of an organization and its calendar feeds (statements of their own,
so a database without those tables still deletes the rest), then in one
batch: revokes every
session; deletes the saved searches (with their delivery rows, stop links
and records marks), the API keys (their daily counts go with them, by the
cascade on `api_usage`), the bug reports, the watches and the watch mail row, and the address's sign-in requests; and marks the user row deleted with its
email replaced by `deleted:` and SHA-256 of a random salt and the address,
the salt thrown away. The row then proves nothing about which address it
was, and the address can sign up again as a new account. The address's rows
in the alerts form's table are deleted too. The entitlement rows stay, tied
to the user id alone, as the record of what was granted. A Pro subscription
that can still bill is cancelled at Stripe before any of this, and the
account is kept if Stripe cannot confirm it (*Payments*).

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
message, 429), then sends the operator a plain-text message through the
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

## Phase 2: delivery

The delivery job is `site/src/account/deliveries.ts`; the messages are
`site/src/account/digests.ts`, built on the approved designs in
`design/email/` (the daily digest and the radar digest; the records digest
uses the same shell and rows); the records side of the organization, buyer
and segment kinds is `site/src/account/records_deliveries.ts`; the tests are
`site/test/accounts-deliveries.test.ts` and
`site/test/accounts-records-deliveries.test.ts`.

### When it runs

The Worker has two cron triggers (`site/wrangler.jsonc`): `0 6 * * *`, the
daily check, and `0 15-20 * * *`, the deliveries. `index.tsx` sends the
hourly trigger to the job and any other to the daily check. The nightly
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
3. For each saved search, oldest first: delivery `daily` or `weekly` (every
   kind can be delivered, below), an active account whose plan allows
   `delivery` (`planFor`, so a lapsed or revoked plan stops at once), and
   due: not delivered for this data date (the date of `last_delivered_at`
   is earlier); for weekly, never delivered or last delivered seven or more
   days before. A search whose message failed for this data date waits for
   the next data date.

### What each kind delivers

For the tender and radar kinds the items are the records since the previous
delivery's data date, at most seven days back; a first daily delivery covers
the data date alone, a first weekly one the last seven days.

| Kind | Read from | Items |
|---|---|---|
| `tenders` | `tenders/new/<day>.json` for each day after the previous delivery's data date up to today's | the notices first seen on those days that match the saved filter, read by the same parser as `/tenders` (`readTenderQuery`, `filterTenders`), still open at the run's time, soonest closing first; a notice closing within 7 days of the data date shows its time left in amber |
| `expiring` | `expiring/<window>/index.json` and its pages, read from the last page back | the window's contracts whose end date is inside the window at today's data date and was outside it at the previous delivery's data date (the window's length is the radar's, 91, 182 or 365 days), filtered as the radar's form saved them (`readExpiringQuery`, `filterExpiring`), newest end first |
| `organization` | the records database (`RECORDS`): `records` through `records_org`, rows with `extra = 0` | award notices, PSPC contract history, published contracts and grants naming the organization: each source and fiscal year whose count rose since the last delivery |
| `buyer` | the records database: `rec_buyer_quarters` | the buyer's award notices, contract history and published contracts (its label names no grants), the same way |
| `segment` | the records database: `rec_segment_years`; and `tenders/new/<day>.json` as for a tender search on `/tenders?segment=<nn>` | award notices and contract history in the segment, the same way, and the segment's new tender notices, which its label names too |

A file that does not read (today's new-notice file, a window's index or
page) ends the run with one log line naming it; the next hour tries again.

#### Organizations, buyers and segments

The records database holds one row per counted record with its source and
fiscal year, but no day the record was first seen, no title and no
reference, and no published file dates a record's first sighting either. So
these kinds cannot list the records added since the last delivery one by
one. What the database can say exactly is how many records each source
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
  subject names how many more records in all. A count that fell (a record
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
- Otherwise one message per saved search, in the search's language, through
  the accounts sender (`senderFor`, the `MAIL` binding), with the subject,
  rows, button, note and footer of the design. A message lists at most 50
  rows; past that, a line names how many more and links the page. A
  `deliveries` row `sent` (with the number of records matched; for the
  records kinds, the records added plus the notices) moves
  `last_delivered_at`; `failed` leaves it, so the next data date's delivery
  covers what this one missed.
- At most 300 messages a run. A refusal with `E_DAILY_LIMIT_EXCEEDED` or
  `E_RATE_LIMIT_EXCEEDED` stops the run with no row for that search, and
  the next hour goes on from there. Any other refusal is a `failed` row.
- A fault reading or writing the accounts database logs one line and ends
  the run. A second run in the same hour finds nothing due.
- Each search is claimed for the data date before its message goes: one
  statement sets `last_delivered_at` to the run's time only while no run has
  delivered it for that date, so two runs at the same moment (a trigger
  fired twice) send it once. A send that does not go, or a fault after the
  claim, gives `last_delivered_at` back as it was.
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
  delivery off and says so.
- The same `POST` with the body `List-Unsubscribe=One-Click` (RFC 8058, as
  a mail client sends it) turns the delivery off and answers a line of
  text, with no page.
- A wrong, malformed or stale link (a deleted search or account) answers
  the site's 404. No session and no `Origin` are asked for: the secret is
  the proof, and it can only turn that one delivery off.
- Both methods count against `STOP_LIMIT` (20 a minute per IP address)
  while the switch is on: each request reads the database, and one-click
  posts come from the mail providers' servers.

A reply to the `mailto:` address reaches the contact inbox, where the
operator turns the delivery off by hand.

### The searches page

Each search shows its newest delivery under its delivery select: when it
ran and whether it was sent (with the number of records), found nothing new,
or could not be sent. Every kind has the select.

### Checking a run

```
npx wrangler d1 execute awardwatch-accounts --remote --command "SELECT substr(sent_at, 1, 10) AS day, status, COUNT(*) AS n, SUM(items) AS items FROM deliveries GROUP BY day, status ORDER BY day DESC LIMIT 20"
```

The Worker's logs hold one line per run: the data date and the counts sent,
failed, with nothing new and not on a plan with delivery, and, when the
records database kept some waiting, how many organization, buyer or segment
searches wait and why.

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
rows come from one statement, `WATCH_ENDS_SQL` in `feeds.ts`: every
organization and buyer watch of the account in a slot of three bound values
(the target, the segment mark, the horizon's last day; 25 slots, 77 values,
within D1's 100), through `rec_expiring_end` over the window's dates, soonest
first, at most 500 rows, with `COUNT(*) OVER ()` giving how many matched, so
the cap's last event counts the rows past the ones read. Single published
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
  values), one row per instrument and holder organization with its regions'
  names, soonest first, at most 500, with `COUNT(*) OVER ()` for the cap's
  last event. `rec_holders` has no index by organization, so the statement
  reads `rec_instruments` whole (a few thousand rows) and each instrument's
  holders through `rec_holders_instrument`; an index on `rec_holders (oid)`
  would let it seek, and is the operator's to add. UID
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
unsubscribed and no row marked `notice_at`, in address order. An address
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

Plain text and plain HTML (no design shell), in the language of the
address's first sign-up, through the accounts sender (the `MAIL` binding;
the log sender on a local run): accounts are open; the lists the address
signed up for (their labels as the site wrote them, ten at most and a line
for the rest); that signing in with the address offers each list to the
account as a saved search, and that email delivery of a saved search is
part of Pro (no price); the sign-in page's address; that this is the only
message about the lists, with the link to leave them; why it came, the
tagline and the contact address. The links are the site's (`SITE_URL`, or
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
list would get it. The page offers no form while mail cannot leave (the
stub sender) or while the `interest` table has no `notice_at` column. A
run writes the audit row `operator_announced` with no user id and the
detail `by <operator's user id>, <n> sent, <n> not sent, <n> holding an
account, <n> left`, and the page shows the same figures after it.

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
   npx wrangler d1 execute award-watch --remote --command "SELECT COUNT(DISTINCT email) AS sent FROM interest WHERE notice_at IS NOT NULL"
   ```

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

### Endpoints

| Endpoint | Reads | Parameters | Bounds |
|---|---|---|---|
| `GET /api/v1/tenders/open` | `tenders/open.json`, filtered as the tender list filters it | `category`, `segment`, `province` (each repeatable), `national`, `code`, `buyer`, `type`, `method`, `closing`, `q`, `sort`, `page` | 100 rows a page; `q` at most 100 characters, matched in memory |
| `GET /api/v1/tenders/new` | `tenders/new/<day>.json` | `day` (one of the 30 days to the data date, the newest by default), `page` | 100 rows a page |
| `GET /api/v1/expiring/{3m,6m,12m}` | the window's index and one page file | `page` | 100 rows a page, inside one 500-row file; the deeper windows also need `radar_depth` |
| `GET /api/v1/search` | the hosted search's own statements (`site/src/search_db.ts`) | `q` (required, at most 200 characters, folded to eight words), `page` (1 to 200) | 50 organizations a page; buyers on page 1 |
| `GET /api/v1/organizations/{id}/records` | the records database (`ORG_RECORDS_SQL`) | `source` (required: `awards`, `history`, `contracts`, `grants`), `year`, `page` (1 to 50) | 100 rows a page; the ten fiscal years ending with the data date's, or the one asked for; through `records_org` |
| `GET /api/v1/buyers/{id}/records` | the records database (`BUYER_RECORDS_SQL`) | as above | as above, through `records_buyer` |
| `GET /api/v1/me` | nothing past the checks | none | the key's prefix, plan, plan end, the day's count, the limits |

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
   the UTC day at 1 or adds one while the count is under 20,000. At the cap
   no row comes back and nothing is written: a 429 with `Retry-After` set to
   the seconds left until 00:00 UTC. A write that fails lets the request
   through uncounted (fail open), and `/me` then reports `requests: null`.

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
addresses.

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

Pro is sold as a subscription through Stripe, monthly or yearly, under
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
| `GET /account/billing` | session | The plan today. Without a subscription: what Pro includes, a monthly and a yearly button with the configured prices and "Taxes added at checkout". With one: its status, the end of the period paid and a button to Stripe's portal. Without the keys or the prices: "Paying for Pro is not available yet." |
| `POST /account/billing/checkout` | session, CSRF, Origin | Creates a Checkout Session and redirects (303) to it, under an `Idempotency-Key` naming the user and the ten minutes the request falls in: two checkouts started together get the one session, and one with other choices (the other interval, the other language) in the same minutes gets "A checkout with other choices was started from this account a moment ago" (409). A user whose subscription can still bill is sent to Stripe's portal instead (a billing page left open from before the subscription would otherwise start a second one). |
| `POST /account/billing/portal` | session, CSRF, Origin | Creates a portal session for the stored customer and redirects (303) to it. |
| `POST /account/billing/webhook` | Stripe's signature; `WEBHOOK_LIMIT`, 120 a minute per address, while the switch is on (Stripe retries a 429) | Takes Stripe's notices. |

All four are the site's 404 while the accounts switch is off. The overview
(`/account`) shows "Pro, paid until <date>" when a live Stripe row decides
the plan, the date being the end of the period paid, and links the billing
page in either case.

The Checkout Session is `mode=subscription` with the chosen price and
quantity 1, `client_reference_id` and `subscription_data[metadata][user_id]`
set to the user id, the user's address in `customer_email` (or, for a
returning subscriber, the stored `customer`), `success_url`
`/account?billing=done`, `cancel_url` `/account/billing`, and `locale` `en`
or `fr-CA` from the page language. No `automatic_tax` and no
`customer_update[address]`: under Managed Payments the service computes and
collects the tax itself from the address Checkout asks for, and its
documentation lists both among the parameters an integration must not
send. The portal session names the stored customer, returns to
`/account/billing` and opens in `en-CA` or `fr-CA`.

The site's Content-Security-Policy keeps `form-action 'self'` on every page,
except that the billing pages also allow `https://checkout.stripe.com` and
`https://billing.stripe.com` while the switch is on and the keys are set: a
browser applies `form-action` to the redirect after a form post, so without
them the 303 to Stripe would be blocked. A custom Checkout domain in Stripe
would need its host added there (`site/src/account/stripe.ts`); a session
URL on any other host is refused with the "could not be reached" page.

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
| `checkout.session.completed` | Binds the customer and subscription to the user named by `client_reference_id`, reads the subscription from Stripe for its status and period end, and, when the session is paid and the subscription active, writes a Pro row from now to the period end plus 3 days of grace. A session still unpaid (a bank debit clearing) grants nothing; its `invoice.paid` grants. An account deleted while Stripe's page was open has the new subscription cancelled at once. |
| `invoice.paid` | Extends the subscription's live row to the paid period's end plus 3 days (never shortening it), or writes a row when none is live (a first period whose checkout notice has not arrived, a renewal paid after a lapse). Nothing for a subscription already canceled or expired, nor for a payment already reversed: its charge is in `payment_reversals`, or the customer has a reversal taken at or after the invoice was paid (a notice delayed past its refund names no charge in current API versions). A checkout made before a reversal of its customer grants nothing either. |
| `customer.subscription.updated` | Records the status and the period end. `canceled`, `unpaid` or `incomplete_expired` sets the live row's end to now. `past_due` changes nothing: Pro runs to the end of the grace while Stripe retries the card. |
| `customer.subscription.deleted` | Sets the live row's end to now. |
| `charge.refunded` | When the charge is refunded in full (`refunded` true, or `amount_refunded` reaching `amount`): records the charge in `payment_reversals` and sets the end of every live Stripe row of the account bound to the charge's customer to now. A partial refund changes nothing. |
| `charge.dispute.created` | The same as a full refund, for the account bound to the disputed charge's customer (the charge is read from Stripe for it; a failed read answers 500 and the notice comes again). |
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
- **Deleting an account cancels its subscription first.** `POST
  /account/delete` cancels a subscription that can still bill (immediately,
  no refund) before anything is deleted; if Stripe cannot confirm it, the
  account is kept and the page says to try again, so a deleted account is
  never charged again.

### What is kept

`payment_customers` holds Stripe's ids, the subscription's status and the
end of the period paid; `payment_events` holds Stripe's event ids and types;
`payment_reversals` holds the charges refunded in full or disputed, with
their customer ids.
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
   `customer.subscription.deleted`, `charge.refunded` and
   `charge.dispute.created`, endpoint URL
   `https://awardwatch.ca/account/billing/webhook`. Reveal the signing secret
   (`whsec_...`).
6. **The two secrets**, from `site/`:

   ```
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

   A restricted key (`rk_live_...`) with write access to Checkout Sessions,
   the customer portal and Subscriptions, and read access to Charges (a
   dispute names its charge, which is read for the customer), is enough,
   and holds less than the account's full secret key.
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

- Two checkouts started together share one session through the
  idempotency key, and once a subscription is bound the checkout button
  sends the user to the portal. Two subscriptions can still come from
  checkouts started either side of a ten-minute boundary, or one finished
  and one started before its notice arrived. The second is bound only if
  the first has ended; the audit records "stripe second subscription".
  Cancel the extra one in the dashboard, then refund it. A Stripe failure
  is kept under the same key, so a checkout that failed answers the same
  way until the ten minutes have passed. A full refund ends every live Stripe row of
  the account bound to the charge's customer, whichever subscription the
  charge paid for: when both subscriptions share the customer, grant the
  rest of the paid period by hand afterwards.
- Prices change in Stripe (a new price, then the variables); existing
  subscriptions keep their price until moved in the dashboard.

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
| Grant Pro by hand | A `manual` entitlement row from now to the start of the end date given (UTC), or with no end. The reference is required: at most 120 characters, and any value holding `@` is refused, since a reference never holds an address. The same row as the insert under *Granting a plan by hand*. |
| Revoke | Sets `revoked_at` on one row not yet revoked or ended. Revoking a Stripe row leaves the subscription billing, and its next paid invoice grants Pro again: cancel the subscription as well. |
| Cancel the subscription (confirm) | At the period end (`POST /v1/subscriptions/<id>` with `cancel_at_period_end=true`): Pro runs to the end of the period paid, then Stripe's `customer.subscription.deleted` notice ends it. At once (`DELETE /v1/subscriptions/<id>`): Stripe ends it now and the stored row reads `canceled`; the same notice ends Pro, usually within a minute. Neither refunds anything. |
| Refund the latest payment (confirm) | The page reads the latest paid invoices of the subscription (`GET /v1/invoices?subscription=<id>&status=paid&expand[]=data.payments`) and takes the newest that took money; its charge comes from the invoice's payments, or, for a payment through a PaymentIntent, from `GET /v1/charges?payment_intent=<id>`. It shows the invoice, the charge, the amount and what is refunded already. The post finds the charge again, refunds only if it is still the one shown, and calls `POST /v1/refunds` with `charge=<id>` and the header `Idempotency-Key: operator-refund-<charge id>`, so a second press or a retry within Stripe's 24 hours returns the first refund. Stripe's `charge.refunded` notice then ends the account's Stripe Pro (*What each notice does*). The subscription is not cancelled. |
| Block (confirm) / Lift the block | A row in `account_blocks` with the reason (required, at most 200 characters, no `@`). In one batch: every session revoked, and email delivery turned off on every saved search that had it, the list kept in the row. While it stands, a code or a link for the address gets the "expired" answer any stale code gets, the sign-in page itself answering as for any address; the account's API keys answer 401; the delivery job, which reads only searches whose delivery is on, sends nothing. Lifting the block deletes the row and turns delivery back on for the searches it turned off that are still off. Entitlements and the subscription are left alone. |
| Change the address (confirm) | The new address is normalized as sign-in does, at most 254 characters, and refused when any account holds it. The old address's open sign-in requests and wrong tries are deleted and every session is revoked. When mail can be sent (the `MAIL` binding and `MAIL_FROM`, or the log sender locally), the new address gets a plain message in the account's language saying the site's operator changed the account's address, with the sign-in page and the contact address. The old address is not written to, and can sign up again as a new account. |
| Sign out everywhere | Every session of the account revoked. |
| Delete (confirm) | Exactly the reader's own deletion (*Deletion*): the subscription cancelled first or nothing deleted, then the rows deleted and the address hashed, then every session revoked. A block ends with it. |

### What the console shows

- `/admin`: active, deleted and blocked accounts; signed-in browsers; the
  accounts on Pro now by the source of the row that decides their plan
  (by hand or through Stripe); subscriptions by their last notified
  status; deliveries sent and not sent in the last 7 days; bug reports in
  the last 7 days and in all, with the latest 10, once the `bug_reports`
  table exists; calendar feeds by kind and read in the last 7 days, once
  the `feeds` table exists; sign-in codes issued today (UTC); the last 20 audit
  events; and a search by user id or by address, exact or by its start.
- `/admin/accounts`: every account in one table, filtered, sorted and
  paged, with a CSV of the same view (*The accounts table*, below).
- `/admin/users/<id>`: the user row (address, created, last seen,
  language, status, cached plan), the plan `planFor` computes, every
  entitlement row with a revoke button on those not revoked or ended, the
  `payment_customers` row and, with the Stripe keys set, the
  subscription's status, period end and pending cancellation as Stripe
  holds them now; sessions (signed in now, the newest use, device
  classes); saved searches with their delivery and last delivery; API keys
  (prefix, created, last used, revoked); calendar feeds (kind, created,
  revoked, last read, never the secret); the last 20 deliveries; the
  account's bug reports; the last 50 audit rows; and whether it is
  blocked, since when, by whom and why.

The console never shows card data. The Stripe objects it reads are used
for ids, statuses, dates, an amount and its currency, shown once and not
kept; nothing from a charge's card or billing details is read into the
page.

### The accounts table

`/admin/accounts`, linked from the overview, lists every account, 50 to a
page, newest sign-up first. Its columns: the address (linked to the
account's page), the plan now, status, blocked (with the block's date),
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
| `sort` | `address`, `plan`, `status`, `blocked`, `created` (the default), `sign_in`, `searches`, `delivery`, `keys`, `subscription`, `language` |
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
write, and Invoices and Charges read. Without the Stripe secrets the
user page shows the stored row alone and offers no cancellation or
refund.

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
Every signed-in account keeps watches: 3 on Free, 25 on Pro (`watchlists`,
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
  Not signed in: a link to `/account/sign-in?next=<this page>`; the sign-in
  form, the code form and the emailed link carry `next`, and a sign-in returns
  there (a path on this site only, never the sign-in pages). Signed in: a form
  that posts the kind and the target with the session's CSRF value; a buyer's
  form adds a choice of the whole buyer or one of the 57 segments. The label
  is read from the data, never typed. A followed page reads `Following` and
  links the watches page. A Free account at its cap sees the cap with the Pro
  chip instead of the button; Pro at 25 sees the cap.
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
  account holds 26 watches at most; the events statements read 26 subjects of
  a kind (`TARGET_SLOTS`).
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
counts what it stands for). Nothing new writes `empty` and sends nothing: no
empty message is ever sent. The account is claimed for the data date before
its message goes (`watch_mail.last_day`), given back when the send does not
go; a refusal that is not a sending limit sets `failed_day` and the account
waits for the next data date. Each run of an account is a `watch_deliveries`
row (kept 90 days). Until the records database is ready at today's data date
(absent, loading, failed, stale) every account waits unclaimed and the run's
report says why (`watch.records`).

Subject: `{n} watchlist events: {first two watch labels}` (`1 watchlist
event: {label}`); in French `{n} événements de suivi : ...`. Each row: the
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
  records by fiscal year, each source apart (`ORG_COUNTS_SQL`); records by
  segment, award notices and PSPC contract history apart, each record once
  in its first segment, with the published contracts and grants (no segment)
  counted beside; the share of one segment's counted value by fiscal year
  for the organization and its competitors, in their order, with the
  segment's whole value as the denominator (supplier-withheld records count
  in it and in nobody's share; an organization with no record in a year
  shows 0%), one source at a time (award notices by default, PSPC contract
  history as a tab), the segment chosen or else the organization's largest;
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
day (a day one of its weekly watches is due, or Monday for an account whose
watches are all daily, `WEEK_OPENING_DAY`) and sends a message that would
otherwise be empty when the block has a line; a fault in reading it leaves
the message without the block.

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
## Weekly briefings

A weekly briefing is one message a week about one UNSPSC segment or one buyer
(optionally narrowed to one segment): the week's new notices, the awards with
their winners and values, the contracts ending next fiscal quarter with their
holders, the notable amendments, the fiscal year's largest records, and the
standing offers and supply arrangements ending within 6 months with their
holders' count. Pro (`delivery`) gets the message; a Free account keeps the
briefing with its email off. The code is `site/src/account/briefings.ts` (the rows, the records
statements, the run, the console figures), `briefing_pages.tsx` (the control,
the searches page's panel, the stop page, the public sample) and
`digests.ts` `briefingDigest` (the message, in the digest shell); the tests
are `site/test/briefings.test.ts`.

### Subscribing

- Each segment page and buyer page has a Weekly Briefing panel (`Bulletin
  hebdomadaire`) under Email Lists, with a link to this week's sample. With
  the switch off it is not rendered and the page keeps every byte. Not signed
  in: Subscribe links to `/account/sign-in?next=<this page>`. Free: Subscribe
  saves the briefing with delivery `off`, beside a gate note with the Pro chip
  saying the weekly email is Pro's. Pro: saved with delivery `weekly`, "Sent
  each Monday by email". A buyer's form adds a choice of the whole buyer or
  one of the 57 segments. A subscribed page reads "Subscribed" and links the
  searches page.
- `POST /account/briefings` takes the kind, the subject (checked as the page
  checks it) and a buyer's segment; the label is the site's ("81
  Engineering", a buyer's name from the data, "Fisheries and Oceans Canada ·
  81 Engineering"), never typed. A buyer no longer in the data adds nothing.
- Briefings and saved searches share one cap (3 on Free, 25 on Pro): each
  insert counts both tables inside the statement, so two posts at once cannot
  pass it. `addSearch` does the same (it counts the searches alone while the
  `briefings` table is not on the database yet).
- `/account/searches` lists the briefings in their own panel: delivery
  (weekly or off; Free sees the gate note), the newest run, Remove. Turning
  delivery on is Pro's (`POST /account/briefings/:id`).

### The message

For a subject S at data date D, the span is the seven data dates ending with
D (after a message that failed, back to the last one covered, at most 14).

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
window, and then no link. `rec_instruments` has no index by expiry, segment or
end user, so the statement reads the table once (a few thousand rows: the
active instruments and those lapsed within 90 days, as the watches' calendar
statement does) and sorts its matches for the first 10; `COUNT(*) OVER ()`
counts all of them.

Subject: `Weekly briefing, {name}: {n} new notices, {n} awards, {n} contracts
ending next quarter` (each part only when not zero); in French `Bulletin
hebdomadaire, {name} : ...`. The preview line names the awards and the
quarter's count, total and new rows. The footer: "You receive this each week
for a briefing in your account.", the searches page, and the stop link.

### The run

The delivery job's last step (`runBriefings`, after the watch mail, inside the
same cap of 300 messages a run). For each briefing with delivery `weekly`,
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
a `briefing_deliveries` row (kept 90 days). The log line adds `briefings: n
sent, n failed, n with nothing new, n not on a plan with delivery`.

The stop link is `/account/stop?b=<briefing id>&t=<secret>`, in the footer and
in `List-Unsubscribe` with `List-Unsubscribe-Post`; it turns that briefing's
email off (the briefing stays on the searches page). GET shows a button; POST
and the one-click body act; a wrong secret is the site's 404. The secret is 16
random bytes made with the first message.

### The public sample

`/pro/briefing-sample` renders this week's briefing for segment 81
(Engineering) with the same reader and the same message, from the seven data
dates ending with the site's data date, headed "A sample of the weekly
briefing, built from this week's data". It is linked from the briefing panels,
`/pro` and the Email lists page. It reads no session (the same page for every
reader, the rail's Sign in item for all), keeps nothing about the reader,
reads the records database once (one batch) and is cached `public,
max-age=3600` (`layout.tsx` `publicPage`). A database that cannot answer gives
the page's shell with "not available right now", 503, never stored. With the
switch off it is the site's 404.

### Bounds and privacy

Briefings share the 25 cap; 10 rows a section, six sections, so 60 rows a
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
