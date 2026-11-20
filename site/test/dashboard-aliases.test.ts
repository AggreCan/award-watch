// Dashboard tiles that name a buyer or an organization the nightly merged into another (the export's alias files:
// buyers/aliases.json, read by data.ts loadBuyerAlias; aliases/<ab>.json, by loadAlias): an analytics table (kind
// analytic), a saved view's tile (kind view, by the saved view's id), and the analytics builder's tiles (kinds build and
// number). Each is drawn at the id that took over, the stored ref left as it was saved: its body and foot are what the
// same tile at the surviving id draws, and its Open leads there. The fixtures' aliases: the buyer
// public-works-and-government-services-canada into pwgsc-tpsgc, the organization org-a00000000f into org-a000000001. An
// id no alias names keeps the state it had. The alias files are read only on a miss (a subject the records do not
// name, or a builder's buyer the buyers' list does not hold), and a moved analytics table or organization view costs one
// records batch more; a page whose subjects are all there reads one batch and no alias file.
import { beforeAll, describe, expect, it } from "vitest";
import { buildLink } from "../src/builder";
import { fiscalYearOf } from "../src/records_db";
import { ACCOUNTS, csrf, get, grantUltra, newEmail, signIn, ultraEnv, useAccountsDb, userId } from "./accounts-helpers";
import { makeFakeAssets } from "./assets";
import { RECORDS, seedBuilder } from "./builder-fixture";

useAccountsDb();
beforeAll(() => seedBuilder());

const RETIRED_BUYER = "public-works-and-government-services-canada";
const BUYER = "pwgsc-tpsgc";
const NEVER_BUYER = "no-such-buyer";
const RETIRED_ORG = "org-a00000000f";
const ORG = "org-a000000001";
const NEVER_ORG = "org-a0000000ff";
const CURRENT = fiscalYearOf("2026-10-31");

// The fixtures' files, each address the Worker asks for written down; and the records database, each batch's size.
const asked: string[] = [];
const fake = makeFakeAssets();
const ASSETS = { fetch: (req: Request) => (asked.push(new URL(req.url).pathname), fake.fetch(req)) } as unknown as Fetcher;
const batches: number[] = [];
const COUNTED = new Proxy(RECORDS, {
  get(target, prop) {
    if (prop === "batch") return (list: D1PreparedStatement[]) => (batches.push(list.length), target.batch(list));
    const v = Reflect.get(target, prop);
    return typeof v === "function" ? v.bind(target) : v;
  },
});
const env = () => ultraEnv({ ASSETS, RECORDS: COUNTED, BUILDER: "on" });

type Reader = { id: string; cookie: string; csrf: string };
let n = 0;
async function reader(): Promise<Reader> {
  const email = newEmail(`dash-alias-${++n}`);
  const cookie = await signIn(email, { env: env() });
  await grantUltra(email);
  return { id: await userId(email), cookie, csrf: await csrf(cookie, "/account", { env: env() }) };
}
const hex = (tag: number, i: number) => `${tag.toString(16).padStart(8, "0")}${i.toString(16).padStart(24, "0")}`;
// A stored dashboard holding the tiles given, each 12 wide and 12 high, one under the other; their ids in order.
async function board(r: Reader, tag: number, tiles: [kind: string, ref: string][]): Promise<string[]> {
  const b = hex(tag, 0);
  const ids = tiles.map((_, i) => hex(tag, 0x10 + i));
  await ACCOUNTS.batch([
    ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', 0, '2026-01-02T00:00:00.000Z')").bind(b, r.id),
    ...tiles.map(([kind, ref], i) => ACCOUNTS.prepare(
      "INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, '', 0, ?, 12, 12, ?)",
    ).bind(ids[i], b, r.id, kind, ref, i * 12, `2026-01-02T00:00:0${i}.000Z`)),
  ]);
  return ids;
}
async function savedView(r: Reader, id: string, address: string): Promise<void> {
  await ACCOUNTS.prepare("INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, ?, ?, 'Followed view', 'en', 'off', ?)")
    .bind(id, r.id, address.startsWith("/buyers/") ? "buyer" : "organization", address, `2026-01-03T00:00:${String(++n % 60).padStart(2, "0")}.000Z`).run();
}

// A tile's section with its own id taken out, and the number of each chart's gradient (cf-<n>-<i>), which counts the
// charts in the order the page draws them: its head's title and item, then its body and foot (Open included).
function tileOf(html: string, id: string): { head: string; rest: string; open: string } {
  const at = html.indexOf(`id="tile-${id}"`);
  expect(at, id).toBeGreaterThan(-1);
  const section = html.slice(at, html.indexOf("</section>", at)).replaceAll(id, "TILE").replace(/\bcf-\d+-/g, "cf-N-");
  const head = section.slice(section.indexOf("<h2"), section.indexOf("</h2>"));
  const rest = section.slice(section.indexOf('<div class="dash-body'), section.indexOf('<button type="button" class="dash-corner"'));
  const open = /<div class="dash-foot">.*<a href="([^"]*)">/s.exec(rest)?.[1] ?? "";
  return { head, rest, open };
}
const page = async (r: Reader) => {
  asked.length = 0;
  batches.length = 0;
  const res = await get("/account/dashboard", { cookie: r.cookie, env: env() });
  expect(res.status).toBe(200);
  return res.text();
};
const aliasReads = () => asked.filter((p) => p.includes("aliases"));

const analytic = (base: "buyers" | "organizations", id: string, table: string) => `/${base}/${id}/analytics?source=awards&years=5#table-${table}`;
const view = (base: "buyers" | "organizations", id: string) => `/${base}/${id}/analytics?source=awards&years=5`;

describe("a tile on a merged buyer or organization", () => {
  // [what, kind, ref at the retired id, at the surviving id, at an id that was never anything]
  const CASES: [string, string, (id: string) => string, string, string, string][] = [
    ["an analytics table of a buyer", "analytic", (id) => analytic("buyers", id, "quarters"), RETIRED_BUYER, BUYER, NEVER_BUYER],
    ["an analytics table of an organization", "analytic", (id) => analytic("organizations", id, "years"), RETIRED_ORG, ORG, NEVER_ORG],
    ["a builder's view of a buyer", "build", (id) => buildLink({ buyer: id }, "awards", CURRENT - 4, CURRENT), RETIRED_BUYER, BUYER, NEVER_BUYER],
    ["a builder's view of an organization", "build", (id) => buildLink({ org: id }, "awards", CURRENT - 4, CURRENT), RETIRED_ORG, ORG, NEVER_ORG],
    ["a builder's latest figure of a buyer", "number", (id) => buildLink({ buyer: id }, "awards", CURRENT - 4, CURRENT), RETIRED_BUYER, BUYER, NEVER_BUYER],
    ["a builder's latest figure of an organization", "number", (id) => buildLink({ org: id }, "awards", CURRENT - 4, CURRENT), RETIRED_ORG, ORG, NEVER_ORG],
  ];
  let tag = 0xa100;
  for (const [what, kind, ref, retired, survivor, never] of CASES) {
    it(`draws ${what} at the id that took over, and leaves an id no alias names as it was`, async () => {
      const r = await reader();
      const [old, now, none] = await board(r, ++tag, [[kind, ref(retired)], [kind, ref(survivor)], [kind, ref(never)]]);
      const html = await page(r);
      const moved = tileOf(html, old);
      const there = tileOf(html, now);
      expect(moved.head).toBe(there.head);
      expect(moved.rest).toBe(there.rest);
      expect(moved.open).toBe(ref(survivor).replaceAll("&", "&amp;"));
      // An id no alias names: as it was, its Open its own address (a builder's buyer the list does not hold: gone).
      const nothing = tileOf(html, none);
      expect(nothing.rest).not.toBe(there.rest);
      if (kind !== "analytic" && never === NEVER_BUYER) expect(nothing.rest).toContain("What this tile showed was removed.");
      else expect(nothing.open).toBe(ref(never).replaceAll("&", "&amp;"));
      // The stored refs keep the ids they were saved with.
      const kept = await ACCOUNTS.prepare("SELECT ref FROM dashboard_tiles WHERE user_id = ? ORDER BY y").bind(r.id).all<{ ref: string }>();
      expect(kept.results?.map((x) => x.ref)).toEqual([ref(retired), ref(survivor), ref(never)]);
    });
  }

  it("draws a saved view's tile at the id that took over, its saved address left as it was", async () => {
    const r = await reader();
    const ids = { old: hex(0xa201, 1), now: hex(0xa201, 2), none: hex(0xa201, 3), oldOrg: hex(0xa201, 4), nowOrg: hex(0xa201, 5) };
    await savedView(r, ids.old, view("buyers", RETIRED_BUYER));
    await savedView(r, ids.now, view("buyers", BUYER));
    await savedView(r, ids.none, view("buyers", NEVER_BUYER));
    await savedView(r, ids.oldOrg, view("organizations", RETIRED_ORG));
    await savedView(r, ids.nowOrg, view("organizations", ORG));
    const tiles = await board(r, 0xa202, [["view", ids.old], ["view", ids.now], ["view", ids.none], ["view", ids.oldOrg], ["view", ids.nowOrg]]);
    const html = await page(r);
    const [old, now, none, oldOrg, nowOrg] = tiles.map((id) => tileOf(html, id));
    expect(old.head).toBe(now.head);
    expect(old.rest).toBe(now.rest);
    expect(old.open).toBe(`${view("buyers", BUYER)}#table-quarters`.replaceAll("&", "&amp;"));
    expect(oldOrg.head).toBe(nowOrg.head);
    expect(oldOrg.rest).toBe(nowOrg.rest);
    expect(oldOrg.open).toBe(`${view("organizations", ORG)}#table-years`.replaceAll("&", "&amp;"));
    expect(none.rest).not.toBe(now.rest);
    expect(none.open).toBe(`${view("buyers", NEVER_BUYER)}#table-quarters`.replaceAll("&", "&amp;"));
    const kept = await ACCOUNTS.prepare("SELECT id, address FROM saved_views WHERE user_id = ?").bind(r.id).all<{ id: string; address: string }>();
    expect(new Map(kept.results?.map((x) => [x.id, x.address]))).toEqual(new Map([
      [ids.old, view("buyers", RETIRED_BUYER)], [ids.now, view("buyers", BUYER)], [ids.none, view("buyers", NEVER_BUYER)],
      [ids.oldOrg, view("organizations", RETIRED_ORG)], [ids.nowOrg, view("organizations", ORG)],
    ]));
  });

  it("reads the alias files and one records batch more only on a miss", async () => {
    const r = await reader();
    await board(r, 0xa301, [["analytic", analytic("buyers", BUYER, "quarters")], ["analytic", analytic("organizations", ORG, "years")],
      ["build", buildLink({ buyer: BUYER }, "awards", CURRENT - 4, CURRENT)], ["build", buildLink({ org: ORG }, "awards", CURRENT - 4, CURRENT)]]);
    await page(r);
    expect(aliasReads()).toEqual([]);
    expect(batches).toHaveLength(1);
    // An id no alias names: the alias file is read, and nothing more.
    const s = await reader();
    await board(s, 0xa302, [["analytic", analytic("organizations", NEVER_ORG, "years")]]);
    await page(s);
    expect(aliasReads()).toEqual(["/data/aliases/a0.json"]);
    expect(batches).toHaveLength(1);
    // A merged organization's table: its alias file, then its statements again at the surviving id, in one more batch.
    const u = await reader();
    await board(u, 0xa303, [["analytic", analytic("organizations", RETIRED_ORG, "years")], ["analytic", analytic("buyers", BUYER, "quarters")]]);
    await page(u);
    expect(aliasReads()).toEqual(["/data/aliases/a0.json"]);
    expect(batches).toHaveLength(2);
    // A builder's merged buyer is read before the batch, from the buyers' alias file: one batch.
    const w = await reader();
    await board(w, 0xa304, [["build", buildLink({ buyer: RETIRED_BUYER }, "awards", CURRENT - 4, CURRENT)]]);
    await page(w);
    expect(aliasReads()).toEqual(["/data/buyers/aliases.json"]);
    expect(batches).toHaveLength(1);
  });

  it("answers a merged subject's tile alone, as the page's script reads it after a resize, at the id that took over", async () => {
    const r = await reader();
    const [old, now] = await board(r, 0xa401, [["analytic", analytic("buyers", RETIRED_BUYER, "quarters")], ["analytic", analytic("buyers", BUYER, "quarters")]]);
    const one = async (id: string) => {
      const res = await get(`/account/dashboard/tiles/${id}?w=12&h=12`, { cookie: r.cookie, env: env(), headers: { "x-csrf-token": r.csrf } });
      expect(res.status).toBe(200);
      return tileOf(await res.text(), id);
    };
    const [a, b] = [await one(old), await one(now)];
    expect(a.rest).toBe(b.rest);
    expect(a.open).toBe(analytic("buyers", BUYER, "quarters").replaceAll("&", "&amp;"));
  });
});
