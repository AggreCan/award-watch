import { describe, expect, it } from "vitest";
import { app, downloadAllowed } from "../src/index";
import { CHANGELOG, DOWNLOADS, LICENCE_ROWS, SOURCE_ROWS, YEARLY_DOWNLOAD } from "../src/pages/data";
import { testEnv } from "./assets";

const get = (path: string) => app.request(path, {}, testEnv());
const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const EM_DASH = String.fromCharCode(0x2014);
const section = (html: string, id: string) => {
  const start = html.indexOf(`<h2 id="${id}">`);
  const next = html.indexOf("<h2 id=", start + 1);
  return html.slice(start, next < 0 ? undefined : next);
};

describe("data page", () => {
  it("lists the fixed downloads and allows the yearly files by name only", () => {
    expect(DOWNLOADS.map((d) => d.file)).toEqual(["open-tenders.csv", "organizations.csv", "buyers.csv", "expiring-12m.csv", "SHA256SUMS"]);
    for (const file of ["awards-2012.csv", "history-2009.csv", "organizations.csv", "expiring-12m.csv", "SHA256SUMS", "mirror/x.csv"]) {
      expect(downloadAllowed(file), file).toBe(true);
    }
    for (const file of ["awards-12.csv", "grants-2024.csv", "../stats.json", "awards-2024.csv.gz", "status.json", "mirror/../x", "expiring-3m.csv"]) {
      expect(downloadAllowed(file), file).toBe(false);
    }
    expect(YEARLY_DOWNLOAD.test("history-2025.csv")).toBe(true);
  });

  it("names every source with its publisher, its licence and when each file was last read", async () => {
    const html = await (await get("/data")).text();
    const sources = section(html, "sources");
    expect(SOURCE_ROWS.map((s) => s.key)).toEqual(["buyers", "tenders", "awards", "history", "contracts", "grants", "lobbying", "registry"]);
    expect(sources).toContain('<a href="https://open.canada.ca/data/en/dataset/6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2">CanadaBuys tender notices</a>');
    expect(sources).toContain("Public Services and Procurement Canada");
    expect(sources).toContain("Treasury Board of Canada Secretariat");
    expect(sources).toContain("Office of the Commissioner of Lobbying");
    expect(sources).toContain('<span class="mono">openTenderNotice-ouvertAvisAppelOffres.csv</span>: 2026-10-31 00:40 UTC');
    expect(sources).toContain("(publisher&#39;s date 2026-10-30)");
    // A source the last run did not read says so.
    expect(sources).toContain("Not read yet");
  });

  it("states the one licence of every source and of the site's own files", async () => {
    const html = await (await get("/data")).text();
    const lic = section(html, "licence");
    expect(LICENCE_ROWS.length).toBe(6);
    expect(lic).toContain('Every source is published under the <a href="https://open.canada.ca/en/open-government-licence-canada">Open Government Licence, Canada</a>, and so are the site&#39;s files.');
    expect(lic).toContain("Contains information licensed under the Open Government Licence, Canada.");
    expect(lic).toContain("The site&#39;s merged organizations, buyer mapping, totals and rankings");
    expect(html).not.toContain(EM_DASH);
  });

  it("lists the downloads, the API and the yearly files, and starts the changelog empty", async () => {
    const html = await (await get("/data")).text();
    const downloads = section(html, "downloads");
    for (const d of DOWNLOADS) expect(downloads).toContain(`<a href="/downloads/${d.file}" class="mono">${d.file}</a>`);
    expect(downloads).toContain('<a class="mono" href="/downloads/awards-2026.csv">awards-2026.csv</a>');
    expect(downloads).toContain('<a class="mono" href="/downloads/awards-2012.csv">awards-2012.csv</a>');
    expect(downloads).toContain('<a class="mono" href="/downloads/history-2009.csv">history-2009.csv</a>');
    expect(downloads).not.toContain("awards-2011.csv");
    const api = section(html, "api");
    for (const endpoint of ["GET /api/stats", "GET /api/organizations/{id}", "GET /api/tenders/{reference}", "GET /api/buyers/{id}", "GET /api/categories/{nn}"]) {
      expect(api).toContain(endpoint);
    }
    expect(CHANGELOG).toEqual([]);
    expect(section(html, "changes")).toContain("No change since launch.");
    expect(section(html, "runs")).toContain("Did not complete");
  });

  it("reads in French", async () => {
    const html = nbsp(await (await get("/data?lang=fr")).text());
    expect(html).toContain("<h1>Données, téléchargements et licence</h1>");
    expect(html).toContain("Licence du gouvernement ouvert, Canada");
    expect(html).toContain("Secrétariat du Conseil du Trésor du Canada");
    expect(html).toContain("2026-10-31 00 h 40 UTC");
    expect(html).toContain("Aucun changement depuis le lancement.");
  });
});
