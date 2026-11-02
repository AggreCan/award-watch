// Retired organization ids. An id is the SHA-1 of the normalized name, so a
// change to the name rules moves an organization to a new id; the export can
// list the old ids in aliases/<ab>.json (keyed by characters 5 and 6 of the
// old id) and every route that takes an id sends
// the old one to the new one.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { loadAlias } from "../src/data";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { makeFakeAssets, testEnv } from "./assets";

const OLD = "org-a00000000f";
const LIVE = "org-a000000001";
const browser = { "sec-fetch-mode": "navigate" };

describe("retired organization ids", () => {
  it("loadAlias reads the live id from the old id's shard", async () => {
    const e = testEnv() as unknown as Env;
    expect(await loadAlias(e, OLD)).toBe(LIVE);
    expect(await loadAlias(e, LIVE)).toBeNull();
    expect(await loadAlias(e, "not-an-id")).toBeNull();
  });

  it("the profile page answers 301 to the live id, keeping the language and nothing else", async () => {
    const res = await app.request(`/organizations/${OLD}?lang=fr&utm=x`, {}, testEnv());
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`/organizations/${LIVE}?lang=fr`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const plain = await app.request(`/organizations/${OLD}`, {}, testEnv());
    expect(plain.headers.get("location")).toBe(`/organizations/${LIVE}`);
  });

  it("the response form redirects a GET with 301 and a POST with 308, storing nothing under the old id", async () => {
    const get = await app.request(`/organizations/${OLD}/respond`, { headers: browser }, testEnv());
    expect(get.status).toBe(301);
    expect(get.headers.get("location")).toBe(`/organizations/${LIVE}/respond`);
    const post = await app.request(
      `/organizations/${OLD}/respond`,
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ text: "A statement long enough for the form." }).toString() },
      testEnv(),
    );
    expect(post.status).toBe(308);
    expect(post.headers.get("location")).toBe(`/organizations/${LIVE}/respond`);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM organization_responses WHERE organization_id = ?").bind(OLD).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("the API answers 301 to the live id's API path", async () => {
    const res = await app.request(`/api/organizations/${OLD}`, {}, testEnv());
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`/api/organizations/${LIVE}`);
  });

  it("an id with no alias is still a 404 on the page, the form and the API", async () => {
    for (const path of ["/organizations/org-a00000000c", "/organizations/org-a00000000c/respond", "/api/organizations/org-a00000000c"]) {
      expect((await app.request(path, { headers: browser }, testEnv())).status, path).toBe(404);
    }
  });

  it("a malformed shard or entry reads as no alias: a 404, never a 500, and never a loop", async () => {
    // The fixture maps one id to itself and one to text that is no id.
    for (const id of ["org-a00000000e", "org-a00000000d"]) {
      expect((await app.request(`/organizations/${id}`, {}, testEnv())).status, id).toBe(404);
    }
    for (const body of ["{", "[]", '{"org-a00000000f": 5}']) {
      const assets = makeFakeAssets({}, { "aliases/a0.json": body });
      expect((await app.request(`/organizations/${OLD}`, {}, testEnv(assets))).status, body).toBe(404);
    }
  });

  it("counts a redirect under the route's template, with its status", async () => {
    const points: AnalyticsEngineDataPoint[] = [];
    const dataset = { writeDataPoint: (p?: AnalyticsEngineDataPoint) => void (p && points.push(p)) } as AnalyticsEngineDataset;
    await app.request(`/organizations/${OLD}`, {}, { ...testEnv(), VIEWS: dataset });
    expect(points[0].blobs?.slice(0, 2)).toEqual(["/organizations/:id", "page"]);
    expect(points[0].doubles).toEqual([301]);
  });
});
