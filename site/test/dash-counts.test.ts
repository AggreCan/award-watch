// The counts the dashboard's pages state, read at no tile, one and several, in both languages: the checklist's count
// of the dashboard it adds to (dash.tables_count) and the question inside Delete this dashboard (dash.board_delete_q).
// French takes the singular for 0 and 1 (i18n.ts tn); English for 1 alone, and "1 of 24 tiles" reads in the plural,
// the noun going with the figure. Each expected line is written out here. Add a Tile's own count (dash.count) is
// held too: a page that draws it is held byte for byte by test/seats-today.ts, whose helper puts that one line back
// as it read at the capture (test/seats-service.test.ts CAPTURED_COUNT).
import { describe, expect, it } from "vitest";
import { ACCOUNTS, decode, get, grantUltra, nbsp, newEmail, signIn, ultraEnv, useAccountsDb, userId } from "./accounts-helpers";

useAccountsDb();

const norm = (s: string) => nbsp(decode(s)).replace(/’/g, "'");
const mainOf = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const hex = (tag: number, i: number) => `${tag.toString(16).padStart(8, "0")}${i.toString(16).padStart(24, "0")}`;

// An Ultra account holding one stored dashboard of `tiles` text tiles (a text tile reads nothing).
async function ultraWith(tag: number, tiles: number): Promise<string> {
  const email = newEmail(`dash-counts-${tiles}`);
  const cookie = await signIn(email, { env: ultraEnv() });
  await grantUltra(email);
  const user = await userId(email);
  const board = hex(tag, 0);
  const at = "2026-01-08T00:00:00.000Z";
  await ACCOUNTS.batch([
    ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', 0, ?)").bind(board, user, at),
    ...Array.from({ length: tiles }, (_, i) => ACCOUNTS.prepare(
      "INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, 'text', ?, ?, 0, ?, 12, 4, ?)",
    ).bind(hex(tag, 0x10 + i), board, user, hex(tag, 0x20 + i), JSON.stringify({ text: `Note ${i + 1}` }), i * 4, at)),
  ]);
  return cookie;
}

const page = async (cookie: string, path: string) => {
  const res = await get(path, { cookie, env: ultraEnv() });
  expect(res.status, path).toBe(200);
  return norm(mainOf(await res.text()));
};

describe("the dashboard's counts", () => {
  // [tiles, the checklist's count, the delete question], English then French.
  const CASES: [number, [string, string], [string, string]][] = [
    [0,
      ["Dashboard 1 holds 0 of 24 tiles.", "Delete the dashboard Dashboard 1?"],
      ["Tableau de bord 1 contient 0 tuile sur 24.", "Supprimer le tableau de bord Tableau de bord 1?"]],
    [1,
      ["Dashboard 1 holds 1 of 24 tiles.", "Delete the dashboard Dashboard 1 and its tile?"],
      ["Tableau de bord 1 contient 1 tuile sur 24.", "Supprimer le tableau de bord Tableau de bord 1 et sa tuile?"]],
    [2,
      ["Dashboard 1 holds 2 of 24 tiles.", "Delete the dashboard Dashboard 1 and its 2 tiles?"],
      ["Tableau de bord 1 contient 2 tuiles sur 24.", "Supprimer le tableau de bord Tableau de bord 1 et ses 2 tuiles?"]],
    [3,
      ["Dashboard 1 holds 3 of 24 tiles.", "Delete the dashboard Dashboard 1 and its 3 tiles?"],
      ["Tableau de bord 1 contient 3 tuiles sur 24.", "Supprimer le tableau de bord Tableau de bord 1 et ses 3 tuiles?"]],
  ];

  for (const [tiles, en, fr] of CASES) {
    it(`reads ${tiles} tile${tiles === 1 ? "" : "s"} in the right number in both languages`, async () => {
      const cookie = await ultraWith(0xc0 + tiles, tiles);
      for (const [lang, [tables, ask]] of [["en", en], ["fr", fr]] as const) {
        const q = lang === "fr" ? "?lang=fr" : "";
        const board = await page(cookie, `/account/dashboard${q}`);
        expect(board, lang).toContain(`<p>${ask}</p>`);
        // Add a Tile's own count, the same figures without the dashboard's name.
        const own = lang === "fr" ? `${tiles} ${tiles < 2 ? "tuile" : "tuiles"} sur 24` : `${tiles} of 24 tiles`;
        expect(board, lang).toContain(`<p class="muted small">${own}</p>`);
        expect(await page(cookie, `/account/dashboard/tables/segments/81${q}`), lang).toContain(`<span class="panel-count">${tables}</span>`);
      }
    });
  }

  it("never writes a figure of one beside a plural noun on the checklist in French", async () => {
    const cookie = await ultraWith(0xcf, 1);
    expect(await page(cookie, "/account/dashboard/tables/segments/81?lang=fr")).not.toMatch(/\b[01] tuiles\b/);
    expect(await page(cookie, "/account/dashboard?lang=fr")).not.toMatch(/\b[01] tuiles\b/);
  });
});
