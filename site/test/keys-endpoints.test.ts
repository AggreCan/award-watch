// The keys page's Endpoints panel on a phone: its labels are addresses (dt.mono) wider than a key and value list's
// label column below 700 px, which left their words a letter wide at 320 px. The stylesheet gives each address a row
// of its own above its words there (public/styles.css, the phone block), and the page's markup is as it was: every
// label of the panel's list is a .mono address, so the rule reaches each of them; wider screens keep the two columns.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { KEYED_ENDPOINTS } from "../src/api_keyed_spec";
import { get, grantPro, newEmail, signIn, useAccountsDb } from "./accounts-helpers";

useAccountsDb();

const STYLES = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;

// Each block of the stylesheet's at-rule with this head, its body without the braces.
function blocks(css: string, head: string): string[] {
  const out: string[] = [];
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
    const open = css.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        out.push(css.slice(open + 1, i));
        break;
      }
    }
  }
  return out;
}

describe("the keys page's endpoints on a phone", () => {
  it("draws each endpoint's address as a .mono label of the panel's list", async () => {
    const email = newEmail("keys-endpoints");
    const cookie = await signIn(email);
    await grantPro(email);
    for (const q of ["", "?lang=fr"]) {
      const html = await (await get(`/account/keys${q}`, { cookie })).text();
      const list = html.slice(html.indexOf("<dl>", html.indexOf(q ? "Points d" : "Endpoints")), html.indexOf("</dl>", html.indexOf(q ? "Points d" : "Endpoints")));
      const labels = [...list.matchAll(/<dt( class="[^"]*")?>/g)].map((m) => m[1] ?? "");
      expect(labels, q).toHaveLength(KEYED_ENDPOINTS.length);
      expect(labels.every((c) => c === ' class="mono"'), q).toBe(true);
    }
  });

  it("gives an address label and its words a row each below 700 px, and leaves wider screens as they were", () => {
    const phone = blocks(STYLES, "@media (max-width: 699px)").join("\n");
    expect(phone).toContain("dt.mono, dt.mono + dd { grid-column: 1 / -1; }");
    expect(phone).toContain("dt.mono { padding-bottom: 0; }");
    expect(phone).toContain("dt.mono + dd { border-top: 0; padding-top: 2px; }");
    // Outside the phone blocks no rule names dt.mono.
    const rest = blocks(STYLES, "@media (max-width: 699px)").reduce((css, b) => css.replace(b, ""), STYLES);
    expect(rest).not.toContain("dt.mono");
  });
});
