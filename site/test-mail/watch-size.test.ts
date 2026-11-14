// The watch mail's size (src/account/digests.ts watchDigest; docs/accounts.md,
// Watches, The mail): an Ultra account follows up to 100 pages, and a busy
// week can bring news on every one. Past the rows a message lists, the
// watches still to come are one line linking the watches page, so the
// message stays under the size at which a webmail client clips it and hides
// the footer's stop link behind a link of its own.
import { describe, expect, it } from "vitest";
import { ROWS_MAX } from "../src/account/deliveries";
import { siteLink, watchDigest } from "../src/account/digests";
import type { EventKind, EventRow, Found } from "../src/account/watch_events";
import { foundKey } from "../src/account/watch_events";
import { groupsFor } from "../src/account/watch_mail";
import type { Watch } from "../src/account/watches";
import { t, tn, type Lang } from "../src/i18n";
import { decode, nbsp, newEmail, useAccountsDb } from "../test/accounts-helpers";
import { DAY, SITE } from "../test/mail-fixtures";
import { checkMessage, shapeOf, viaLogSender } from "./checks";

useAccountsDb();

const LANGS = ["en", "fr"] as const;
// Under this many characters of HTML, as the finding sets it: Gmail clips a message's HTML at about 102 KB.
const HTML_MAX = 100_000;
const WATCHES = 100;
const KINDS: readonly EventKind[] = ["award", "amended", "ends_12m"];
const STOP = `${SITE}/account/stop?w=${"a".repeat(32)}&t=${"b".repeat(32)}`;

// 100 organization watches, each with 12 events of 3 kinds on the data date.
function busy(lang: Lang) {
  const watches: Watch[] = Array.from({ length: WATCHES }, (_, i) => ({
    id: `w${i}`, kind: "organization", target: `org-b${String(i).padStart(9, "0")}`, segment: "", label: `Sample Works ${i}`,
    events: [...KINDS], cadence: "daily", created_at: `2026-01-01T00:00:00.${String(i).padStart(3, "0")}Z`, last_sent_day: null,
  }));
  const event = (w: number, kind: EventKind, i: number): EventRow => ({
    day: DAY, kind, src: 1, ref: `award:cb-${w}-${kind}-${i}`, cents: 100_000 * (i + 1), ocents: kind === "amended" ? 50_000 : null,
    endd: kind === "ends_12m" ? "2027-06-30" : null, oendd: null, closing: null, oclosing: null, namd: null, title: `Award ${w}-${kind}-${i}`,
    title_fr: `Attribution ${w}-${kind}-${i}`, other: null, horizon: null, path: `/awards/cb-${w}-${kind}-${i}`,
  });
  const found = new Map<string, Found>(watches.map((w, n) => [foundKey(w), {
    rows: KINDS.flatMap((kind) => Array.from({ length: 4 }, (_, i) => event(n, kind, i))),
    counts: new Map(KINDS.map((kind) => [kind, new Map([[DAY, 4]])])),
  }]));
  const spans = new Map(watches.map((w) => [w.id, new Set([DAY])]));
  return groupsFor(lang, watches, { state: "ready", asOf: DAY, found }, spans);
}

describe("the watch mail of a busy week", () => {
  it.each(LANGS)("stays under 100,000 characters of HTML with 100 watches, and keeps the footer's stop link (%s)", async (lang) => {
    const { groups, total } = busy(lang);
    expect(groups).toHaveLength(WATCHES);
    expect(total).toBe(WATCHES * 12);
    const m = watchDigest({ lang, to: newEmail(`watch-size-${lang}`), site: SITE, dataDate: DAY, stopUrl: STOP, groups, total, watched: WATCHES });
    expect(m.html.length).toBeLessThan(HTML_MAX);
    // The footer, the last part of the message, still carries the stop link in both parts.
    const footer = m.html.slice(m.html.lastIndexOf(t(lang, "watches.digest_why").slice(0, 20)));
    expect(decode(footer)).toContain(STOP);
    expect(m.text).toContain(STOP);
    expect(m.headers["List-Unsubscribe"]).toContain(STOP);
    // The rows a message lists, then one line for the watches past them, linking the watches page.
    expect((m.html.match(/<tr><td class="rule"/g) ?? []).length).toBe(ROWS_MAX);
    const shown = groups.findIndex((g) => g.events.every((e) => e.rows.length === 0));
    const rest = WATCHES - shown;
    const line = nbsp(tn(lang, "weekly.more_pages_one", "weekly.more_pages_many", rest, { n: rest }));
    expect(nbsp(decode(m.html))).toContain(`>${line}</a>`);
    expect(nbsp(m.text)).toContain(nbsp(t(lang, "digest.text_link", { label: line, url: siteLink(SITE, "/account/watches", lang) })));
    // No watch past the line is named in either part.
    expect(m.text).not.toContain(`Sample Works ${WATCHES - 1} `);
    checkMessage(await viaLogSender(m), shapeOf("watch", "watch mail of 100 watches", SITE), lang);
  });
});
