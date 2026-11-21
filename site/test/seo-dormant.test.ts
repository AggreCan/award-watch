// Which organization profiles a search engine is asked to index (src/seo.ts dormantProfile; the operator's ruling
// of 2026-11-21): a profile with no record in the 24 months to the data date, and no contract ending in the next
// twelve, says noindex and nothing else of the page changes; every other profile is as it was. The window is the
// pipeline's (export_static.active_since, held to the same cases in pipeline/tests/test_sitemaps.py), and the
// sitemap's part names only profiles this rule keeps open.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { Profile } from "../src/data";
import { ACTIVE_MONTHS, activeSince, dormantProfile, organizationSeo } from "../src/seo";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import stats from "./fixtures/stats.json";
import activeOrganizations from "./fixtures/sitemaps/sitemap-active-organizations-1.xml?raw";
import exportStatic from "../../pipeline/awardwatch_pipeline/export_static.py?raw";

const ORG = "org-a000000001";
const OTHER = "org-a000000002";
const NOINDEX = '<meta name="robots" content="noindex"/>';
const shard = () => structuredClone(FILES["profiles/a00.json"]) as Record<string, any>;
const profileOf = (id: string, change: (p: any) => void = () => {}): Profile => {
  const p = shard()[id];
  change(p);
  return p as Profile;
};

let address = 0;
const page = async (path: string, profiles?: Record<string, unknown>) => {
  const env = testEnv(profiles ? makeFakeAssets({}, { "profiles/a00.json": profiles }) : undefined);
  const res = await app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.51.100.${(address++ % 250) + 1}` } }, env);
  return { status: res.status, html: await res.text() };
};
const headOf = (html: string) => html.slice(0, html.indexOf("</head>"));

describe("the window", () => {
  it("is the pipeline's: the same count of months, the same day counted back", () => {
    expect(ACTIVE_MONTHS).toBe(24);
    expect(/^ACTIVE_MONTHS = (\d+)$/m.exec(exportStatic)?.[1]).toBe(String(ACTIVE_MONTHS));
    // The cases of pipeline/tests/test_sitemaps.py test_the_active_window_counts_back_whole_months.
    expect(activeSince("2026-10-31")).toBe("2024-10-31");
    expect(activeSince("2026-01-15")).toBe("2024-01-15");
    // A day the earlier month lacks is that month's last day.
    expect(activeSince("2024-02-29")).toBe("2022-02-28");
    expect(activeSince("2026-03-31", 1)).toBe("2026-02-28");
    expect(activeSince("2026-01-10", 1)).toBe("2025-12-10");
    expect(activeSince("2028-02-29", 48)).toBe("2024-02-29");
    // A data date with its time, as some files carry it; nothing for one that is not a date.
    expect(activeSince("2026-10-31T12:30:00Z")).toBe("2024-10-31");
    for (const bad of [null, undefined, "", "soon", "2026-1-5"]) expect(activeSince(bad), String(bad)).toBeNull();
  });
});

describe("a profile with nothing recent", () => {
  const AS_OF = "2026-10-31";
  const old = (p: any) => { p.organization.last_seen = "2024-10-30"; delete p.expiring; delete p.matching; };

  it("is one whose last record falls before the window, with no newer counted record and no contract ending", () => {
    // The fixtures' two profiles hold records of 2026.
    expect(dormantProfile(profileOf(ORG), AS_OF)).toBe(false);
    expect(dormantProfile(profileOf(OTHER), AS_OF)).toBe(false);
    expect(dormantProfile(profileOf(OTHER, old), AS_OF)).toBe(true);
    // The first day of the window still counts.
    expect(dormantProfile(profileOf(OTHER, (p) => { old(p); p.organization.last_seen = "2024-10-31"; }), AS_OF)).toBe(false);
    // No dated record at all.
    expect(dormantProfile(profileOf(OTHER, (p) => { old(p); p.organization.last_seen = null; }), AS_OF)).toBe(true);
    // The date the sitemap's part reads, the matching block's newest record, keeps a profile open by itself: the
    // part never names a profile this rule closes.
    expect(dormantProfile(profileOf(OTHER, (p) => { old(p); p.matching = { newest: "2025-03-01" }; }), AS_OF)).toBe(false);
    expect(dormantProfile(profileOf(OTHER, (p) => { old(p); p.matching = { newest: "2021-03-01" }; }), AS_OF)).toBe(true);
    expect(dormantProfile(profileOf(OTHER, (p) => { old(p); p.matching = { newest: 20250301 }; }), AS_OF)).toBe(true);
    // A contract ending within twelve months is what a bidder looks for, however old its award.
    const ending = profileOf(ORG).expiring;
    expect(ending?.rows.length).toBeGreaterThan(0);
    expect(dormantProfile(profileOf(OTHER, (p) => { old(p); p.expiring = ending; }), AS_OF)).toBe(false);
    expect(dormantProfile(profileOf(OTHER, (p) => { old(p); p.expiring = { ...ending, rows: [] }; }), AS_OF)).toBe(true);
  });

  it("stays open where nothing can be said: no data date, or a profile written before the last record date", () => {
    for (const asOf of [null, undefined, "", "soon"]) expect(dormantProfile(profileOf(OTHER, old), asOf), String(asOf)).toBe(false);
    expect(dormantProfile(profileOf(OTHER, (p) => { old(p); delete p.organization.last_seen; }), AS_OF)).toBe(false);
  });

  it("says noindex in its metadata, and a profile with something recent does not", () => {
    const crumbs = [{ name: "Organizations", path: "/organizations" }];
    expect(organizationSeo(profileOf(OTHER, old), "en", crumbs, AS_OF).noindex).toBe(true);
    expect(organizationSeo(profileOf(OTHER, old), "fr", crumbs, AS_OF).noindex).toBe(true);
    expect("noindex" in organizationSeo(profileOf(OTHER), "en", crumbs, AS_OF)).toBe(false);
    // A caller that gives no data date marks nothing.
    expect("noindex" in organizationSeo(profileOf(OTHER, old), "en", crumbs)).toBe(false);
  });
});

describe("the organization's page", () => {
  it("is as it was for a profile with something recent: its canonical address, its alternates, no robots line", async () => {
    expect(stats.data_as_of).toBe("2026-10-31");
    for (const path of [`/organizations/${ORG}`, `/organizations/${ORG}?lang=fr`, `/organizations/${OTHER}`]) {
      const { status, html } = await page(path);
      expect(status, path).toBe(200);
      const head = headOf(html);
      expect(head, path).not.toContain('name="robots"');
      expect(head, path).toContain(`<link rel="canonical" href="https://awardwatch.ca${path}"/>`);
      expect(head.match(/<link rel="alternate" hreflang=/g), path).toHaveLength(3);
    }
  });

  it("says noindex for a profile with nothing recent, in both languages, and draws the same page for a reader", async () => {
    const profiles = shard();
    profiles[OTHER].organization.last_seen = "2023-05-02";
    delete profiles[OTHER].expiring;
    delete profiles[OTHER].matching;
    const before = await page(`/organizations/${OTHER}`);
    for (const q of ["", "?lang=fr"]) {
      const { status, html } = await page(`/organizations/${OTHER}${q}`, profiles);
      expect(status, q).toBe(200);
      const head = headOf(html);
      expect(head.match(/<meta name="robots"/g), q).toHaveLength(1);
      expect(head, q).toContain(NOINDEX);
      // A page that asks not to be indexed names no canonical address and no alternates.
      expect(head, q).not.toContain('rel="canonical"');
      expect(head, q).not.toContain("hreflang");
      expect(head, q).toContain('<meta name="description"');
    }
    // What a reader sees is the page as it was: the same title and the same body, the record date apart.
    const after = await page(`/organizations/${OTHER}`, profiles);
    const bodyOf = (html: string) => html.slice(html.indexOf("<body"));
    const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
    expect(titleOf(after.html)).toBe(titleOf(before.html));
    expect(bodyOf(after.html).replaceAll("2023-05-02", "2026-08-02")).toBe(bodyOf(before.html));
    // The other profile of the same file is untouched.
    expect(headOf((await page(`/organizations/${ORG}`, profiles)).html)).not.toContain('name="robots"');
  });

  it("is never one the sitemap's part names and this rule closes", async () => {
    // The fixture part (shaped as the export writes it) names a profile; its page says nothing against indexing.
    const named = [...activeOrganizations.matchAll(/<loc>https:\/\/awardwatch\.ca([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const path of named) expect(headOf((await page(path)).html), path).not.toContain('name="robots"');
  });
});
