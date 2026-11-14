import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { testEnv } from "./assets";

// Each post comes from its own address, so the per-address form cap (5 a minute) never trips here.
let nextAddress = 1;
const post = (path: string, fields: Record<string, string>) =>
  app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": `198.51.100.${nextAddress++}` },
      body: new URLSearchParams(fields).toString(),
    },
    testEnv(),
  );

// What a current browser sends when it follows a link on the site's own pages.
const NAVIGATE = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "same-origin" };
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const STATEMENT = "Our standing offer covers three departments; each call-up is reported separately by the department.";

describe("forms", () => {
  it("renders the response form for a known organization only", async () => {
    const res = await app.request("/organizations/org-a000000001/respond", { headers: NAVIGATE }, testEnv());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Respond as This Organization");
    expect(html).toContain('<a href="/organizations/org-a000000001">Exemplar Translation Services Inc.</a>');
    expect(html).toContain('<meta name="robots" content="noindex"');
    const unknown = await app.request("/organizations/org-ffffffffff/respond", { headers: NAVIGATE }, testEnv());
    expect(unknown.status).toBe(404);
  });

  it("stores a valid response unpublished, with its contact", async () => {
    const res = await post("/organizations/org-a000000002/respond", { text: STATEMENT, contact: "office@example.invalid" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Thank You");
    const row = await env.DB.prepare("SELECT * FROM organization_responses WHERE organization_id = ?").bind("org-a000000002").first<any>();
    expect(row.published).toBe(0);
    expect(row.text).toContain("standing offer");
    expect(row.contact).toBe("office@example.invalid");
    expect(row.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // A row waiting for review never shows on the profile.
    const profile = await (await app.request("/organizations/org-a000000002", {}, testEnv())).text();
    expect(profile).not.toContain("standing offer covers three departments");
  });

  it("rejects the honeypot and bad input", async () => {
    const bot = await post("/organizations/org-a000000001/respond", { text: STATEMENT, website: "http://spam" });
    expect(bot.status).toBe(400);
    const bad = await post("/organizations/org-a000000001/respond", { text: "short", contact: "not-an-email" });
    expect(bad.status).toBe(400);
    const html = await bad.text();
    expect(html).toContain("does not look complete");
    expect(html).toContain("at least 20 characters");
    const unknown = await post("/organizations/org-ffffffffff/respond", { text: STATEMENT });
    expect(unknown.status).toBe(404);
  });

  it("stores a response posted with no Fetch Metadata and no Referer: the POST is not checked", async () => {
    const res = await post("/organizations/org-a000000001/respond", { text: STATEMENT, contact: "unchecked@example.invalid" });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM organization_responses WHERE organization_id = ? AND contact = ?",
    ).bind("org-a000000001", "unchecked@example.invalid").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("stores corrections and links them to an organization when the page names one", async () => {
    const res = await post("/corrections", { page: "https://awardwatch.ca/organizations/org-a000000002", text: "The city shown is the old head office.", contact: "" });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT * FROM corrections ORDER BY id DESC LIMIT 1").first<any>();
    expect(row.organization_id).toBe("org-a000000002");
    expect(row.page).toBe("https://awardwatch.ca/organizations/org-a000000002");
    expect(row.published).toBe(0);
    expect(row.contact).toBeNull();
    const hidden = await post("/corrections", { page: "cb-400-40000004", text: "The supplier on this award is a different firm.", organization: "org-a000000001" });
    expect(hidden.status).toBe(200);
    expect((await env.DB.prepare("SELECT * FROM corrections ORDER BY id DESC LIMIT 1").first<any>()).organization_id).toBe("org-a000000001");
    const loose = await post("/corrections", { page: "cb-200-20005019", text: "The region of delivery is wrong." });
    expect(loose.status).toBe(200);
    expect((await env.DB.prepare("SELECT * FROM corrections ORDER BY id DESC LIMIT 1").first<any>()).organization_id).toBeNull();
    const unknownOrg = await post("/corrections", { page: "/organizations/org-ffffffffff", text: "No such profile should be linked." });
    expect(unknownOrg.status).toBe(200);
    expect((await env.DB.prepare("SELECT * FROM corrections ORDER BY id DESC LIMIT 1").first<any>()).organization_id).toBeNull();
    const invalid = await post("/corrections", { page: "x", text: "short" });
    expect(invalid.status).toBe(400);
    const html = await invalid.text();
    expect(html).toContain("Name the page or record.");
    expect(html).toContain("at least 10 characters");
  });

  it("carries the organization from the profile's link into the form", async () => {
    const html = await (await app.request("/corrections?organization=org-a000000001", {}, testEnv())).text();
    expect(html).toContain('<input type="hidden" name="organization" value="org-a000000001"');
  });
});

// A stand-in for the Analytics Engine binding that keeps what it is given.
function recorder() {
  const points: AnalyticsEngineDataPoint[] = [];
  const dataset = { writeDataPoint: (p?: AnalyticsEngineDataPoint) => void (p && points.push(p)) } as AnalyticsEngineDataset;
  return { points, dataset };
}

describe("the response form opens in a browser only", () => {
  const FORM = "/organizations/org-a000000001/respond";
  const open = (path: string, headers: Record<string, string>, dataset?: AnalyticsEngineDataset) =>
    app.request(path, { headers: { "user-agent": CHROME, ...headers } }, { ...testEnv(), VIEWS: dataset });

  it("refuses a request with no Fetch Metadata and no Referer, naming the profile, and counts it as a bot", async () => {
    const { points, dataset } = recorder();
    const res = await open(FORM, {}, dataset);
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toContain("Sec-Fetch-Mode");
    expect(await res.text()).toBe("This form opens in a web browser. The profile is at https://awardwatch.ca/organizations/org-a000000001.");
    expect(points).toHaveLength(1);
    expect(points[0].blobs?.slice(0, 2)).toEqual(["/organizations/:id/respond", "page"]);
    expect(points[0].blobs?.slice(7)).toEqual(["bot", "", "", ""]);
    expect(points[0].doubles).toEqual([403]);
  });

  it("refuses in the request's language", async () => {
    const res = await open(`${FORM}?lang=fr`, {});
    expect(res.status).toBe(403);
    expect(await res.text()).toBe(
      "Ce formulaire s’ouvre dans un navigateur Web. Le profil se trouve à https://awardwatch.ca/organizations/org-a000000001?lang=fr.",
    );
    const cookie = await open(FORM, { cookie: "lang=fr" });
    expect(await cookie.text()).toContain("Ce formulaire");
  });

  it("refuses a Referer from another site when no Fetch Metadata comes with it", async () => {
    for (const referer of ["https://news.example.org/story", "https://awardwatch.ca.example.org/", "not a url"]) {
      expect((await open(FORM, { referer })).status, referer).toBe(403);
    }
  });

  it("serves a navigation from the site's own pages", async () => {
    const { points, dataset } = recorder();
    const res = await open(FORM, NAVIGATE, dataset);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Respond as This Organization");
    expect(points[0].blobs?.[7]).toBe("human");
  });

  it("serves any Sec-Fetch-Mode, and a link followed from another site", async () => {
    expect((await open(FORM, { "sec-fetch-mode": "no-cors" })).status).toBe(200);
    const res = await open(FORM, { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(200);
  });

  it("serves a Referer from the site's own host alone", async () => {
    for (const referer of ["https://awardwatch.ca/organizations/org-a000000001", "https://www.awardwatch.ca/tenders?q=x", "http://localhost/organizations/org-a000000001"]) {
      expect((await open(FORM, { referer })).status, referer).toBe(200);
    }
  });

  it("keeps the redirect for a retired id and the 404 for an unknown one, for a browser", async () => {
    const moved = await open("/organizations/org-a00000000f/respond", NAVIGATE);
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe("/organizations/org-a000000001/respond");
    expect((await open("/organizations/org-ffffffffff/respond", NAVIGATE)).status).toBe(404);
    // A path that is no organization id is never written into the refusal.
    expect((await open("/organizations/not-an-id/respond", {})).status).toBe(404);
  });

  it("leaves the corrections page open to any client", async () => {
    const res = await app.request("/corrections", { headers: { "user-agent": "curl/8.5.0" } }, testEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<form");
  });
});
