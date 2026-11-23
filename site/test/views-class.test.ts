// The visit counts' classes beyond "bot" and "human" (src/views.ts): "hosted"
// for a browser-shaped request from a listed hosting network, "closed" for the
// response form opened from anywhere but its profile; and the routes counted
// by name that were "other" before them. Every user agent and every edge
// object is written out here; nothing is read from the network.
import { describe, expect, it } from "vitest";
import { SAMPLE_MESSAGE_PATH, SAMPLE_PATH } from "../src/account/briefing_pages";
import { app } from "../src/index";
import { PIPELINE_PARTS } from "../src/sitemaps";
import indexSource from "../src/index.tsx?raw";
import accountRoutes from "../src/account/routes.tsx?raw";
import {
  AGENT_RULE, HOSTED_ASNS, HOSTED_ASNS_LISTED, audienceClass, isHostedNetwork, opensClosedPage, routeTemplate,
  type EdgeProps, type Kind,
} from "../src/views";
import { testEnv } from "./assets";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const IP = "198.51.100.23";
const NAVIGATE = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "none" };
const PROFILE = "/organizations/org-a000000001";
const FORM = `${PROFILE}/respond`;
const URL_OF = (path: string) => `https://awardwatch.ca${path}`;

// Edge objects as Cloudflare's request.cf gives them (only the fields the Worker reads, and two it never keeps).
const EDGE: Record<string, EdgeProps & { asOrganization?: string; city?: string }> = {
  // The crawler pool of 2026-11-13 on: browser headers from data centres in the US and Hong Kong.
  poolUS: { country: "US", asn: 16509, asOrganization: "Amazon.com, Inc.", city: "Ashburn" },
  poolHK: { country: "HK", asn: 45102, asOrganization: "Alibaba US Technology Co., Ltd.", city: "Hong Kong" },
  tencentHK: { country: "HK", asn: 132203, asOrganization: "Tencent Building, Kejizhongyi Avenue" },
  azure: { country: "CA", asn: 8075, asOrganization: "Microsoft Corporation" },
  // People: a home connection, a phone on a mobile network, an office ISP, Apple's Private Relay, Cloudflare's WARP.
  home: { country: "CA", asn: 812, asOrganization: "Rogers Communications Canada Inc." },
  phone: { country: "CA", asn: 852, asOrganization: "TELUS Communications Inc." },
  office: { country: "CA", asn: 577, asOrganization: "Bell Canada" },
  privateRelay: { country: "CA", asn: 36183, asOrganization: "Akamai Technologies, Inc." },
  warp: { country: "CA", asn: 13335, asOrganization: "Cloudflare, Inc." },
  // Google's own crawler, verified by the edge, from Google's network.
  googlebot: { country: "US", asn: 15169, verifiedBotCategory: "Search Engine Crawler", asOrganization: "Google LLC" },
};

function headers(ua: string, extra: Record<string, string> = {}): Headers {
  return new Headers({ "user-agent": ua, ...NAVIGATE, ...extra });
}

function classOf(path: string, ua: string, edge: EdgeProps | undefined, extra: Record<string, string> = {}, method = "GET") {
  const { kind } = routeTemplate(method, path);
  return audienceClass(edge, kind, method, path, headers(ua, extra), URL_OF(path));
}

describe("the classes a person's request is told apart by", () => {
  it("counts a browser-shaped request from a listed hosting network as hosted, the crawler pool's requests among them", () => {
    for (const edge of [EDGE.poolUS, EDGE.poolHK, EDGE.tencentHK, EDGE.azure]) {
      for (const path of [PROFILE, "/history/w8472-000633", FORM, "/"]) {
        expect(classOf(path, CHROME, edge), `${edge.asn} ${path}`).toBe("hosted");
      }
    }
    // The device does not matter: a phone's agent from a data centre is hosted too.
    expect(classOf(PROFILE, IPHONE, EDGE.poolUS)).toBe("hosted");
  });

  it("counts people on home, office and mobile networks, and behind Private Relay or WARP, as people", () => {
    for (const edge of [EDGE.home, EDGE.phone, EDGE.office, EDGE.privateRelay, EDGE.warp, undefined, {}]) {
      for (const ua of [CHROME, MAC_SAFARI, IPHONE, ANDROID]) {
        expect(classOf(PROFILE, ua, edge), `${edge?.asn} ${ua}`).toBe("human");
      }
    }
  });

  it("keeps every bot a bot, whatever the network", () => {
    expect(classOf(PROFILE, GOOGLEBOT, EDGE.googlebot)).toBe("bot");
    expect(classOf(PROFILE, CHROME, EDGE.googlebot)).toBe("bot"); // the edge's verified category alone
    expect(classOf(PROFILE, "curl/8.5.0", EDGE.poolUS)).toBe("bot");
    expect(classOf(PROFILE, "python-requests/2.32.3", EDGE.home)).toBe("bot");
    // A browser's agent with no Fetch Metadata stays a bot, on a hosting network or not.
    expect(audienceClass(EDGE.poolHK, "page", "GET", PROFILE, new Headers({ "user-agent": CHROME }), URL_OF(PROFILE))).toBe("bot");
    expect(classOf("/data/feeds/canada/tenders.xml", CHROME, EDGE.poolUS)).toBe("bot");
  });

  it("reads the network number only as the edge gives it, a number", () => {
    expect(isHostedNetwork(16509)).toBe(true);
    for (const value of ["16509", 16509.5, null, undefined, NaN, 812, 13335, 36183, 54113, 20940]) {
      expect(isHostedNetwork(value), String(value)).toBe(false);
    }
  });

  it("counts the response form opened from anywhere but its profile as closed", () => {
    const fromProfile = { referer: URL_OF(PROFILE), "sec-fetch-site": "same-origin" };
    expect(classOf(FORM, CHROME, EDGE.home, fromProfile)).toBe("human");
    expect(classOf(FORM, CHROME, EDGE.home, { referer: `${URL_OF(PROFILE)}?lang=fr` })).toBe("human");
    // The form's own language link opens it again from itself.
    expect(classOf(FORM, CHROME, EDGE.home, { referer: URL_OF(FORM) })).toBe("human");
    expect(classOf(FORM, IPHONE, EDGE.phone, { referer: `https://www.awardwatch.ca${PROFILE}` })).toBe("human");
    for (const referer of [undefined, "https://www.google.com/", URL_OF("/organizations/org-a000000002"), URL_OF("/"),
      "https://awardwatch.ca.example.org/organizations/org-a000000001", "not a url"]) {
      const extra: Record<string, string> = referer === undefined ? {} : { referer };
      expect(classOf(FORM, CHROME, EDGE.home, extra), String(referer)).toBe("closed");
      expect(classOf(FORM, CHROME, EDGE.home, extra, "HEAD"), String(referer)).toBe("closed");
    }
    // A post of the form is a person's answer, never closed; a bot stays a bot; a hosted request stays hosted.
    expect(classOf(FORM, CHROME, EDGE.home, {}, "POST")).toBe("human");
    expect(classOf(FORM, "curl/8.5.0", EDGE.home)).toBe("bot");
    expect(classOf(FORM, CHROME, EDGE.poolHK)).toBe("hosted");
    // Only the response form: any other page without a referrer is a person's.
    expect(classOf(PROFILE, CHROME, EDGE.home)).toBe("human");
    expect(opensClosedPage("GET", "/organizations/org-a000000001/records", undefined, URL_OF("/"))).toBe(false);
  });

  it("keeps a short, dated list that leaves out the relays people browse through", () => {
    expect(HOSTED_ASNS_LISTED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(HOSTED_ASNS.size).toBeGreaterThanOrEqual(10);
    expect(HOSTED_ASNS.size).toBeLessThanOrEqual(40);
    for (const relay of [13335, 20940, 36183, 54113, 9009, 60068]) expect(HOSTED_ASNS.has(relay), String(relay)).toBe(false);
    for (const [asn, holder] of HOSTED_ASNS) {
      expect(Number.isInteger(asn) && asn > 0, String(asn)).toBe(true);
      expect(holder.length, String(asn)).toBeGreaterThan(0);
    }
  });
});

// A stand-in for the Analytics Engine binding that keeps what it is given.
function recorder() {
  const points: AnalyticsEngineDataPoint[] = [];
  const dataset = { writeDataPoint: (p?: AnalyticsEngineDataPoint) => void (p && points.push(p)) } as AnalyticsEngineDataset;
  return { points, dataset };
}

async function visit(path: string, edge: object | undefined, init: { ua?: string; headers?: Record<string, string>; method?: string } = {}) {
  const { points, dataset } = recorder();
  const req = new Request(URL_OF(path), {
    method: init.method ?? "GET",
    headers: { "cf-connecting-ip": IP, "user-agent": init.ua ?? CHROME, ...NAVIGATE, ...init.headers },
  });
  if (edge) Object.defineProperty(req, "cf", { value: edge });
  const res = await app.fetch(req, { ...testEnv(), VIEWS: dataset, VIEWS_SALT_KEY: "test-secret" });
  expect(points, path).toHaveLength(1);
  return { res, blobs: points[0].blobs as string[], raw: JSON.stringify(points) };
}

describe("the data point of each class", () => {
  it("writes hosted with the device and the rule, no visitor code, and nothing about the network", async () => {
    const { res, blobs, raw } = await visit(PROFILE, EDGE.poolHK);
    expect(res.status).toBe(200);
    expect(blobs).toEqual(["/organizations/:id", "page", "en", "HK", "", "GET", "", "hosted", "desktop", "", "", AGENT_RULE]);
    for (const secret of ["45102", "Alibaba", "Hong Kong", IP, CHROME, "org-a000000001", "test-secret"]) {
      expect(raw, secret).not.toContain(secret);
    }
  });

  it("writes closed for the form opened without its profile, with no code; a person from the profile keeps one", async () => {
    const closed = await visit(FORM, EDGE.home);
    expect(closed.res.status).toBe(200);
    expect(closed.blobs.slice(7)).toEqual(["closed", "desktop", "", "", AGENT_RULE]);
    const person = await visit(FORM, EDGE.home, { headers: { referer: URL_OF(PROFILE), "sec-fetch-site": "same-origin" } });
    expect(person.blobs.slice(7, 9)).toEqual(["human", "desktop"]);
    // The code itself is held by views.test.ts; here only that a person's request carries one.
    expect(person.blobs[9]).toMatch(/^[0-9a-f]{16}$/);
    expect(person.blobs[11]).toBe(AGENT_RULE);
    expect(closed.raw).not.toContain("812");
    expect(closed.raw).not.toContain("Rogers");
  });

  it("writes a person on a phone as before, with the rule added", async () => {
    const { blobs } = await visit("/tenders", EDGE.phone, { ua: IPHONE });
    expect([...blobs.slice(7, 9), ...blobs.slice(10)]).toEqual(["human", "mobile", "", AGENT_RULE]);
    expect(blobs[9]).toMatch(/^[0-9a-f]{16}$/);
  });

  it("writes the rule on every point, bots and files included", async () => {
    for (const [path, ua, edge] of [["/robots.txt", GOOGLEBOT, EDGE.googlebot], ["/api/stats", "curl/8.5.0", undefined],
      ["/nothing-here", CHROME, EDGE.home]] as const) {
      const { blobs } = await visit(path, edge, { ua });
      expect(blobs, path).toHaveLength(12);
      expect(blobs[11], path).toBe(AGENT_RULE);
    }
  });
});

// Every route index.tsx registers, by a sample address, with the template and kind it is counted under. A route
// added to index.tsx changes the count below and fails the test until it is named here.
const INDEX_ROUTES: [method: string, path: string, route: string, kind: Kind][] = [
  ["GET", "/", "/", "page"],
  ["GET", "/overview", "/overview", "page"],
  ["GET", "/tenders", "/tenders", "page"],
  ["GET", "/tenders/new", "/tenders/new", "page"],
  ["GET", "/tenders/same-day", "/tenders/same-day", "page"],
  ["GET", "/tenders/cb-100-10000001.ics", "/tenders/:reference.ics", "download"],
  ["GET", "/tenders/cb-100-10000001", "/tenders/:reference", "page"],
  ["GET", "/awards", "/awards", "page"],
  ["GET", "/awards/erroneous", "/awards/erroneous", "page"],
  ["GET", "/awards/cb-400-40000004.ics", "/awards/:reference.ics", "download"],
  ["GET", "/awards/2026", "/awards/:year", "page"],
  ["GET", "/history/w8472-000633.ics", "/history/:reference.ics", "download"],
  ["GET", "/history/w8472-000633", "/history/:reference", "page"],
  ["GET", "/contracts/dnd-mdn/W8472-000633.ics", "/contracts/:dept/:reference.ics", "download"],
  ["GET", "/contracts/dnd-mdn/W8472-000633", "/contracts/:dept/:reference", "page"],
  ["GET", "/expiring", "/expiring", "page"],
  ["GET", "/expiring/3m", "/expiring/:window", "page"],
  ["GET", "/expiring/6m/rows.csv", "/expiring/:window/rows.csv", "download"],
  ["GET", "/organizations", "/organizations", "page"],
  ["GET", "/organizations/directory", "/organizations/directory", "page"],
  ["GET", "/organizations/directory/on", "/organizations/directory/:code", "page"],
  ["GET", "/organizations/directory/on/2", "/organizations/directory/:code/:page", "page"],
  ["GET", PROFILE, "/organizations/:id", "page"],
  ["GET", `${PROFILE}/records`, "/organizations/:id/records", "page"],
  ["GET", `${PROFILE}/records.csv`, "/organizations/:id/records.csv", "download"],
  ["GET", "/buyers/dnd-mdn/records", "/buyers/:id/records", "page"],
  ["GET", "/buyers/dnd-mdn/records.csv", "/buyers/:id/records.csv", "download"],
  ["GET", `${PROFILE}/analytics`, "/organizations/:id/analytics", "page"],
  ["GET", `${PROFILE}/analytics/years.csv`, "/organizations/:id/analytics/:table.csv", "download"],
  ["GET", FORM, "/organizations/:id/respond", "page"],
  ["POST", FORM, "/organizations/:id/respond", "form"],
  ["GET", "/buyers", "/buyers", "page"],
  ["GET", "/buyers/dnd-mdn", "/buyers/:id", "page"],
  ["GET", "/buyers/dnd-mdn/analytics", "/buyers/:id/analytics", "page"],
  ["GET", "/buyers/dnd-mdn/analytics/years.csv", "/buyers/:id/analytics/:table.csv", "download"],
  ["GET", "/segments", "/segments", "page"],
  ["GET", "/segments/82", "/segments/:nn", "page"],
  ["GET", "/provinces", "/provinces", "page"],
  ["GET", "/provinces/british-columbia", "/provinces/:slug", "page"],
  ["GET", "/segments/82/analytics", "/segments/:nn/analytics", "page"],
  ["GET", "/segments/82/analytics/years.csv", "/segments/:nn/analytics/:table.csv", "download"],
  ["GET", "/analytics", "/analytics", "page"],
  ["GET", "/analytics/build", "/analytics/build", "page"],
  ["GET", "/analytics/build.csv", "/analytics/build.csv", "download"],
  ["GET", "/categories", "/categories", "page"],
  ["GET", "/categories/82", "/categories/:nn", "page"],
  ["GET", "/rankings", "/rankings", "page"],
  ["GET", "/monthly", "/monthly", "page"],
  ["GET", "/monthly/months.csv", "/monthly/months.csv", "download"],
  ["GET", "/monthly/2026-10", "/monthly/:month", "page"],
  ["GET", "/monthly/2026-10/largest.csv", "/monthly/:month/:table.csv", "download"],
  ["GET", "/instruments", "/instruments", "page"],
  ["GET", "/instruments/rows.csv", "/instruments/rows.csv", "download"],
  ["GET", "/instruments/E60ZT-120002%2F001%2FZT", "/instruments/:agreement", "page"],
  ["GET", "/rankings/2025", "/rankings/:year", "page"],
  ["GET", "/search", "/search", "page"],
  ["GET", "/feeds", "/feeds", "page"],
  ["GET", "/watchlist", "/watchlist", "page"],
  ["GET", "/alerts", "/alerts", "page"],
  ["POST", "/interest", "/interest", "form"],
  ["GET", "/interest", "/interest", "page"],
  ["GET", "/interest/stop", "/interest/stop", "page"],
  ["POST", "/interest/stop", "/interest/stop", "form"],
  ["GET", "/pro", "/pro", "page"],
  ["GET", SAMPLE_PATH, "/pro/briefing-sample", "page"],
  ["GET", `${SAMPLE_MESSAGE_PATH}/dark`, "/pro/briefing-sample/message/:scheme", "file"],
  ["GET", "/data", "/data", "page"],
  ["GET", "/methodology", "/methodology", "page"],
  ["GET", "/guides", "/guides", "page"],
  ["GET", "/guides/no-such-guide", "/guides/:slug", "page"],
  ["GET", "/cite", "/cite", "page"],
  ["GET", "/about", "/about", "page"],
  ["GET", "/terms", "/terms", "page"],
  ["GET", "/privacy", "/privacy", "page"],
  ["GET", "/corrections", "/corrections", "page"],
  ["POST", "/corrections", "/corrections", "form"],
  ["GET", "/refresh.json", "/refresh.json", "file"],
  ["GET", "/robots.txt", "/robots.txt", "file"],
  ["GET", "/llms.txt", "/llms.txt", "file"],
  ["GET", "/sitemap-3.xml", "/sitemap.xml", "file"],
  ["GET", "/sitemap-contracts-17.xml", "/sitemap-contracts-:n.xml", "file"],
  ["GET", "/sitemap-guides.xml", "/sitemap.xml", "file"],
  ["GET", "/data/feeds/organizations/org-a000000001.xml", "/data/feeds/:file", "feed"],
  ["GET", "/data/feeds/canada/tenders.xml", "/data/feeds/:file", "feed"],
  ["GET", "/downloads/organizations.csv", "/downloads/organizations.csv", "download"],
];

describe("the routes counted by name", () => {
  it("names every route index.tsx registers, and none of them is other", () => {
    const registered = indexSource.split("\n").filter((line) => /^app\.(get|post)\(/.test(line)).length;
    // One sample a registration; /awards/:key serves a year and a reference, and its reference form follows.
    expect(INDEX_ROUTES.length).toBe(registered);
    for (const [method, path, route, kind] of INDEX_ROUTES) {
      expect(routeTemplate(method, path), `${method} ${path}`).toEqual({ route, kind });
    }
    expect(routeTemplate("GET", "/awards/cb-400-40000004")).toEqual({ route: "/awards/:reference", kind: "page" });
    // The two radar windows' files, registered in a loop.
    expect(indexSource).toContain("for (const window of DEEP_WINDOWS) app.get(`/data/expiring/${window}/*`");
    expect(routeTemplate("GET", "/data/expiring/6m/1.json")).toEqual({ route: "/data/expiring/6m/:file", kind: "file" });
    expect(routeTemplate("GET", "/data/expiring/12m/index.json")).toEqual({ route: "/data/expiring/12m/:file", kind: "file" });
  });

  it("names each of the pipeline's sitemap parts apart, the index and an older numbered part as before", () => {
    expect(PIPELINE_PARTS).toEqual(["open-tenders", "pages", "active-organizations"]);
    // A part retired on 2026-11-21, which a search engine may still ask for, is no route of the site's.
    expect(routeTemplate("GET", "/sitemap-other-organizations-1.xml")).toEqual({ route: "other", kind: "other" });
    for (const part of PIPELINE_PARTS) {
      expect(routeTemplate("GET", `/sitemap-${part}-1.xml`)).toEqual({ route: `/sitemap-${part}-:n.xml`, kind: "file" });
      expect(routeTemplate("GET", `/sitemap-${part}-14.xml`)).toEqual({ route: `/sitemap-${part}-:n.xml`, kind: "file" });
      // A part's name without its number names no file (sitemaps.ts sitemapAsset), so it is no route.
      expect(routeTemplate("GET", `/sitemap-${part}.xml`)).toEqual({ route: "other", kind: "other" });
    }
    expect(routeTemplate("GET", "/sitemap.xml")).toEqual({ route: "/sitemap.xml", kind: "file" });
    expect(routeTemplate("GET", "/sitemap-3.xml")).toEqual({ route: "/sitemap.xml", kind: "file" });
    expect(routeTemplate("GET", "/sitemap-closed-tenders-1.xml")).toEqual({ route: "other", kind: "other" });
  });

  it("names every address the accounts' routes file lists, by section, never by id or secret", () => {
    const listed = [...accountRoutes.matchAll(/^\/\/\s+(GET|POST)\s+(\/account\S*)/gm)].map((m) => [m[1], m[2]] as const);
    expect(listed.length).toBeGreaterThan(80);
    const sample = (path: string) => path.split("?")[0].split("|")[0]
      .replace(":block.csv", "shares.csv").replace(":id.ics", "c0ffee.ics").replace(/:[a-z]+/g, "x1f2e3");
    for (const [method, path] of listed) {
      const address = sample(path);
      const { route, kind } = routeTemplate(method, address);
      expect(route, `${method} ${path}`).not.toBe("other");
      expect(route, `${method} ${path}`).toMatch(/^\/account(?:\/[a-z-]+(?:\/(?::rest|:read|:file\.csv|:id\.ics))?)?$|^\/account\/calendar\/:id\.ics$|^\/account\/billing\/webhook$/);
      expect(route, `${method} ${path}`).not.toContain("x1f2e3");
      const expected = path === "/account/billing/webhook" ? "hook"
        : method === "POST" ? "form"
        : address.endsWith(".ics") || address.endsWith(".csv") ? "download"
        : /^\/account\/dashboard\/(?:tiles|find|tables)/.test(address) ? "file" : "page";
      expect(kind, `${method} ${path}`).toBe(expected);
    }
    // The pages a reader without an account meets, each by its own name.
    expect(routeTemplate("GET", "/account/sign-in")).toEqual({ route: "/account/sign-in", kind: "page" });
    expect(routeTemplate("POST", "/account/sign-in")).toEqual({ route: "/account/sign-in", kind: "form" });
    expect(routeTemplate("GET", "/account/check")).toEqual({ route: "/account/check", kind: "page" });
    expect(routeTemplate("GET", "/account")).toEqual({ route: "/account", kind: "page" });
    expect(routeTemplate("GET", "/account/stop")).toEqual({ route: "/account/stop", kind: "page" });
    // Anything else under /account matches no route.
    for (const path of ["/account/", "/account/someone@example.com", "/account/Sign-In", "/account/wp-login.php"]) {
      expect(routeTemplate("GET", path), path).toEqual({ route: "other", kind: "other" });
    }
    // The operator's console by name, never among readers' page views or posts.
    expect(routeTemplate("GET", "/admin")).toEqual({ route: "/admin", kind: "other" });
    expect(routeTemplate("POST", "/admin/mail-check")).toEqual({ route: "/admin/:rest", kind: "other" });
  });

  it("still stores a path that matches no route as other", () => {
    for (const path of ["/someone@example.com", "/wp-login.php", "/contracts", "/contracts/dnd-mdn", "/expiring/3m/2",
      "/organizations/a/b/c", "/pro/x", "/sitemap-contracts-.xml", "/.env"]) {
      expect(routeTemplate("GET", path), path).toEqual({ route: "other", kind: "other" });
    }
  });
});
