// One entry read from its shard without parsing the rest (loadShardEntry in
// src/data.ts): the entry's text is cut out by its key and its brackets, and
// whenever that does not give the entry asked for the whole file is read as
// before. Each case below holds the result equal to the full parse's.
import { beforeEach, describe, expect, it } from "vitest";
import { clearParsedCache, loadContract, loadJson, loadProfile, loadTender } from "../src/data";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { makeFakeAssets, testEnv } from "./assets";
import contracts from "./fixtures/contracts-637.json";
import contractsConverted from "./fixtures/contracts-557.json";
import profiles from "./fixtures/profiles-a00.json";
import tenderShard from "./fixtures/tenders-20a.json";
import tenderConverted from "./fixtures/tenders-f3d.json";

beforeEach(() => clearParsedCache());

const envWith = (overrides: Record<string, unknown> = {}) => ({ ASSETS: makeFakeAssets({}, overrides) }) as unknown as Env;
const P1 = "org-a000000001";
const P2 = "org-a000000002";
const shardOf = (o: object) => JSON.parse(JSON.stringify(o)) as Record<string, any>;

// A request that reads the full parse's answer, for comparison: the shard is
// parsed and kept first, so the loader takes the kept copy.
async function viaFullParse(env: Env, path: string, read: () => Promise<unknown>): Promise<unknown> {
  clearParsedCache();
  await loadJson(env, path);
  const value = await read();
  clearParsedCache();
  return value;
}

describe("loadShardEntry gives the full parse's entry", () => {
  it("for every entry of the fixture shards, and null for one that is not there", async () => {
    const env = envWith();
    for (const id of Object.keys(profiles)) {
      const p = await loadProfile(env, id);
      expect(p).toEqual((profiles as Record<string, unknown>)[id]);
      expect(p).toEqual(await viaFullParse(env, "profiles/a00.json", () => loadProfile(env, id)));
    }
    expect(await loadProfile(env, "org-a00000000e")).toBeNull();
    // Award and history entries, one keyed in lower case and one as published (W8472-000633).
    expect(await loadContract(env, "award", "cb-400-40000004")).toEqual((contracts as any)["award:cb-400-40000004"]);
    expect(await loadContract(env, "history", "w8472-000633")).toEqual((contracts as any)["history:W8472-000633"]);
    expect(await loadContract(env, "award", "23240-220799-001-im")).toEqual((contractsConverted as any)["award:23240-220799-001-im"]);
    expect(await loadContract(env, "history", "cb-400-40000004")).toBeNull();
    for (const ref of Object.keys(tenderShard)) expect(await loadTender(env, ref)).toEqual((tenderShard as any)[ref]);
    expect(await loadTender(env, "en578-123456-a-1")).toEqual((tenderConverted as any)["en578-123456-a-1"]);
  });

  it("when an earlier entry's text holds the key, braces and escaped quotes inside its strings", async () => {
    const shard = shardOf(profiles);
    const tricky = `"${P2}": {[}] \\" \\\\ "${P2}":{"x":1}`;
    shard[P1].organization.display_name = tricky;
    shard[P1].names = [{ name: `${P2}"} ,"${P2}":`, source: "awards", n: 1 }];
    const env = envWith({ "profiles/a00.json": shard });
    expect(await loadProfile(env, P2)).toEqual(shard[P2]);
    expect((await loadProfile(env, P1))?.organization.display_name).toBe(tricky);
  });

  it("when an earlier entry holds the key as a key of its own, by reading the whole file", async () => {
    // Written by hand so the decoy comes first: an object keyed by the id
    // inside the first entry, which is not the entry asked for.
    const shard = shardOf(profiles);
    const body = `{"${P1}":${JSON.stringify({ ...shard[P1], decoy: { [P2]: { organization: { id: P2 } } } })},"${P2}":${JSON.stringify(shard[P2])}}`;
    const env = envWith({ "profiles/a00.json": body });
    expect(await loadProfile(env, P2)).toEqual(shard[P2]);
  });

  it("when an earlier entry holds a whole copy of the entry under its key, by taking the shard's own", async () => {
    // The decoy passes every shape check: it is the entry itself, nested in
    // the first entry. Only the shard's own key, at the top level, counts.
    const shard = shardOf(profiles);
    const real = { ...shard[P2], organization: { ...shard[P2].organization, display_name: "The shard's own entry" } };
    const body = `{"${P1}":${JSON.stringify({ ...shard[P1], decoy: { [P2]: shard[P2] } })},"${P2}":${JSON.stringify(real)}}`;
    const env = envWith({ "profiles/a00.json": body });
    expect((await loadProfile(env, P2))?.organization.display_name).toBe("The shard's own entry");
    expect(await loadProfile(env, P2)).toEqual(real);
  });

  it("reads a shard cut short as missing, as the full parse does", async () => {
    const text = JSON.stringify(profiles);
    for (const cut of [text.slice(0, Math.floor(text.length * 0.6)), text.slice(0, -1), text.slice(0, text.indexOf(`"${P2}"`))]) {
      const env = envWith({ "profiles/a00.json": cut });
      expect(await loadProfile(env, P1)).toBeNull();
    }
  });

  it("returns the entry frozen, and keeps nothing it did not parse whole", async () => {
    const env = envWith();
    const p = (await loadProfile(env, P1)) as any;
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.awards[0])).toBe(true);
    expect(() => { p.added = 1; }).toThrow(TypeError);
    // A second read cuts it out again: a new object, equal to the first.
    const again = await loadProfile(env, P1);
    expect(again).not.toBe(p);
    expect(again).toEqual(p);
  });

  it("renders the profile page byte for byte as the full parse does", async () => {
    let address = 0;
    const get = async () => (await app.request(`/organizations/${P1}`, {
      headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.40.${(address++ % 250) + 1}` },
    }, testEnv())).text();
    const sliced = await get();
    // The same page from a kept full parse of the shard.
    clearParsedCache();
    await loadJson(testEnv() as unknown as Env, "profiles/a00.json");
    const full = await get();
    expect(sliced).toBe(full);
  });
});
