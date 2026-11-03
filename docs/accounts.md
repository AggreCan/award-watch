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
- **Delivery by email.** On the Pro plan, a tender list or a list of
  contracts ending can be sent daily or weekly (*Phase 2: delivery*). Every
  message carries a link that turns its delivery off without signing in.
- **API keys.** Issued and revoked on the account; shown once. No endpoint
  asks for one yet.
- **Plans.** Each account is on a plan, Free or Pro, computed from the
  entitlements table. The plan sets how many saved searches the account
  keeps and whether delivery, API keys, filtered exports, same-day tender
  notices and the full 6- and 12-month windows of contracts ending
  (`radar_depth`) are open to it. A page learns the request's plan with
  `planOfRequest(c)` (`site/src/account/session.ts`) and checks a feature
  with `allowed({ plan }, feature)` (`site/src/account/entitlements.ts`).
- **Deletion.** The reader deletes the account from its own page.

Two kinds of message are sent by email: the sign-in message, and the
saved-search deliveries a Pro account turns on. Both go out through
Cloudflare Email Sending from the Worker's own binding once the domain is
onboarded (see *Sending mail* and *Operator steps*).

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
| `code_misses` | one row per wrong code or link tried for an address: the address and the time, for the hour's count | the code tried, the IP address |
| `audit` | user id, event name, time, a short fixed detail | an address, a code, a token, a key |

Limits: at most 25 saved searches per account (Free keeps 3), at most 5 live
API keys, at most 5 sign-in requests per address per hour, at most 5 wrong
codes per address per hour across all its requests.

Retention: sign-in requests and wrong tries are deleted after a day (and
with the account); sessions 90 days after they end; audit rows after 90
days. The sweep runs with each sign-in request.

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
   phase 2 added the `delivery_tokens` table, which deleting a search or an
   account now clears, so the schema goes on before the switch is turned on
   with the phase 2 code deployed. `npm run db:local` applies it to the local
   database, with `seed/accounts_dev.sql` (the development outbox, never
   applied on the account).
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
   again at once; the data stays.

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
  database.
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
secrets or API keys in clear. No payment details.

## Deletion

`/account/delete` asks for a ticked box, then in one batch: revokes every
session; deletes the saved searches (with their delivery rows and stop
links), the API keys and the address's sign-in requests; and marks the user row deleted with its
email replaced by `deleted:` and SHA-256 of a random salt and the address,
the salt thrown away. The row then proves nothing about which address it
was, and the address can sign up again as a new account. The address's rows
in the alerts form's table are deleted too. The entitlement rows stay, tied
to the user id alone, as the record of what was granted. A Pro subscription
that can still bill is cancelled at Stripe before any of this, and the
account is kept if Stripe cannot confirm it (*Payments*).

## Phase 2: delivery

The delivery job is `site/src/account/deliveries.ts`; the two messages are
`site/src/account/digests.ts`, built on the approved designs in
`design/email/` (the daily digest and the radar digest); the tests are
`site/test/accounts-deliveries.test.ts`.

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
3. For each saved search, oldest first: delivery `daily` or `weekly`, a
   kind the job can serve (below), an active account whose plan allows
   `delivery` (`planFor`, so a lapsed or revoked plan stops at once), and
   due: not delivered for this data date (the date of `last_delivered_at`
   is earlier); for weekly, never delivered or last delivered seven or more
   days before. A search whose message failed for this data date waits for
   the next data date.

### What each kind delivers

The items are the records since the previous delivery's data date, at most
seven days back; a first daily delivery covers the data date alone, a first
weekly one the last seven days.

| Kind | Read from | Items |
|---|---|---|
| `tenders` | `tenders/new/<day>.json` for each day after the previous delivery's data date up to today's | the notices first seen on those days that match the saved filter, read by the same parser as `/tenders` (`readTenderQuery`, `filterTenders`), still open at the run's time, soonest closing first; a notice closing within 7 days of the data date shows its time left in amber |
| `expiring` | `expiring/<window>/index.json` and its pages, read from the last page back | the window's contracts whose end date is inside the window at today's data date and was outside it at the previous delivery's data date (the window's length is the radar's, 91, 182 or 365 days), filtered as the radar's form saved them (`readExpiringQuery`, `filterExpiring`), newest end first |
| `organization`, `buyer`, `segment` | not delivered | the profile, buyer and segment files list award notices, contracts and grants without the date each record was first seen, so new records cannot be told from old ones; the searches page shows their delivery as off with a note, the job skips them, and the delivery post refuses to turn them on |

A file that does not read (today's new-notice file, a window's index or
page) ends the run with one log line naming it; the next hour tries again.

### What it sends and writes

- Nothing new: a `deliveries` row `empty`, no message, and
  `last_delivered_at` moves to the run's time.
- Otherwise one message per saved search, in the search's language, through
  the accounts sender (`senderFor`, the `MAIL` binding), with the subject,
  rows, button, note and footer of the design. A message lists at most 50
  rows; past that, a line names how many more and links the page. A
  `deliveries` row `sent` (with the number of records matched) moves
  `last_delivered_at`; `failed` leaves it, so the next data date's delivery
  covers what this one missed.
- At most 300 messages a run. A refusal with `E_DAILY_LIMIT_EXCEEDED` or
  `E_RATE_LIMIT_EXCEEDED` stops the run with no row for that search, and
  the next hour goes on from there. Any other refusal is a `failed` row.
- A fault reading or writing the accounts database logs one line and ends
  the run. A second run in the same hour finds nothing due.
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
or could not be sent. A kind the job cannot serve shows its delivery off and
disabled, with a note.

### Checking a run

```
npx wrangler d1 execute awardwatch-accounts --remote --command "SELECT substr(sent_at, 1, 10) AS day, status, COUNT(*) AS n, SUM(items) AS items FROM deliveries GROUP BY day, status ORDER BY day DESC LIMIT 20"
```

The Worker's logs hold one line per run: the data date and the counts sent,
failed, with nothing new and not on a plan with delivery.

## Phase 3: payments and the metered API

Payments are built: see *Payments* below. The metered API mounts
`requireApiKey("api")` on new endpoints registered only while the switch is
on, counts requests per key in a rate limiter keyed on the key's id, and
records usage by key for the account page. The existing `/api` endpoints
stay open without a key.

## Payments

Pro is sold as a subscription through Stripe, monthly or yearly, with
Allwater Software Inc. as the merchant. The site never sees a card: the
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
| `POST /account/billing/checkout` | session, CSRF, Origin | Creates a Checkout Session and redirects (303) to it. A user whose subscription can still bill is sent to Stripe's portal instead (a billing page left open from before the subscription would otherwise start a second one). |
| `POST /account/billing/portal` | session, CSRF, Origin | Creates a portal session for the stored customer and redirects (303) to it. |
| `POST /account/billing/webhook` | Stripe's signature | Takes Stripe's notices. |

All four are the site's 404 while the accounts switch is off. The overview
(`/account`) shows "Pro, paid until <date>" when a live Stripe row decides
the plan, the date being the end of the period paid, and links the billing
page in either case.

The Checkout Session is `mode=subscription` with the chosen price and
quantity 1, `client_reference_id` and `subscription_data[metadata][user_id]`
set to the user id, `automatic_tax[enabled]=true`, the user's address in
`customer_email` (or, for a returning subscriber, the stored `customer` with
`customer_update[address]=auto`), `success_url` `/account?billing=done`,
`cancel_url` `/account/billing`, and `locale` `en` or `fr-CA` from the page
language. The portal session names the stored customer, returns to
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
| `invoice.paid` | Extends the subscription's live row to the paid period's end plus 3 days (never shortening it), or writes a row when none is live (a first period whose checkout notice has not arrived, a renewal paid after a lapse). Nothing for a subscription already canceled or expired. |
| `customer.subscription.updated` | Records the status and the period end. `canceled`, `unpaid` or `incomplete_expired` sets the live row's end to now. `past_due` changes nothing: Pro runs to the end of the grace while Stripe retries the card. |
| `customer.subscription.deleted` | Sets the live row's end to now. |
| `charge.refunded` | When the charge is refunded in full (`refunded` true, or `amount_refunded` reaching `amount`): sets the end of every live Stripe row of the account bound to the charge's customer to now. A partial refund changes nothing. |
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
`payment_events` rows go after 90 days.

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
end of the period paid; `payment_events` holds Stripe's event ids and types.
No card details, billing address, tax number or amount is kept on the site;
Stripe holds those as the payment processor. The rows stay when an account
is deleted, tied to the id alone like the entitlement rows.

### Operator steps

1. **A Stripe account in the merchant's name.** Allwater Software Inc., a
   British Columbia corporation: business details, the payout bank account,
   a statement descriptor that names Award Watch, and contact@awardwatch.ca
   as the support address shown on receipts. In Settings, Customer emails,
   turn on receipts for successful payments; in the Billing settings, turn
   on Stripe's emails for failed payments and expiring cards, with a link
   to the portal. The site sends no billing mail of its own.
2. **The product and its two prices.** One product, Award Watch Pro, with
   a software-as-a-service tax code, and two recurring prices in CAD:
   CA$19 monthly and CA$190 yearly, each with tax behaviour "exclusive"
   (taxes added at checkout). Note the two price ids (`price_...`).
3. **Stripe Tax.** Turn it on, set the origin address, and add a
   registration for each place Allwater is registered to collect (GST/HST,
   and the provincial taxes it registers for). Stripe Tax collects nothing
   where no registration exists; whether and where to register is the
   merchant's decision with its accountant.
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
   and `STRIPE_PRICE_YEARLY` (the price ids), `PRICE_MONTHLY_CAD` `"19"` and
   `PRICE_YEARLY_CAD` `"190"` (shown on the billing page as CA$19 and
   CA$190). A figure is digits with optional cents (`"19.00"`); anything
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
   once; deleting the account cancels its subscription.
10. **Before live payments:** the paid-tier Terms (`docs/terms-paid-draft.md`
    after review), About, Terms and Privacy naming Allwater Software Inc. as
    publisher and merchant, and the Privacy page saying that payments are
    processed by Stripe; then the live keys, then the switch.

Removing either secret turns payments off at once: the billing page says
Pro is not available yet and the webhook refuses every notice (Stripe keeps
retrying for three days). Entitlement rows already written keep running to
their end.

### Known limits

- Two checkouts started in two tabs before either finishes make two
  subscriptions (once one is bound, the checkout button sends the user to
  the portal instead). The second is bound only if the first has ended; the
  audit records "stripe second subscription". Cancel the extra one in the
  dashboard, then refund it. A full refund ends every live Stripe row of
  the account bound to the charge's customer, whichever subscription the
  charge paid for: when both subscriptions share the customer, grant the
  rest of the paid period by hand afterwards.
- Prices change in Stripe (a new price, then the variables); existing
  subscriptions keep their price until moved in the dashboard.
