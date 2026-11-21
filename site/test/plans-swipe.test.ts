// On a phone the plans sit side by side and the reader swipes from one to the next (the operator's ruling of
// 2026-11-20): on the landing page (public/landing.css, at 640 px and under) and wherever the plan cards are drawn
// (public/styles.css .plan-cards, at 699 px and under). A card takes most of the width, so the next shows at the
// edge; the row scrolls inside its own box and snaps to a card; a line on the landing page says so, shown on a phone
// alone; and on the plan cards a line wraps where a narrow card cut it short.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { onEnv, useAccountsDb } from "./accounts-helpers";

useAccountsDb();

const LANDING = (env as unknown as { LANDING_CSS: string }).LANDING_CSS;
const STYLES = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;

// The body of the media block that opens with `open` (to the brace that closes it).
function block(css: string, open: string, from = 0): string {
  const at = css.indexOf(open, from);
  expect(at, open).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(`no end of ${open}`);
}
// Every block of the stylesheet that opens with `open`.
function blocks(css: string, open: string): string[] {
  const out: string[] = [];
  for (let at = css.indexOf(open); at > -1; at = css.indexOf(open, at + open.length)) out.push(block(css, open, at));
  return out;
}
const page = async (path: string) =>
  (await app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": "198.18.71.9" } }, onEnv())).text();

describe("the plans on a phone", () => {
  it("sit side by side on the landing page and swipe, a card at a time, inside their own box", () => {
    const phone = block(LANDING, "@media (max-width: 640px) {");
    expect(phone).toMatch(/\.lp-plans \{ position: relative; display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain;[^}]*\}/);
    expect(phone).toContain(".lp-plan { flex: 0 0 86%; scroll-snap-align: center; }");
    expect(phone).toContain(".lp-plans-swipe { display: block; }");
    // Outside the phone block the line is hidden and the plans do not scroll.
    const rest = LANDING.replace(phone, "");
    expect(rest).toMatch(/\.lp-plans-swipe \{ display: none;[^}]*\}/);
    expect(rest).not.toMatch(/\.lp-plans \{[^}]*overflow-x/);
  });

  it("say so in a line the landing page shows on a phone, in both languages", async () => {
    // The plans are on the page while accounts are open, which is how the site ships.
    const en = await page("/");
    expect(en).toContain('<p class="lp-plans-swipe">Swipe to see each plan.</p>');
    expect(en.indexOf('class="lp-plans-swipe"')).toBeLessThan(en.indexOf('<div class="lp-plans">'));
    expect(en.match(/class="lp-plans-swipe"/g)).toHaveLength(1);
    expect(await page("/?lang=fr")).toContain('<p class="lp-plans-swipe">Balayez pour voir chaque forfait.</p>');
  });

  it("wrap every card's lines on the landing page at every width, so none is cut with an ellipsis", () => {
    // From 1001 px the cards share three columns: a card's text is then about 232 px of 14 px Inter, and the Free
    // and Pro cards' longest lines (PLAN_LINE_MAX characters, French) run to about 300 px, which a column holds only
    // at the page's full width. The rule outside every media block is the one those widths read.
    const outside = LANDING.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const span = /\.lp-plan-list li > span \{([^}]*)\}/.exec(outside)?.[1];
    expect(span).toBeDefined();
    expect(span).toContain("white-space: normal");
    expect(span).not.toContain("ellipsis");
    expect(span).not.toContain("nowrap");
  });

  it("swipe the same way wherever the plan cards are drawn, their rows kept level and their lines wrapped", () => {
    const phone = blocks(STYLES, "@media (max-width: 699px) {").find((b) => b.includes(".plan-cards {"));
    expect(phone).toBeDefined();
    const cards = /\.plan-cards \{([^}]*)\}/.exec(phone!)![1];
    for (const rule of ["grid-auto-flow: column", "grid-auto-columns: 86%", "grid-template-rows: repeat(var(--plan-card-rows, 1), auto)", "overflow-x: auto",
      "scroll-snap-type: x mandatory", "overscroll-behavior-x: contain"]) expect(cards, rule).toContain(rule);
    // The page never scrolls sideways: each row that scrolls holds what is positioned inside it. A card's hidden
    // words (.visually-hidden, position: absolute) would otherwise be placed by the page, out where their card
    // sits in the scrolled row, and a phone could pan the whole page that far (seen live on 2026-11-21).
    expect(cards).toContain("position: relative");
    for (const sheet of [STYLES, LANDING]) expect(sheet).toMatch(/\.visually-hidden \{ position: absolute;/);
    expect(block(LANDING, "@media (max-width: 640px) {")).toMatch(/\.lp-plans \{ position: relative;/);
    expect(phone).toContain(".plan-cards:has(> .plan-card:only-child) { grid-auto-columns: 100%; }");
    expect(phone).toContain(".plan-card { scroll-snap-align: center; }");
    expect(phone).toMatch(/\.plan-card \.plan-list li \{[^}]*white-space: normal;[^}]*\}/);
    expect(phone).toMatch(/\.plan-card \.plan-list li > span \{[^}]*white-space: normal; overflow: visible;[^}]*\}/);
    // Wider than a phone the cards are the grid they were: no scrolling row.
    expect(STYLES.replace(phone!, "")).not.toMatch(/\.plan-cards \{[^}]*overflow-x/);
  });
});
