// A saved search of the radar mails the contracts that entered its window
// since its last delivery (docs/accounts.md, What each kind delivers): those
// whose end date came inside the window, and those the site first saw while
// they already ended inside it, such as a new award notice or a week's
// published contracts. The second kind is the window's list of new rows
// (expiring/<window>/new/<n>.json, newest first-seen day first), each row
// carrying seen, the day the nightly first saw its contract (pipeline
// expiring.py). The review of 2026-11-14 (mail, finding 6) found that kind
// never mailed. A window index written before the list has no new_pages, and
// a search on it sends what it sent before.
//
// Storage is this file's own, and the run is narrowed to the test's own account.
import { describe, expect, it, vi } from "vitest";
import { SPAN_DAYS_MAX, expiringItems, publishedFiles, runDeliveries } from "../src/account/deliveries";
import type { ExpiringRow } from "../src/data";
import expiringPy from "../../pipeline/awardwatch_pipeline/expiring.py?raw";
import { ACCOUNTS, get, newEmail, onEnv, useAccountsDb } from "./accounts-helpers";
import { makeFakeAssets, testEnv } from "./assets";
import { R1, R2, R3, R4, R5, contract, fakeMail } from "./mail-fixtures";

useAccountsDb();

const DAY = "2026-10-31"; // the fixtures' data date
const YESTERDAY = "2026-10-30";
const LAST_WEEK = "2026-10-24";
const FROM = "alerts@awardwatch.ca";

// Published tonight and ending 40 days after the data date: inside the
// 3-month window tonight, and never outside it by its end date.
const NEW = contract("contract", "dnd-mdn:C-2026-0400", "2026-12-10", { title_en: "Published tonight" });
const seenOn = (r: ExpiringRow, day: string): ExpiringRow => ({ ...r, seen: day });
const refs = (rows: readonly ExpiringRow[]) => rows.map((r) => r.reference);

// The 3-month window as the export writes it: its pages soonest end first
// and, unless withList is false, its list of new rows newest first.
function window3m(o: { fresh?: ExpiringRow[][]; withList?: boolean; skip?: string[] } = {}): Record<string, unknown> {
  const pages = [[NEW, R4, R3], [R2, R1, R5]];
  const fresh = o.fresh ?? [[seenOn(NEW, DAY)]];
  const list = o.withList === false ? {} : { new_pages: fresh.length, new_rows: fresh.flat().length };
  const files: Record<string, unknown> = {
    "expiring/3m/index.json": { window: "3m", pages: pages.length, rows: pages.flat().length, total: 1000, ...list },
  };
  pages.forEach((p, i) => (files[`expiring/3m/${i + 1}.json`] = p));
  if (o.withList !== false) fresh.forEach((p, i) => (files[`expiring/3m/new/${i + 1}.json`] = p));
  for (const path of o.skip ?? []) files[path] = undefined;
  return files;
}

// The published files, counting each read by its path under data/.
function counted(files: Record<string, unknown>) {
  const inner = makeFakeAssets({}, files);
  const reads = new Map<string, number>();
  const assets = {
    fetch: (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname.replace(/^\/data\//, "");
      reads.set(path, (reads.get(path) ?? 0) + 1);
      return inner.fetch(input as never);
    },
  } as unknown as Fetcher;
  return { files: publishedFiles(testEnv(assets) as never), reads };
}

// -- the items ------------------------------------------------------------------------------

describe("the items of a radar search", () => {
  it("list a contract published since the last delivery that ends inside the window", async () => {
    const { files } = counted(window3m());
    // Last delivered on the data date before: R1's end date came inside the window since, and the
    // contract published tonight was never outside it.
    const daily = await expiringItems(files, "3m", "/expiring/3m?buyer=dnd-mdn", YESTERDAY, DAY);
    expect(refs(daily)).toEqual([R1.reference, NEW.reference]);
  });

  it("leave out one first seen on or before the last delivery's data date, and list one that entered both ways once", async () => {
    const before = contract("award", "cb-500-50000009", "2026-12-20");
    const { files } = counted(window3m({ fresh: [[seenOn(R1, DAY), seenOn(NEW, YESTERDAY), seenOn(before, "2026-10-29")]] }));
    // The day the search was last delivered is not after it: NEW and the earlier one were in that message's reach.
    const daily = await expiringItems(files, "3m", "/expiring/3m?buyer=dnd-mdn", YESTERDAY, DAY);
    expect(refs(daily)).toEqual([R1.reference]);
    // A week back, both were first seen inside the span; R1, inside by its end date too, comes once.
    const weekly = await expiringItems(files, "3m", "/expiring/3m?buyer=dnd-mdn", LAST_WEEK, DAY);
    expect(refs(weekly)).toEqual([R1.reference, R2.reference, R3.reference, before.reference, NEW.reference]);
    // The saved filters apply to them as to the rest.
    expect(refs(await expiringItems(files, "3m", "/expiring/3m?buyer=pwgsc-tpsgc", LAST_WEEK, DAY))).toEqual([R5.reference]);
  });

  it("leave out a listed row the data date puts outside the window", async () => {
    const past = contract("award", "cb-500-50000010", "2026-10-30");
    const beyond = contract("award", "cb-500-50000011", "2027-02-15");
    const later = contract("award", "cb-500-50000012", "2026-12-01");
    const { files } = counted(window3m({ fresh: [[seenOn(past, DAY), seenOn(beyond, DAY), seenOn(later, "2026-11-01")]] }));
    expect(refs(await expiringItems(files, "3m", "/expiring/3m?buyer=dnd-mdn", YESTERDAY, DAY))).toEqual([R1.reference]);
  });

  it("send what they sent before when the window's index has no list", async () => {
    const { files, reads } = counted(window3m({ withList: false }));
    expect(refs(await expiringItems(files, "3m", "/expiring/3m?buyer=dnd-mdn", YESTERDAY, DAY))).toEqual([R1.reference]);
    expect(refs(await expiringItems(files, "3m", "/expiring/3m?buyer=dnd-mdn", LAST_WEEK, DAY)))
      .toEqual([R1.reference, R2.reference, R3.reference]);
    expect([...reads.keys()].filter((p) => p.includes("/new/"))).toEqual([]);
  });

  it("read the list from its first page, stop at the page that reaches back to the last delivery, and read each page once a run", async () => {
    const row = (n: number, end: string) => contract("contract", `dnd-mdn:C-2026-05${n}`, end);
    const fresh = [
      [seenOn(row(1, "2026-11-20"), DAY), seenOn(row(2, "2026-11-21"), DAY)],
      [seenOn(row(3, "2026-11-22"), DAY), seenOn(row(4, "2026-11-23"), YESTERDAY)],
      [seenOn(row(5, "2026-11-24"), "2026-10-28")],
    ];
    // The third page is missing: a daily delivery never needs it.
    const { files, reads } = counted(window3m({ fresh, skip: ["expiring/3m/new/3.json"] }));
    for (let i = 0; i < 2; i++) {
      const daily = await expiringItems(files, "3m", "/expiring/3m?buyer=dnd-mdn", YESTERDAY, DAY);
      expect(refs(daily)).toEqual([R1.reference, "dnd-mdn:C-2026-053", "dnd-mdn:C-2026-052", "dnd-mdn:C-2026-051"]);
    }
    expect(Object.fromEntries([...reads].filter(([p]) => p.startsWith("expiring/")))).toEqual({
      "expiring/3m/index.json": 1, "expiring/3m/2.json": 1, "expiring/3m/new/1.json": 1, "expiring/3m/new/2.json": 1,
    });
    // A weekly delivery needs the third page, and a page that does not read ends the run as a window page does.
    await expect(expiringItems(files, "3m", "/expiring/3m", LAST_WEEK, DAY)).rejects.toThrow("expiring/3m/new/3.json could not be read");
  });

  it("take a list page whose rows carry no day as a page that does not read", async () => {
    const { files } = counted(window3m({ fresh: [[NEW]] }));
    await expect(expiringItems(files, "3m", "/expiring/3m", YESTERDAY, DAY)).rejects.toThrow("expiring/3m/new/1.json could not be read");
  });

  it("reach back as far as the export's list does", () => {
    expect(/^NEW_SPAN_DAYS = (\d+)$/m.exec(expiringPy)?.[1]).toBe(String(SPAN_DAYS_MAX));
  });
});

// -- the message ----------------------------------------------------------------------------

let seq = 0;
const nextId = () => (0xe0000000 + ++seq).toString(16).padStart(32, "0");

// The run's list of saved searches narrowed to the given accounts.
function narrowed(users: string[]): D1Database {
  const list = users.map((u) => `'${u.replace(/[^0-9a-f]/g, "")}'`).join(", ");
  const rewrite = (sql: string) => {
    if (!sql.includes("LEFT JOIN delivery_tokens k ON k.search_id = s.id")) return sql;
    const at = sql.lastIndexOf("ORDER BY");
    return `${sql.slice(0, at)}AND s.user_id IN (${list}) ${sql.slice(at)}`;
  };
  return {
    prepare: (sql: string) => ACCOUNTS.prepare(rewrite(sql)),
    batch: (statements: D1PreparedStatement[]) => ACCOUNTS.batch(statements),
    exec: (sql: string) => ACCOUNTS.exec(sql),
  } as unknown as D1Database;
}

describe("a radar search's message", () => {
  it("lists the contract published since the last delivery", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const email = newEmail("radar-new");
    const user = nextId();
    await ACCOUNTS.batch([
      ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', 'active')")
        .bind(user, email),
      ACCOUNTS.prepare(
        "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) " +
        "VALUES (?, ?, 'pro', 'manual', '2026-01-01T00:00:00.000Z', NULL, 'test', '2026-01-01T00:00:00.000Z')",
      ).bind(nextId(), user),
      ACCOUNTS.prepare(
        "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, last_delivered_at, deliver) " +
        "VALUES (?, ?, 'expiring', '/expiring/3m?buyer=dnd-mdn', 'Contracts ending for National Defence', 'en', '2000-01-01T00:00:00.000Z', ?, 'daily')",
      ).bind(nextId(), user, `${YESTERDAY}T15:00:00.000Z`),
    ]);
    const mail = fakeMail();
    await runDeliveries(onEnv({
      ACCOUNTS: narrowed([user]), ASSETS: makeFakeAssets({}, window3m()), MAIL: mail.binding, MAIL_FROM: FROM, MAIL_SENDER: undefined,
    }) as never);
    const [m] = mail.to(email);
    expect(m.subject).toBe("2 contracts now within 3 months of their end: National Defence");
    expect(m.text).toContain("Published tonight");
    expect(m.text).toContain("Robotics targets");
  });
});

// -- the files on the site --------------------------------------------------------------------

describe("a deep window's list of new rows", () => {
  it("is behind the same gate as the window's pages", async () => {
    const files = { "expiring/12m/new/1.json": [seenOn(NEW, DAY)] };
    const off = await get("/data/expiring/12m/new/1.json", { env: testEnv(makeFakeAssets({}, files)) });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual([seenOn(NEW, DAY)]);
    const free = await get("/data/expiring/12m/new/1.json", { env: onEnv({ ASSETS: makeFakeAssets({}, files) }) });
    expect(free.status).toBe(404);
  });
});
