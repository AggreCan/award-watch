// A dashboard deleted in one tab while another tab still shows it: the other tab's save of its layout answers 404,
// state gone, with the line and the link the page's script shows in place of Try again, in the reader's language
// (src/account/dashboard.tsx layoutPost); the script's reading of that answer (public/dashboard.js goneOf), which
// the suite reaches without a browser; and every other refusal or failure, which the script still meets with Try again.
import { describe, expect, it } from "vitest";
import { goneOf } from "../public/dashboard.js";
import { t } from "../src/i18n";
import dashboardJs from "../public/dashboard.js?raw";
import { csrf, get, grantUltra, newEmail, onEnv, post, signIn, useAccountsDb } from "./accounts-helpers";

useAccountsDb();

type Reader = { cookie: string; csrf: string };
async function reader(tag: string): Promise<Reader> {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  await grantUltra(email);
  return { cookie, csrf: await csrf(cookie, "/account") };
}
const send = (r: Reader, path: string, fields: Record<string, string> = {}, cookie = r.cookie) =>
  post(path, { csrf: r.csrf, ...fields }, { cookie, env: onEnv() });
// A second dashboard, made then deleted, as another tab would: its id.
async function deletedBoard(r: Reader): Promise<string> {
  await send(r, "/account/dashboard/panels", { kind: "radar", ref: "3m" });
  const made = await send(r, "/account/dashboard/boards");
  const id = (made.headers.get("location") ?? "").slice("/account/dashboard/".length);
  expect(id).toMatch(/^[0-9a-f]{32}$/);
  expect((await send(r, `/account/dashboard/boards/${id}/delete`, { confirm: "yes" })).headers.get("location")).toBe("/account/dashboard?m=board_deleted");
  return id;
}

describe("saving the layout of a dashboard deleted in another tab", () => {
  it("answers 404, gone, with its line and the link to the account's dashboards, in each language", async () => {
    const r = await reader("dash-gone");
    const id = await deletedBoard(r);
    const layout = JSON.stringify([{ id: "a".repeat(32), x: 0, y: 0, w: 6, h: 8 }]);
    const en = await send(r, `/account/dashboard/layout?board=${id}`, { layout });
    expect(en.status).toBe(404);
    expect(en.headers.get("content-type")).toContain("application/json");
    expect(await en.json()).toEqual({ state: "gone", line: "This dashboard no longer exists.", link: "Your dashboards", href: "/account/dashboard" });
    const fr = await send(r, `/account/dashboard/layout?board=${id}`, { layout }, `${r.cookie}; lang=fr`);
    expect(fr.status).toBe(404);
    expect(await fr.json()).toEqual({ state: "gone", line: "Ce tableau de bord n’existe plus.", link: "Vos tableaux de bord", href: "/account/dashboard?lang=fr" });
    // The page itself sends the reader to the account's first dashboard, as before.
    expect((await get(`/account/dashboard/${id}`, { cookie: r.cookie, env: onEnv() })).headers.get("location")).toBe("/account/dashboard");
  });

  it("keeps every other answer as it was: a layout that is not one, a dashboard id that is no id, a save that works", async () => {
    const r = await reader("dash-gone-other");
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "3m" });
    const bad = await send(r, "/account/dashboard/layout", { layout: "not json" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ state: "refused" });
    expect((await send(r, "/account/dashboard/layout?board=nonsense", { layout: "[]" })).status).toBe(400);
    const saved = await send(r, "/account/dashboard/layout", { layout: "[]" });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ state: "saved" });
  });
});

describe("saving a layout that names none of the dashboard's tiles", () => {
  it("answers 409, stale, with its line and the link to reload, once the first save wrote the starter's tiles under new ids", async () => {
    // A new Ultra account: no dashboard stored, so the page shows the starting layout, its tiles s0, s1 and so on.
    const r = await reader("dash-stale");
    const page = await (await get("/account/dashboard", { cookie: r.cookie, env: onEnv() })).text();
    const starters = [...page.matchAll(/data-id="(s\d+)"/g)].map((m) => m[1]);
    expect(starters.length).toBeGreaterThanOrEqual(2);
    const at = (dy: number) => JSON.stringify(starters.map((id, i) => ({ id, x: 0, y: i * 12 + dy, w: 12, h: 11 })));
    // The first save writes the first dashboard and answers the stored ids.
    const first = await send(r, "/account/dashboard/layout", { layout: at(0) });
    expect(first.status).toBe(200);
    const saved = await first.json() as { state: string; renamed: Record<string, string> };
    expect(saved.state).toBe("saved");
    expect(Object.keys(saved.renamed).sort()).toEqual([...starters].sort());
    // The same page again (its answer lost, or a second tab): its ids are no tile of the dashboard now.
    const en = await send(r, "/account/dashboard/layout", { layout: at(1) });
    expect(en.status).toBe(409);
    expect(en.headers.get("content-type")).toContain("application/json");
    expect(await en.json()).toEqual({
      state: "stale", line: "This dashboard was changed elsewhere, so the layout was not saved.", link: "Reload it", href: "/account/dashboard",
    });
    const fr = await send(r, "/account/dashboard/layout", { layout: at(1) }, `${r.cookie}; lang=fr`);
    expect(fr.status).toBe(409);
    expect(await fr.json()).toEqual({
      state: "stale", line: "Ce tableau de bord a été modifié ailleurs; la disposition n’a donc pas été enregistrée.", link: "Le recharger",
      href: "/account/dashboard?lang=fr",
    });
    // The stored ids still save, and an empty layout still answers saved.
    const stored = JSON.stringify(Object.values(saved.renamed).map((id, i) => ({ id, x: 0, y: i * 12, w: 12, h: 11 })));
    expect(await (await send(r, "/account/dashboard/layout", { layout: stored })).json()).toMatchObject({ state: "saved" });
    expect(await (await send(r, "/account/dashboard/layout", { layout: "[]" })).json()).toMatchObject({ state: "saved" });
    // The script meets it as it meets gone: the line, the link, no Try again, nothing saved again.
    const again = await send(r, "/account/dashboard/layout", { layout: at(2) });
    expect(goneOf(again.status, await again.json())).toEqual({ line: t("en", "dash.status_stale"), link: t("en", "dash.status_stale_link"), href: "/account/dashboard" });
    expect(goneOf(409, { state: "gone", line: "x", link: "y", href: "/account/dashboard" })).toBeNull();
    expect(goneOf(404, { state: "stale", line: "x", link: "y", href: "/account/dashboard" })).toBeNull();
    expect(goneOf(409, { state: "stale", line: "x", link: "y", href: `/account/dashboard/${"a".repeat(32)}?lang=fr` })?.href).toBe(`/account/dashboard/${"a".repeat(32)}?lang=fr`);
    expect(goneOf(409, { state: "stale", line: "x", link: "y", href: "https://example.com/" })?.href).toBe("/account/dashboard");
    expect(dashboardJs).toMatch(/\(res\.ok \|\| res\.status === 404 \|\| res\.status === 409\) && json/);
  });
});

describe("the page's script, on a save's answer", () => {
  it("reads the gone answer as the Worker writes it, and nothing else as gone", async () => {
    const r = await reader("dash-gone-script");
    const id = await deletedBoard(r);
    const res = await send(r, `/account/dashboard/layout?board=${id}`, { layout: "[]" });
    expect(goneOf(res.status, await res.json())).toEqual({ line: t("en", "dash.status_gone"), link: t("en", "dash.status_gone_link"), href: "/account/dashboard" });
    // Every other answer is a failure the status line meets with Try again, as before.
    expect(goneOf(404, { state: "refused" })).toBeNull();
    expect(goneOf(404, null)).toBeNull();
    expect(goneOf(500, { state: "gone", line: "x", link: "y", href: "/account/dashboard" })).toBeNull();
    expect(goneOf(200, { state: "saved" })).toBeNull();
    expect(goneOf(403, { state: "refused" })).toBeNull();
    expect(goneOf(503, { state: "unavailable" })).toBeNull();
    // The link goes to the account's dashboards and nowhere else, whatever an answer says.
    expect(goneOf(404, { state: "gone", line: "x", link: "y", href: "https://example.com/" })?.href).toBe("/account/dashboard");
    expect(goneOf(404, { state: "gone", line: "x", link: "y", href: "/account/dashboard?lang=fr" })?.href).toBe("/account/dashboard?lang=fr");
  });

  it("asks goneOf of each answer before Try again, offers no Try again on it, and saves no more after it", () => {
    const save = dashboardJs.slice(dashboardJs.indexOf("async function save("), dashboardJs.indexOf("function undo("));
    const branch = save.slice(save.indexOf("const said = goneOf(res.status, answer);"), save.indexOf('if (res.ok && answer && answer.state === "saved")'));
    expect(branch).toContain("gone = said;");
    expect(branch).toContain("goneLine();");
    expect(branch).toContain("return;");
    expect(branch).not.toContain("retry");
    // A change or an undo after it shows the line again and posts nothing.
    for (const fn of ["function changed(", "function undo("]) {
      const body = dashboardJs.slice(dashboardJs.indexOf(fn), dashboardJs.indexOf("window.setTimeout(() => save(false), DELAY_MS);", dashboardJs.indexOf(fn)));
      expect(body, fn).toMatch(/if \(gone\) \{\s*goneLine\(\);\s*return;\s*\}/);
    }
    // The script holds no words of its own for it, in a string: they come with the answer.
    expect(dashboardJs).not.toMatch(/"[^"\n]*no longer exist[^"\n]*"/);
  });
});
