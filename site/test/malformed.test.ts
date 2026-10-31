// Every data file the Worker reads, replaced by bodies of the wrong shape:
// truncated JSON, null, an empty list or object, a scalar, a list of numbers,
// and the right container holding the wrong field types. A page that reads
// the file answers "not published", "not found" or renders without the part
// the file feeds, never a server error.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { FILES, makeFakeAssets, testEnv } from "./assets";

let address = 0;
const BODIES = ["{", "null", "[]", "{}", '"text"', "[1,2,3]", '{"rows":5,"buyers":"x","segments":{},"years":"2026","code":"82"}'];

// The pages each file feeds (and the API routes that pass it through or read it).
const READERS: Record<string, string[]> = {
  "stats.json": ["/", "/tenders", "/awards", "/data", "/support", "/cite", "/api/stats"],
  "tenders/open.json": ["/tenders", "/tenders?segment=82&q=x"],
  "tenders/new/2026-10-31.json": ["/tenders/new"],
  "tenders/20a.json": ["/tenders/cb-100-10000001", "/api/tenders/cb-100-10000001"],
  "contracts/637.json": ["/awards/cb-400-40000004", "/history/w8472-000633"],
  "awards/recent.json": ["/awards"],
  "awards/2026.json": ["/awards/2026"],
  "profiles/a00.json": ["/organizations/org-a000000001", "/organizations/org-a000000001/respond", "/api/organizations/org-a000000001"],
  "aliases/a00.json": ["/organizations/org-a00000000f"],
  "directory/index.json": ["/organizations", "/organizations/org-a000000001"],
  "directory/on/index.json": ["/organizations/directory/on"],
  "directory/on/1.json": ["/organizations/directory/on"],
  "buyers/index.json": ["/buyers"],
  "buyers/pwgsc-tpsgc.json": ["/buyers/pwgsc-tpsgc", "/api/buyers/pwgsc-tpsgc"],
  "categories/index.json": ["/categories"],
  "categories/82.json": ["/categories/82", "/api/categories/82"],
  "rankings/all.json": ["/rankings"],
  "rankings/2026.json": ["/rankings/2026"],
  "feeds/index.json": ["/feeds"],
};

describe("malformed data files", () => {
  it("covers every fixture file", () => {
    expect(Object.keys(READERS).sort()).toEqual(Object.keys(FILES).filter((f) => f !== "directory/yt/index.json").sort());
  });

  for (const [file, paths] of Object.entries(READERS)) {
    it(`${file}: never a server error`, async () => {
      for (const body of BODIES) {
        const env = testEnv(makeFakeAssets({}, { [file]: body }));
        for (const path of paths) {
          // Each request from its own address, so the per-address page cap never trips here.
          const res = await app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `192.0.2.${(address++ % 250) + 1}` } }, env);
          // 503 "not published" is the expected answer to a file that does not read.
          expect([200, 301, 404, 503], `${path} with ${file} = ${body}`).toContain(res.status);
          expect(await res.text(), `${path} with ${file} = ${body}`).not.toContain("Something Went Wrong");
        }
      }
    });
  }
});
