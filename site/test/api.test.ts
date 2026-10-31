import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { emptyAssets, testEnv } from "./assets";

const json = async (path: string, env = testEnv()) => {
  const res = await app.request(path, {}, env);
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
};

describe("api", () => {
  it("stats passes the file through", async () => {
    const { status, body, headers } = await json("/api/stats");
    expect(status).toBe(200);
    expect(body.counts.awards).toBe(5883);
    expect(body.data_as_of).toBe("2026-10-31");
    expect(headers.get("content-type")).toContain("application/json");
    expect(headers.get("cache-control")).toContain("max-age=300");
  });

  it("an organization from its profile shard; a retired id redirects; anything else is a 404", async () => {
    const { status, body } = await json("/api/organizations/org-a000000001");
    expect(status).toBe(200);
    expect(body.organization.display_name).toBe("Exemplar Translation Services Inc.");
    expect(body.contracts_total_rows).toBe(101);
    const moved = await app.request("/api/organizations/org-a00000000f", {}, testEnv());
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe("/api/organizations/org-a000000001");
    expect((await json("/api/organizations/org-ffffffffff")).status).toBe(404);
    expect((await json("/api/organizations/not-an-id")).status).toBe(404);
  });

  it("a tender notice from its shard, in any case, without its contact", async () => {
    const lower = await json("/api/tenders/cb-100-10000001");
    expect(lower.status).toBe(200);
    expect(lower.body.reference).toBe("cb-100-10000001");
    expect(lower.body.amendments).toHaveLength(2);
    expect((await json("/api/tenders/CB-100-10000001")).body.reference).toBe("cb-100-10000001");
    // The fixture carries a contact to prove the API drops it.
    expect(JSON.stringify(lower.body)).not.toMatch(/contact|example\.invalid/);
    expect((await json("/api/tenders/cb-999-99999999")).status).toBe(404);
    expect((await json("/api/tenders/not%20a%20reference")).status).toBe(404);
  });

  it("a buyer and a category pass their files through", async () => {
    const buyer = await json("/api/buyers/pwgsc-tpsgc");
    expect(buyer.status).toBe(200);
    expect(buyer.body.buyer.acronym_en).toBe("PSPC");
    expect((await json("/api/buyers/nobody")).status).toBe(404);
    expect((await json("/api/buyers/BAD_ID")).status).toBe(404);
    const cat = await json("/api/categories/82");
    expect(cat.status).toBe(200);
    expect(cat.body.code).toBe("82");
    expect((await json("/api/categories/99")).status).toBe(404);
    expect((await json("/api/categories/8")).status).toBe(404);
  });

  it("answers 503 before the files are published, and JSON 404s elsewhere", async () => {
    expect((await json("/api/stats", testEnv(emptyAssets))).status).toBe(503);
    const unknown = await json("/api/organizations");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("not found");
  });
});
