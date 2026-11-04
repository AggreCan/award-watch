import { describe, expect, it } from "vitest";
import { app, downloadAllowed } from "../src/index";
import { CHANGELOG, DOWNLOADS, LICENCE_ROWS, SOURCE_ROWS, YEARLY_DOWNLOAD, fileSize } from "../src/pages/data";
import stats from "./fixtures/stats.json";
import { makeFakeAssets, testEnv } from "./assets";

const withFiles = (overrides: Record<string, unknown>) => testEnv(makeFakeAssets({}, overrides));

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
    expect(DOWNLOADS.map((d) => d.file)).toEqual([
      "open-tenders.csv", "organizations.csv", "buyers.csv", "expiring-3m.csv", "expiring-12m.csv", "SHA256SUMS",
    ]);
    for (const file of ["awards-2012.csv", "history-2009.csv", "organizations.csv", "expiring-3m.csv", "expiring-12m.csv", "SHA256SUMS",
      "mirror/x.csv", "awards-before-2012.csv", "awards-after-2026.csv", "history-before-2009.csv", "contracts-2024.csv",
      "grants-2005.csv", "contracts-before-2004.csv", "grants-after-2026.csv", "contracts-undated.csv", "grants-2024-2.csv",
      "contracts-undated-3.csv"]) {
      expect(downloadAllowed(file), file).toBe(true);
    }
    for (const file of ["awards-12.csv", "lobbying-2024.csv", "../stats.json", "awards-2024.csv.gz", "status.json", "mirror/../x", "expiring-6m.csv",
      "awards-later-2026.csv", "awards-before-.csv", "grants-2024-1.csv", "grants-2024-10.csv", "contracts-dated.csv", "grants-2024-2-2.csv"]) {
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
    // One last read per source, with the publisher's newest date under it; no column of terms (the licence section has them).
    expect(sources).toContain('<td data-label="Last read" class="mono">2026-10-31 00:40 UTC<span class="nw-block muted small">(publisher&#39;s date 2026-10-30)</span></td>');
    expect(sources).not.toContain('data-label="Terms"');
    // A source the last run did not read says so.
    expect(sources).toContain("Not read yet");
    // Each file's own read is under Last Runs.
    const runs = section(html, "runs");
    expect(runs).toContain('<h3 id="files">Files Read</h3>');
    expect(runs).toContain('<td data-label="File" class="mono wrap">openTenderNotice-ouvertAvisAppelOffres.csv</td>');
  });

  it("gives each download its size and rows when the export lists them, and nothing when it does not", async () => {
    expect(fileSize("en", 512)).toBe("512 B");
    expect(fileSize("en", 42_372)).toBe("41 KB");
    expect(fileSize("en", 2_231_436)).toBe("2.1 MB");
    expect(nbsp(fileSize("fr", 2_231_436))).toBe("2,1 Mo");
    expect(fileSize("en", 3 * 1024 ** 3)).toBe("3 GB");
    const plain = section(await (await get("/data")).text(), "downloads");
    expect(plain).not.toContain('data-label="Size"');
    const downloads = [
      { file: "organizations.csv", bytes: 760_062, rows: 4321 }, { file: "SHA256SUMS", bytes: 1811, rows: 22 },
      { file: "awards-2026.csv", bytes: 2_231_436, rows: 4860 }, { file: "bad", bytes: "x", rows: 1 },
    ];
    const html = await (await app.request("/data", {}, withFiles({ "stats.json": { ...stats, downloads } }))).text();
    const listed = section(html, "downloads");
    expect(listed).toContain('<td data-label="Size" class="mono num">742 KB</td><td data-label="Rows" class="mono num">4,321</td>');
    expect(listed).toContain('<td data-label="Size" class="mono num">2 KB</td><td data-label="Rows" class="mono num">22</td>');
    // A file the list does not name has empty cells; a yearly file carries its size and rows on its link.
    expect(listed).toContain('<td data-label="Size" class="mono num"></td><td data-label="Rows" class="mono num"></td>');
    expect(listed).toContain('<a class="mono" href="/downloads/awards-2026.csv" title="2.1 MB, 4,860 rows">awards-2026.csv</a>');
  });

  it("states the licence of every source and of the site's own files, the lobbying registry's its own", async () => {
    const html = await (await get("/data")).text();
    const lic = section(html, "licence");
    expect(LICENCE_ROWS.length).toBe(6);
    expect(lic).toContain('Every source but the Registry of Lobbyists is published under the <a href="https://open.canada.ca/en/open-government-licence-canada">Open Government Licence, Canada</a>, and so are the site&#39;s files.');
    // The registry publishes under the Commissioner of Lobbying's Open Data Licence Agreement, not the OGL.
    const odla = '<a href="https://lobbycanada.gc.ca/en/open-data/open-data-licence-agreement/">';
    expect(lic).toContain(`${odla}Open Data Licence Agreement</a>, which the site will follow once it reads them.`);
    expect(lic).toContain(`${odla}Open Data Licence Agreement, Office of the Commissioner of Lobbying (not loaded yet)</a>`);
    expect(section(html, "sources")).toContain(`${odla}Open Data Licence Agreement</a>`);
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
    // The dates before the first year and after the data year: every name SHA256SUMS can list is offered.
    expect(downloads).toContain('<a class="mono" href="/downloads/awards-before-2012.csv">awards-before-2012.csv</a>');
    expect(downloads).toContain('<a class="mono" href="/downloads/awards-after-2026.csv">awards-after-2026.csv</a>');
    expect(downloads).toContain('<a class="mono" href="/downloads/history-before-2009.csv">history-before-2009.csv</a>');
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
