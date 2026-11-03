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
- **API keys.** Issued and revoked on the account; shown once. No endpoint
  asks for one yet.
- **Plans.** Each account is on a plan, Free or Pro, computed from the
  entitlements table. The plan sets how many saved searches the account
  keeps and whether delivery, API keys, filtered exports and same-day tender
  notices are open to it. A page learns the request's plan with
  `planOfRequest(c)` (`site/src/account/session.ts`) and checks a feature
  with `allowed({ plan }, feature)` (`site/src/account/entitlements.ts`).
- **Deletion.** The reader deletes the account from its own page.

Nothing is sent by email except the sign-in message, which goes out through
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
| `deliveries` | phase 2: one row per delivery of a saved search (created now, unused) | the message |
| `audit` | user id, event name, time, a short fixed detail | an address, a code, a token, a key |

Limits: at most 25 saved searches per account (Free keeps 3), at most 5 live
API keys, at most 5 sign-in requests per address per hour, at most 5 wrong
codes per request.

Retention: sign-in requests are deleted after a day; sessions 90 days after
they end; audit rows after 90 days. The sweep runs with each sign-in request.

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
   hashes are compared in constant time. A wrong code counts against every
   open request for the address; the fifth wrong code locks the request.
   A code or link is single use, and using one closes the address's other
   open requests.
5. On a match the site creates the user on first sign-in, creates a session
   and sets the cookie `aw_session` (`HttpOnly`, `Secure`, `SameSite=Lax`,
   `Path=/`, 30 days). The cookie holds the session id and a 32-byte
   secret; the row holds the secret's hash. The session is extended to 30
   days from the last use, at most once an hour.
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
- nothing reads the accounts database or the mail binding.

`site/test/accounts-switch.test.ts` proves each point, rendering the public
pages with the switch off, with the module's bindings removed and with a
valid session cookie, and requiring the three to be identical byte for byte.
With the switch on, the rail's "Your lists" group gains one item (the
signed-in address, or "Sign in") and the privacy page's first section
describes accounts; a page that shows a signed-in address is sent
`Cache-Control: private, no-store`.

## Sending mail

Sign-in messages go through Cloudflare Email Sending from the Worker's
`MAIL` binding (`site/wrangler.jsonc`). There is no outside mail service and
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

   Every statement is idempotent. `npm run db:local` applies it to the local
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
- **Short-lived, single-use codes.** 15 minutes, one use, 5 wrong tries.
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
  be read, a session this Worker instance has already seen keeps its last
  known state, plan included, until the session's own end; any other
  request gets the free view (`planOfRequest` never throws on a public
  page); and an API key request goes on marked unverified. When the database says a session, a
  key or an entitlement is revoked or ended, it stops on that request.
- **No PII in logs or audit.** Log lines and audit details name events and
  counts, never an address, a code, a token or a key.
- **Prepared statements only.** Every query binds its values.

## What is deliberately not stored

No names, postal addresses, phone numbers or passwords. No IP addresses: a
sign-in request keeps, for one day, a hash of the address under a key that
changes every UTC day (and nothing without `VIEWS_SALT_KEY`). No user agents:
a session keeps the device class only. No codes, link secrets, session
secrets or API keys in clear. No payment details.

## Deletion

`/account/delete` asks for a ticked box, then in one batch: revokes every
session; deletes the saved searches (and their delivery rows), the API keys
and the address's sign-in requests; and marks the user row deleted with its
email replaced by `deleted:` and SHA-256 of a random salt and the address,
the salt thrown away. The row then proves nothing about which address it
was, and the address can sign up again as a new account. The address's rows
in the alerts form's table are deleted too. The entitlement rows stay, tied
to the user id alone, as the record of what was granted.

## Phase 2: delivery

A scheduled handler (a second cron in `wrangler.jsonc`, after the nightly
run's deploy) reads the saved searches whose delivery is due (`daily`, or
`weekly` on the account's chosen day) for accounts whose plan allows
delivery, runs each filter against the nightly export (the same static JSON
the pages read: the day's new tender notices, the expiring windows, the
profile, buyer and segment files), keeps the records first seen since
`last_delivered_at`, and sends one message per account through the sender
with an unsubscribe link per search. Each send writes a `deliveries` row and
moves `last_delivered_at`; a search with nothing new writes an `empty` row
and sends nothing. A failed send leaves `last_delivered_at` where it
was, so the next run includes the missed items.

## Phase 3: payments and the metered API

A payments source implements `PaymentSource` in
`site/src/account/payments.ts`: an address to pay for a plan, an address to
manage it, and a signed-notice reader that turns the service's notices into
`entitlements` rows with source `stripe` (one per paid period, the reference
the service's own id) and revokes rows on refunds or disputes.
`/account/billing` answers 404 until then. The metered API mounts
`requireApiKey("api")` on new endpoints registered only while the switch is
on, counts requests per key in a rate limiter keyed on the key's id, and
records usage by key for the account page. The existing `/api` endpoints
stay open without a key.
