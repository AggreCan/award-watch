import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { FORM_MAX_BYTES } from "../src/body";
import { app } from "../src/index";
import { fakeAssets, testEnv } from "./assets";
import profiles from "./fixtures/profiles-a00.json";

// Assets that answer like the real ones except where a test says otherwise:
// a string replaces a file's body, null removes the file, "throw" makes the
// binding itself fail.
function assetsWith(overrides: Record<string, string | null | "throw">): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname.replace(/^\/data\//, "");
      if (path in overrides) {
        const v = overrides[path];
        if (v === "throw") throw new Error("assets unavailable");
        if (v === null) return new Response("not found", { status: 404 });
        return new Response(v, { headers: { "content-type": "application/json" } });
      }
      return fakeAssets.fetch(input as Request);
    },
  } as unknown as Fetcher;
}

const brokenDb = {
  prepare: () => {
    throw new Error("D1 unavailable");
  },
  batch: async () => {
    throw new Error("D1 unavailable");
  },
} as unknown as D1Database;

const brokenBucket = {
  get: async () => {
    throw new Error("R2 unavailable");
  },
  head: async () => {
    throw new Error("R2 unavailable");
  },
} as unknown as R2Bucket;

let address = 1;
const req = (path: string, envOver: Record<string, unknown> = {}, init: RequestInit = {}) =>
  app.request(
    path,
    // A browser's navigation unless the test says otherwise: the response form's GET answers browsers only.
    { ...init, headers: { "cf-connecting-ip": `203.0.113.${address++ % 250}`, "sec-fetch-mode": "navigate", ...(init.headers as Record<string, string>) } },
    { ...testEnv(), ...envOver },
  );

// Every page that reads stats.json.
const PAGES = [
  "/", "/tenders", "/tenders/new", "/tenders/cb-100-10000001", "/awards", "/awards/2026", "/awards/cb-400-40000004",
  "/history/w8472-000633", "/organizations", "/organizations/directory/on", "/organizations/org-a000000001", "/buyers",
  "/buyers/pwgsc-tpsgc", "/segments", "/segments/82", "/rankings", "/rankings/2026", "/data", "/cite",
  "/expiring", "/expiring/3m",
];

describe("missing and corrupt data files", () => {
  it("a truncated stats.json reads as not published on every page, never a 500", async () => {
    for (const body of ['{"data_as_of":"2026-10-31","counts":{', "", "null", "[]"]) {
      for (const path of PAGES) {
        const res = await req(path, { ASSETS: assetsWith({ "stats.json": body }) });
        expect(res.status, `${path} with ${JSON.stringify(body)}`).toBe(503);
        expect(await res.text()).toContain("Data Not Published Yet");
      }
    }
    // The pages that do not need the data still answer.
    for (const path of ["/methodology", "/support", "/feeds", "/watchlist", "/corrections"]) {
      expect((await req(path, { ASSETS: assetsWith({ "stats.json": "{" }) })).status, path).toBe(200);
    }
  });

  it("a stats.json of the wrong shape is treated like a missing one; bad parts of a good one are dropped", async () => {
    for (const body of ['{"data_as_of":"2026-10-31"}', '{"counts":[],"data_as_of":"2026-10-31"}', '{"counts":{},"data_as_of":5}']) {
      expect((await req("/", { ASSETS: assetsWith({ "stats.json": body }) })).status, body).toBe(503);
    }
    const partial = JSON.stringify({ data_as_of: "2026-10-31", counts: { awards: "many", tenders_open: 3 }, new_tenders: "x", closing_soon: [{ reference: 1 }] });
    const res = await req("/", { ASSETS: assetsWith({ "stats.json": partial }) });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Open tender notices");
    expect(html).not.toContain("<span class=\"tile-label\">Award notices</span>");
    expect(html).toContain("No new notice in the last refresh.");
    expect(html).toContain("No open notice closes in the next 7 days.");
  });

  it("a list file with an unreadable row reads as not published; a shard entry that does not read is a 404", async () => {
    const first = JSON.parse(JSON.stringify((await (await fakeAssets.fetch(new Request("https://a/data/tenders/open-first.json"))).json())));
    first.rows[1].segments = "72";
    expect((await req("/tenders", { ASSETS: assetsWith({ "tenders/open-first.json": JSON.stringify(first) }) })).status).toBe(503);
    const facets = JSON.parse(JSON.stringify(first));
    facets.rows[1].segments = ["72"];
    facets.facets.buyer = [{ value: "dfo-mpo" }];
    expect((await req("/tenders", { ASSETS: assetsWith({ "tenders/open-first.json": JSON.stringify(facets) }) })).status).toBe(503);
    const year = assetsWith({ "awards/2026/1.json": '[{"reference":5}]' });
    expect((await req("/awards/2026", { ASSETS: year })).status).toBe(503);
    expect((await req("/awards/2026?page=2", { ASSETS: year })).status).toBe(200);
    const shard = JSON.parse(JSON.stringify((await (await fakeAssets.fetch(new Request("https://a/data/tenders/20a.json"))).json())));
    shard["cb-100-10000001"].amendments = null;
    const broken = assetsWith({ "tenders/20a.json": JSON.stringify(shard) });
    expect((await req("/tenders/cb-100-10000001", { ASSETS: broken })).status).toBe(404);
    // The other notice in the same shard is untouched.
    expect((await req("/tenders/cb-200-20005019", { ASSETS: broken })).status).toBe(200);
    expect((await req("/api/tenders/cb-100-10000001", { ASSETS: broken })).status).toBe(404);
  });

  it("a profile with an unreadable field is a 404 on the page, the form and the API; null where the export writes it is fine", async () => {
    const ID = "org-a000000001";
    const variant = (edit: (p: any) => void) => {
      const shard = JSON.parse(JSON.stringify(profiles));
      edit(shard[ID]);
      return assetsWith({ "profiles/a00.json": JSON.stringify(shard) });
    };
    for (const edit of [
      (p: any) => { p.organization.display_name = null; },
      (p: any) => { p.organization.id = "org-a000000009"; },
      (p: any) => { p.years[0].total = "1,100,000"; },
      (p: any) => { p.contracts = null; },
      (p: any) => { p.contracts_total_rows = "101"; },
      (p: any) => { p.lobbying[0].dpoh = [{ title: "no name" }]; },
      (p: any) => { p.awards[0].organization_id = "javascript:alert(1)"; },
      (p: any) => { p.buyers[0].buyer_id = "../../etc"; },
    ]) {
      const assets = variant(edit);
      expect((await req(`/organizations/${ID}`, { ASSETS: assets })).status).toBe(404);
      expect((await req(`/organizations/${ID}/respond`, { ASSETS: assets })).status).toBe(404);
      expect((await req(`/api/organizations/${ID}`, { ASSETS: assets })).status).toBe(404);
    }
    const nulls = variant((p) => {
      p.organization.city = null;
      p.organization.business_number = null;
      p.organization.total_awards = null;
      p.awards[0].value = null;
      p.awards[0].competitive = null;
      p.contracts[0].description_en = null;
      p.contracts[0].description_fr = null;
      p.registry[0].status = null;
    });
    const res = await req(`/organizations/${ID}`, { ASSETS: nulls });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Not stated");
  });

  it("a corrupt or missing shard is a 404, in the page and in the API", async () => {
    for (const body of ["{", null, "[]"]) {
      const assets = assetsWith({ "profiles/a00.json": body, "tenders/20a.json": body, "contracts/637.json": body });
      expect((await req("/organizations/org-a000000001", { ASSETS: assets })).status).toBe(404);
      expect((await req("/api/organizations/org-a000000001", { ASSETS: assets })).status).toBe(404);
      expect((await req("/tenders/cb-100-10000001", { ASSETS: assets })).status).toBe(404);
      expect((await req("/awards/cb-400-40000004", { ASSETS: assets })).status).toBe(404);
      expect((await req("/history/w8472-000633", { ASSETS: assets })).status).toBe(404);
    }
  });

  it("an assets binding that throws gives the not-published page", async () => {
    for (const path of ["/", "/tenders", "/organizations/org-a000000001"]) {
      const res = await req(path, { ASSETS: assetsWith({ "stats.json": "throw" }) });
      expect(res.status, path).toBe(503);
    }
    const shardDown = await req("/organizations/org-a000000001", { ASSETS: assetsWith({ "profiles/a00.json": "throw" }) });
    expect(shardDown.status).toBe(404);
  });
});

describe("storage outages", () => {
  it("pages render with D1 down; the support page shows its empty state", async () => {
    const profile = await req("/organizations/org-a000000001", { DB: brokenDb });
    expect(profile.status).toBe(200);
    const html = await profile.text();
    expect(html).toContain("Exemplar Translation Services Inc.");
    expect(html).toContain("The organization has not published a response.");
    const support = await req("/support", { DB: brokenDb });
    expect(support.status).toBe(200);
    expect(await support.text()).toContain("Monthly support received: $0.00.");
    expect((await req("/support", { DB: undefined })).status).toBe(200);
  });

  it("forms fail politely with D1 down: the form comes back with what was typed", async () => {
    const form = (path: string, fields: Record<string, string>) =>
      req(path, { DB: brokenDb }, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      });
    const response = await form("/organizations/org-a000000001/respond", { text: "A statement long enough to pass the form's check.", contact: "office@example.invalid" });
    expect(response.status).toBe(503);
    const html = await response.text();
    expect(html).toContain("Try again in a moment.");
    expect(html).toContain("A statement long enough to pass the form&#39;s check.");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const correction = await form("/corrections", { page: "/organizations/org-a000000002", text: "The city is out of date." });
    expect(correction.status).toBe(503);
    expect(await correction.text()).toContain("The city is out of date.");
  });

  it("the donation webhook answers 503 when it cannot store, so the notice is sent again", async () => {
    const doc = {
      verification_token: "tok-123456", kofi_transaction_id: "tx-outage-1", amount: "5.00", currency: "CAD",
      timestamp: new Date().toISOString(), type: "Donation",
    };
    const res = await req("/hooks/kofi", { DB: brokenDb, KOFI_VERIFICATION_TOKEN: "tok-123456" }, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: JSON.stringify(doc) }).toString(),
    });
    expect(res.status).toBe(503);
  });

  it("downloads answer 503 when R2 fails and 404 when it is not bound or not on the list", async () => {
    const down = await req("/downloads/organizations.csv", { DATA: brokenBucket });
    expect(down.status).toBe(503);
    expect(await down.text()).toContain("is not available right now");
    expect((await req("/downloads/awards-2024.csv", { DATA: brokenBucket })).status).toBe(503);
    expect((await req("/downloads/organizations.csv", { DATA: undefined })).status).toBe(404);
    for (const path of ["/downloads/..%2Fstatus.json", "/downloads/mirror/..%2F..%2Fstatus.json", "/downloads/awards-24.csv", "/downloads/grants-2024.csv"]) {
      expect((await req(path, { DATA: brokenBucket })).status, path).toBe(404);
    }
  });
});

describe("hostile form bodies", () => {
  const post = (path: string, body: BodyInit, headers: Record<string, string>) =>
    req(path, {}, { method: "POST", headers, body });

  it("a multipart body without its boundary, or a non-form body, is a 400, never a 500", async () => {
    for (const path of ["/corrections", "/organizations/org-a000000001/respond"]) {
      expect((await post(path, "garbage", { "content-type": "multipart/form-data" })).status, path).toBe(400);
      expect((await post(path, "--zz\r\nbroken", { "content-type": "multipart/form-data; boundary=zz" })).status, path).toBe(400);
      expect((await post(path, '{"text":"x"}', { "content-type": "application/json" })).status, path).toBe(400);
      expect((await post(path, "a=1", {})).status, path).toBe(400);
    }
  });

  it("an oversized body is refused before it is parsed, declared or not", async () => {
    const big = "text=" + "x".repeat(FORM_MAX_BYTES + 10);
    const declared = await post("/corrections", big, { "content-type": "application/x-www-form-urlencoded" });
    expect(declared.status).toBe(413);
    const stream = new ReadableStream({
      start(controller) {
        const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
        controller.enqueue(new TextEncoder().encode("text="));
        for (let i = 0; i < 8; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const undeclared = await req("/corrections", {}, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: stream,
      // @ts-expect-error duplex is required for a streamed body and missing from the type
      duplex: "half",
    });
    expect(undeclared.status).toBe(413);
  });

  it("null bytes and other control characters never reach the database", async () => {
    const res = await post(
      "/corrections",
      new URLSearchParams({ page: "cb-100-\u000010000001", text: "Region\u0000 shown\u0007 wrongly.\nSecond line." }).toString(),
      { "content-type": "application/x-www-form-urlencoded" },
    );
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT page, text FROM corrections ORDER BY id DESC LIMIT 1").first<{ page: string; text: string }>();
    expect(row?.page).toBe("cb-100-10000001");
    expect(row?.text).toBe("Region shown wrongly.\nSecond line.");
  });

  it("markup in a form comes back escaped", async () => {
    const res = await post(
      "/corrections",
      new URLSearchParams({ page: "<script>x</script>", text: "<img src=x onerror=alert(1)>", contact: "<b>not-an-address" }).toString(),
      { "content-type": "application/x-www-form-urlencoded" },
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("odd query input", () => {
  it("filters, page numbers, references and language inputs never fail and never echo raw markup", async () => {
    const mark = "<x9z>";
    const m = encodeURIComponent(mark);
    for (const path of [
      `/tenders?q=${"a".repeat(5000)}`,
      `/tenders?q=${m}&segment=${m}&province=${m}&buyer=${m}&type=${m}&method=${m}&closing=${m}&sort=${m}&category=${m}`,
      "/tenders?page=-1", "/tenders?page=99999999", "/tenders?page=NaN", "/tenders?page=1e400", "/tenders?q=%ff%fe", "/tenders?q=%",
      `/tenders?q=${encodeURIComponent("\u202eabc \u05e9\u05dc\u05d5\u05dd \ud83d\ude00")}`,
      `/tenders/new?day=${m}`, "/tenders/new?day=1999-01-01", `/tenders/${m}`, "/tenders/..%2F..%2Fstats",
      `/awards?page=${m}`, `/awards/${m}`, "/awards/1999", "/awards/9999", `/history/${m}`,
      `/organizations/${m}`, "/organizations/ORG-A000000001", `/organizations/directory/${m}`, "/organizations/directory/on/0",
      `/buyers/${m}`, "/buyers/..%2Fstats", `/categories/${m}`, "/categories/00", `/rankings/${m}`, `/rankings?source=${m}&by=${m}`,
      "/?lang=zz", `/corrections?organization=${m}`, `/api/tenders/${m}`, `/api/buyers/${m}`, `/api/categories/${m}`,
    ]) {
      const res = await req(path);
      expect(res.status, path).toBeLessThan(500);
      expect(await res.text(), path).not.toContain(mark);
    }
    const garbage = await req("/", {}, { headers: { cookie: "lang=%%%;;" } });
    expect(garbage.status).toBe(200);
  });
});
