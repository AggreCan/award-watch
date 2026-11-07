// The alias map as a free download (operator ruling of 2026-11-07):
// downloads/organization-aliases.csv (from_id, to_id, reason, note, since).
// Its row on the Data page waits for the export's list of downloads to name
// it, since a deploy ships before the nightly that first writes it; the
// route serves it by name, under the per-address download cap.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { DOWNLOADS } from "../src/pages/data";
import { routeTemplate } from "../src/views";
import stats from "./fixtures/stats.json";
import { makeFakeAssets, testEnv } from "./assets";

const FILE = "organization-aliases.csv";
const EM_DASH = String.fromCharCode(0x2014);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const listing = [
  { file: "organizations.csv", bytes: 760_062, rows: 4321 },
  { file: FILE, bytes: 18_944, rows: 212 },
];
const listed = () => testEnv(makeFakeAssets({}, { "stats.json": { ...stats, downloads: listing } }));
const section = (html: string) => {
  const start = html.indexOf('<h2 id="downloads">');
  return html.slice(start, html.indexOf("<h2 id=", start + 1));
};
const downloadsOf = async (env: object, lang = "") =>
  nbsp(section(await (await app.request(`/data${lang ? `?lang=${lang}` : ""}`, {}, env)).text()));

describe("the alias download", () => {
  it("is a free fixed download that waits for the export to list it", () => {
    const entry = DOWNLOADS.find((d) => d.file === FILE);
    expect(entry).toMatchObject({ contents: "data.file.aliases", note: "data.file.aliases_note", listed: true });
    expect(entry?.paid).toBeUndefined();
  });

  it("has its row, with its size and rows, once the export lists it", async () => {
    const html = await downloadsOf(listed());
    expect(html).toContain(`<td data-label="File"><a href="/downloads/${FILE}" class="mono">${FILE}</a></td>`);
    expect(html).toContain("Organization aliases: the profile ids the site joined, with the reason");
    expect(html).toContain("One row per joined id: the id its records moved to, the reason, a note and the date of the join. Ids only, no record data.");
    expect(html).toContain('<td data-label="Size" class="mono num" data-sort="18944">19 KB</td><td data-label="Rows" class="mono num">212</td>');
    // Free: no Pro chip beside it, whatever the switch.
    const row = html.slice(html.indexOf(`/downloads/${FILE}`), html.indexOf("</tr>", html.indexOf(`/downloads/${FILE}`)));
    expect(row).not.toContain("Pro");
    expect(html).not.toContain(EM_DASH);
  });

  it("has no row while the export does not list it, an older export without a list included", async () => {
    expect(await downloadsOf(testEnv())).not.toContain(FILE);
    const other = testEnv(makeFakeAssets({}, { "stats.json": { ...stats, downloads: [listing[0]] } }));
    const html = await downloadsOf(other);
    expect(html).toContain("organizations.csv");
    expect(html).not.toContain(FILE);
  });

  it("reads in French", async () => {
    const html = await downloadsOf(listed(), "fr");
    expect(html).toContain("Alias des organisations : les identifiants de profil que le site a réunis, avec le motif");
    expect(html).toContain("Une ligne par identifiant réuni : l’identifiant qui a reçu ses dossiers, le motif, une note et la date de la réunion.");
    expect(html).not.toContain("Organization aliases");
    expect(html).not.toContain(EM_DASH);
  });

  it("is served from the bucket by name, a missing object answering the route's 404, and counted as a download", async () => {
    expect((await app.request(`/downloads/${FILE}`, {}, testEnv())).status).toBe(404);
    await (env as unknown as { DATA: R2Bucket }).DATA.put(`downloads/${FILE}`, "from_id,to_id,reason,note,since\r\n");
    const res = await app.request(`/downloads/${FILE}`, {}, testEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${FILE}"`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await res.text()).toBe("from_id,to_id,reason,note,since\r\n");
    expect(bucketFor("GET", `/downloads/${FILE}`)).toBe("download");
    expect(bucketFor("HEAD", `/downloads/${FILE}`)).toBe("page");
    expect(routeTemplate("GET", `/downloads/${FILE}`)).toEqual({ route: `/downloads/${FILE}`, kind: "download" });
  });

  it("meets the per-address download cap like the other files", async () => {
    expect((env as unknown as { DOWNLOAD_LIMIT?: unknown }).DOWNLOAD_LIMIT, "the DOWNLOAD_LIMIT binding of wrangler.jsonc").toBeTruthy();
    const from = (ip: string) => app.request(`/downloads/${FILE}`, { headers: { "cf-connecting-ip": ip } }, testEnv());
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await from("203.0.113.77")).status);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect((await from("203.0.113.78")).status).not.toBe(429);
  });
});
