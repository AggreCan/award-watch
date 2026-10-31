// The organization directory: /organizations lists one directory per
// province and territory plus addresses outside Canada (xx) and records with
// no address (un); /organizations/directory/<code>[/<n>] lists one A to Z.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { routeTemplate } from "../src/views";
import { assetsWithout, emptyAssets, makeFakeAssets, testEnv } from "./assets";

const get = (path: string, env = testEnv()) => app.request(path, {}, env);
const html = async (path: string, env = testEnv()) => (await get(path, env)).text();
const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("the organizations page", () => {
  it("lists each directory with its count, linking those with a page", async () => {
    const res = await get("/organizations");
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("<h1>Organizations</h1>");
    expect(page).toContain("2 organizations: every supplier, grant recipient and lobbying client on record");
    expect(page).toContain('<a href="/organizations/directory/on">Ontario</a>');
    expect(page).toContain('<a href="/organizations/directory/bc">British Columbia</a>');
    // A directory with nobody in it is named, not linked.
    expect(page).toContain(">Yukon</td>");
    expect(page).not.toContain('href="/organizations/directory/yt"');
    expect(page).toContain(">Outside Canada</td>");
    expect(page).toContain('class="active" aria-current="page">Organizations</a>');
  });

  it("reads in French", async () => {
    const page = nbsp(await html("/organizations?lang=fr"));
    expect(page).toContain("<h1>Organisations</h1>");
    expect(page).toContain(">Colombie-Britannique</a>");
    expect(page).toContain(">Hors du Canada</td>");
  });

  it("answers 'not published' without its index; /organizations/directory goes to it", async () => {
    expect((await get("/organizations", testEnv(assetsWithout("directory/index.json")))).status).toBe(503);
    const bare = await get("/organizations/directory");
    expect(bare.status).toBe(301);
    expect(bare.headers.get("location")).toBe("/organizations");
  });
});

describe("one directory", () => {
  it("lists the organizations A to Z with their city, record count and latest record", async () => {
    const res = await get("/organizations/directory/on");
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("<h1>Organizations A to Z: Ontario</h1>");
    expect(page).toContain("1 organization, 200 to a page.");
    expect(page).toContain('<a href="/organizations/org-a000000001">Exemplar Translation Services Inc.</a>');
    expect(page).toContain('<td data-label="City">Ottawa</td>');
    expect(page).toContain('<td data-label="Records" class="mono num">104</td>');
    expect(page).toContain('<a href="/organizations/directory/on" aria-current="page">E</a>');
    expect(page).toContain('<link rel="canonical" href="https://awardwatch.ca/organizations/directory/on"');
    expect(page).toContain('"name":"Organizations","item":"https://awardwatch.ca/organizations"');
  });

  it("sends a differently written address to the canonical one", async () => {
    for (const [path, to] of [
      ["/organizations/directory/ON", "/organizations/directory/on"],
      ["/organizations/directory/on/1", "/organizations/directory/on"],
      ["/organizations/directory/on/01?lang=fr", "/organizations/directory/on?lang=fr"],
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(301);
      expect(res.headers.get("location"), path).toBe(to);
    }
  });

  it("answers 404 for a page past the end, a code with no directory and a malformed page number", async () => {
    expect((await get("/organizations/directory/on/2")).status).toBe(404);
    expect((await get("/organizations/directory/zz")).status).toBe(404);
    expect((await get("/organizations/directory/on/two")).status).toBe(404);
    expect((await get("/organizations/directory/on/0")).status).toBe(404);
  });

  it("says when a directory has nobody yet, and keeps that page out of the index", async () => {
    const page = await html("/organizations/directory/yt");
    expect(page).toContain("No organization is listed here yet (Yukon).");
    expect(page).toContain('<meta name="robots" content="noindex"/>');
  });

  it("answers 'not published' when the data or the directory's files are missing or unreadable", async () => {
    expect((await get("/organizations/directory/on", testEnv(emptyAssets))).status).toBe(503);
    expect((await get("/organizations/directory/on", testEnv(assetsWithout("directory/on/index.json")))).status).toBe(503);
    expect((await get("/organizations/directory/on", testEnv(assetsWithout("directory/on/1.json")))).status).toBe(503);
    const badRow = makeFakeAssets({}, {
      "directory/on/1.json": { code: "on", page: 1, rows: [{ id: "emp-0000000001", name: "x", city: null, n_records: 1, last_seen: null }] },
    });
    expect((await get("/organizations/directory/on", testEnv(badRow))).status).toBe(503);
    const badIndex = makeFakeAssets({}, { "directory/on/index.json": { code: "on", organizations: 1, pages: 2, page_size: 200, ranges: [], letters: [], updated: null } });
    expect((await get("/organizations/directory/on", testEnv(badIndex))).status).toBe(503);
  });

  it("is linked from every profile, to the list its place puts it in", async () => {
    expect(await html("/organizations/org-a000000001")).toContain('<a href="/organizations/directory/on">Ontario</a>');
    // A directory not in the index (British Columbia lists one organization, but
    // the profile's link needs the index to say so) is linked as well.
    expect(await html("/organizations/org-a000000002")).toContain('<a href="/organizations/directory/bc">British Columbia</a>');
    // Without the directory index, the crumb is plain text and the profile still answers.
    const plain = await get("/organizations/org-a000000001", testEnv(assetsWithout("directory/index.json")));
    expect(plain.status).toBe(200);
    expect(await plain.text()).not.toContain('href="/organizations/directory/on"');
  });

  it("is named by template in the audience counts", () => {
    expect(routeTemplate("GET", "/organizations/directory/on")).toEqual({ route: "/organizations/directory/:code", kind: "page" });
    expect(routeTemplate("GET", "/organizations/directory/on/3")).toEqual({ route: "/organizations/directory/:code/:page", kind: "page" });
  });
});
