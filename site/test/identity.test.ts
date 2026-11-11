// The Console's identity pass (operator, 2026-11-08: the console's look brought
// toward the landing page's, in identity and not layout). Four rules, each held
// here to the stylesheet and, where markup carries it, to the pages:
//   1. Bricolage Grotesque, the landing page's display face, for page titles and
//      tile figures alone, declared in both stylesheets the same way;
//   2. the landing page's navy top bar in both themes, everything on it in the
//      bar's own tones, every text on it at 4.5:1 or better and a control's
//      edge at 3:1 or better;
//   3. one filled button, .btn-primary in the emerald, which Follow takes on a
//      profile and on a contract's page; a buyer and a tender notice keep it on
//      their own first action and their Follow flat;
//   4. 6 px corners on controls, 4 px on the Pro chip, and none on the regions.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { get, newEmail, offEnv, onEnv, signIn, useAccountsDb } from "./accounts-helpers";

useAccountsDb();

const STYLES = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;
const LANDING_CSS = (env as unknown as { LANDING_CSS: string }).LANDING_CSS;
const ORG = "org-a000000001";

// Every rule outside comments, its selector trimmed.
function rules(css = STYLES): { selector: string; body: string }[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}
const rule = (selector: string) => rules().find((r) => r.selector === selector);
const decl = (body: string | undefined, prop: string) => new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body ?? "")?.[1].trim();

// The three palettes: light, the saved dark choice, and the system's dark setting.
const LIGHT = /:root \{[\s\S]*?\n\}/.exec(STYLES)?.[0] ?? "";
const DARK = /:root\[data-theme="dark"\] \{[\s\S]*?\n\}/.exec(STYLES)?.[0] ?? "";
const MEDIA = /:root:not\(\[data-theme="light"\]\) \{[\s\S]*?\n {2}\}/.exec(STYLES)?.[0] ?? "";
const token = (block: string, name: string) => new RegExp(`(?:^|\\s)${name}: (#[0-9a-f]{6}(?:[0-9a-f]{2})?);`).exec(block)?.[1];
// A dark palette inherits whatever it does not redefine from :root.
const themeToken = (theme: "light" | "dark", name: string) => (theme === "dark" ? token(DARK, name) : undefined) ?? token(LIGHT, name);

// WCAG 2 contrast, with a translucent colour laid over its ground first.
const rgba = (hex: string) => [1, 3, 5, 7].map((i) => (i === 7 ? (hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1) : parseInt(hex.slice(i, i + 2), 16)));
const over = (fg: string, bg: string) => {
  const [f, b] = [rgba(fg), rgba(bg)];
  return `#${[0, 1, 2].map((i) => Math.round(f[i] * f[3] + b[i] * (1 - f[3])).toString(16).padStart(2, "0")).join("")}`;
};
const luminance = (hex: string) => {
  const [r, g, b] = rgba(hex).slice(0, 3).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("the display face", () => {
  it("is declared in styles.css exactly as landing.css declares it, under the same token", () => {
    const face = (css: string) => /@font-face \{[^}]*"Bricolage Grotesque"[^}]*\}/.exec(css)?.[0];
    expect(face(STYLES)).toBeDefined();
    expect(face(STYLES)).toBe(face(LANDING_CSS));
    expect(face(STYLES)).toContain('src: url("/fonts/BricolageGrotesque-Variable.woff2") format("woff2");');
    const display = (css: string) => /--display: ([^;]+);/.exec(css)?.[1];
    expect(display(LIGHT)).toBe(display(LANDING_CSS));
  });

  it("sets the page titles at 28/34 and the tile figures, both at 800, and nothing else", () => {
    const h1 = rule("h1");
    expect(decl(h1?.body, "font-family")).toBe("var(--display)");
    expect(decl(h1?.body, "font-size")).toBe("28px");
    expect(decl(h1?.body, "line-height")).toBe("34px");
    expect(decl(h1?.body, "font-weight")).toBe("800");
    expect(decl(h1?.body, "letter-spacing")).toBe("-0.02em");
    const tile = rule(".tile-value");
    expect(decl(tile?.body, "font-family")).toBe("var(--display)");
    expect(decl(tile?.body, "font-weight")).toBe("800");
    // The face's own figures are proportional; its tabular set changes the digits alone.
    expect(decl(tile?.body, "font-variant-numeric")).toBe("tabular-nums");
    // Tables, the rail, labels and controls stay in Inter: no other rule names the face.
    expect(rules().filter((r) => r.body.includes("var(--display)")).map((r) => r.selector)).toEqual(["h1", ".tile-value"]);
    expect(STYLES.replace(/\/\*[\s\S]*?\*\//g, "").match(/"Bricolage Grotesque"/g)).toHaveLength(2); // the @font-face and the token
    expect(decl(rule("body")?.body, "font-family")).toBe("var(--font)");
  });
});

describe("the navy top bar", () => {
  it("takes the operator's navy and its hover step in each palette, the system's dark setting as the saved choice", () => {
    expect(token(LIGHT, "--bar")).toBe("#0c1b2a");
    expect(token(LIGHT, "--bar-hover")).toBe("#122638");
    expect(token(DARK, "--bar")).toBe("#07111d");
    expect(token(DARK, "--bar-hover")).toBe("#0e1b2b");
    for (const name of ["--bar", "--bar-hover", "--primary", "--primary-hover", "--on-primary"]) expect(token(MEDIA, name), name).toBe(token(DARK, name));
    expect(token(LIGHT, "--on-bar")).toBe("#ffffff");
    expect(token(LIGHT, "--on-bar-muted")).toBe("#9fb0bd");
    expect(token(LIGHT, "--bar-accent")).toBe("#2fc985");
  });

  it("gives the tokens its contents read the bar's own tones, so no control on it needs a rule of its own", () => {
    const bar = rule(".topbar")?.body;
    const mapped: Record<string, string> = {
      "--panel": "var(--bar)", "--hover": "var(--bar-hover)", "--ink": "var(--on-bar)", "--ink-2": "var(--on-bar-2)",
      "--muted": "var(--on-bar-muted)", "--accent": "var(--bar-accent)", "--check": "var(--bar-accent)", "--field-border": "var(--bar-edge)",
    };
    for (const [name, value] of Object.entries(mapped)) expect(decl(bar, name), name).toBe(value);
    expect(decl(bar, "background")).toBe("var(--bar)");
    expect(decl(bar, "border-bottom")).toBe("2px solid var(--accent)");
    // The search field's translucent fill, the language and theme buttons' hover step, the reload link's emerald.
    expect(decl(rule('.topbar-search input[type="search"]')?.body, "background")).toBe("var(--bar-field)");
    expect(decl(rule(".lang-toggle:hover, .theme-toggle:hover")?.body, "background")).toBe("var(--hover)");
    expect(decl(rule(".refresh-reload")?.body, "color")).toBe("var(--accent)");
    // No rule reaches into the bar with a colour of its own.
    expect(rules().filter((r) => /\.topbar[\s.]/.test(r.selector) && /#[0-9a-f]{3,8}\b/i.test(r.body))).toEqual([]);
  });

  it("holds every text on it at 4.5:1 or better and a control's edge at 3:1 or better, on the bar and its hover step, in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const bar = themeToken(theme, "--bar")!;
      const hover = themeToken(theme, "--bar-hover")!;
      const field = over(themeToken(theme, "--bar-field")!, bar);
      // White (the wordmark, the figures), the light ink (the buttons), the muted tone (the data date, the labels, a free
      // plan, the placeholder) and the bright emerald (the chip, a Pro plan, the reload link).
      for (const name of ["--on-bar", "--on-bar-2", "--on-bar-muted", "--bar-accent"]) {
        const text = themeToken(theme, name)!;
        expect(contrast(text, bar), `${theme} ${name} on the bar`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(text, hover), `${theme} ${name} on the hover step`).toBeGreaterThanOrEqual(4.5);
      }
      for (const name of ["--on-bar", "--on-bar-muted"]) {
        expect(contrast(themeToken(theme, name)!, field), `${theme} ${name} on the search field`).toBeGreaterThanOrEqual(4.5);
      }
      const edge = over(themeToken(theme, "--bar-edge")!, bar);
      expect(contrast(edge, bar), `${theme} a control's edge`).toBeGreaterThanOrEqual(3);
      expect(contrast(over(themeToken(theme, "--bar-edge")!, hover), hover), `${theme} a hovered control's edge`).toBeGreaterThanOrEqual(3);
    }
  });

  it("styles the language button and the theme button as the bar's controls, by the class the markup gives them", async () => {
    const page = await (await get("/tenders")).text();
    const bar = /<header class="topbar">[\s\S]*?<\/header>/.exec(page)?.[0] ?? "";
    expect(bar).toContain('class="lang-toggle"');
    expect(bar).toContain('class="theme-toggle"');
    expect(bar).not.toContain("style=");
    const toggles = rule(".lang-toggle, .theme-toggle")?.body;
    expect(decl(toggles, "border")).toBe("1px solid var(--field-border)");
    expect(decl(toggles, "background")).toBe("var(--panel)");
    expect(decl(toggles, "border-radius")).toBe("6px");
  });
});

describe("one filled button", () => {
  it("is .btn-primary in the emerald, white type on it in the light theme and navy in the dark, at 600", () => {
    const primary = rule(".btn-primary")?.body;
    expect(decl(primary, "background")).toBe("var(--primary)");
    expect(decl(primary, "border-color")).toBe("var(--primary)");
    expect(decl(primary, "color")).toBe("var(--on-primary)");
    expect(decl(primary, "font-weight")).toBe("600");
    expect(token(LIGHT, "--primary")).toBe("#0f7b4f");
    expect(token(LIGHT, "--on-primary")).toBe("#ffffff");
    expect(token(DARK, "--primary")).toBe("#2fc985");
    expect(token(DARK, "--on-primary")).toBe("#07111d");
    for (const theme of ["light", "dark"] as const) {
      for (const ground of ["--primary", "--primary-hover"]) {
        expect(contrast(themeToken(theme, "--on-primary")!, themeToken(theme, ground)!), `${theme} ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Every other button stays an outline on the panel ground.
    const btn = rule(".btn")?.body;
    expect(decl(btn, "background")).toBe("var(--panel)");
    expect(decl(btn, "border")).toBe("1px solid var(--field-border)");
  });

  it("is a profile's Follow, signed in or not, and the profile's only one", async () => {
    const out = await (await get(`/organizations/${ORG}`)).text();
    expect(out.match(/class="btn btn-primary"/g)).toHaveLength(1);
    expect(out).toMatch(/<form method="post" action="\/account\/sign-in" class="watch-control watch-signin">[\s\S]*?<button type="submit" class="btn btn-primary">Follow<\/button>/);
    const cookie = await signIn(newEmail("identity-follow"));
    const signedIn = await (await get(`/organizations/${ORG}`, { cookie })).text();
    expect(signedIn.match(/class="btn btn-primary"/g)).toHaveLength(1);
    expect(signedIn).toContain('<button type="submit" class="btn btn-primary">Follow</button>');
  });

  it("leaves Follow flat where the page's first action is already the filled one", async () => {
    const cookie = await signIn(newEmail("identity-flat"));
    for (const path of ["/buyers/pwgsc-tpsgc", "/tenders/cb-100-10000001"]) {
      const page = await (await get(path, { cookie })).text();
      expect(page, path).toContain('<button type="submit" class="btn">Follow</button>');
      expect(page.match(/class="btn btn-primary"/g), path).toHaveLength(1);
    }
    // On a tender notice the filled button is the notice at the source, where a bid starts.
    expect(await (await get("/tenders/cb-100-10000001", { cookie })).text()).toMatch(/<a href="[^"]*" class="btn btn-primary" rel="noopener">[^<]*CanadaBuys/);
    // The filters' Apply is the tender list's.
    const list = await (await get("/tenders", { env: onEnv() })).text();
    expect(list.match(/class="btn btn-primary"/g)).toHaveLength(1);
    expect(list).toContain('class="btn btn-primary" id="tender-apply"');
  });
});

// An award notice and a contract history record; a published contract reads
// the records database, so its case is in records-tables.test.ts.
describe("a contract's page", () => {
  const PAGES = ["/awards/cb-400-40000004", "/history/w8472-000633"];
  const SOURCE = /<a href="https:\/\/[^"]*" class="(btn(?: btn-primary)?)" rel="noopener">/;

  it("fills Follow and leaves the link to the source flat, signed in or not", async () => {
    const cookie = await signIn(newEmail("identity-contract"));
    for (const path of PAGES) {
      for (const html of [await (await get(path)).text(), await (await get(path, { cookie })).text()]) {
        expect(html.match(/class="btn btn-primary"/g), path).toHaveLength(1);
        expect(html, path).toContain('<button type="submit" class="btn btn-primary">Follow</button>');
        expect(SOURCE.exec(html)?.[1], path).toBe("btn");
      }
    }
  });

  it("keeps the filled button on the link to the source while there is no Follow, as the page was", async () => {
    for (const path of PAGES) {
      const html = await (await get(path, { env: offEnv() })).text();
      expect(html, path).not.toContain("watch-control");
      expect(html.match(/class="btn btn-primary"/g), path).toHaveLength(1);
      expect(SOURCE.exec(html)?.[1], path).toBe("btn btn-primary");
    }
  });
});

describe("a chart's gradients", () => {
  it("are the panel's own, numbered on the page so its markup is the same on every render, with the plain colour to fall back on", async () => {
    const path = "/buyers/pwgsc-tpsgc";
    const first = await (await get(path)).text();
    expect(await (await get(path)).text()).toBe(first);
    const ids = [...first.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^c[fw]-\d+-\d+$/);
    // Every gradient a mark names is defined in the page, and every bar that fades names the flat colour after it.
    const used = [...first.matchAll(/style="fill:url\(#([^)]+)\) var\(--chart-(?:bar|wash)\)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(ids).toContain(id);
    expect(first).not.toMatch(/<path class="bar bar-light" style=/);
  });
});

describe("on a phone", () => {
  it("the page comes before the rail and the footer after both, by order alone", () => {
    const at = STYLES.indexOf("/* -- phones: one column");
    const phone = STYLES.slice(at, STYLES.indexOf("\n}\n", at));
    const body = (selector: string) => phone.split(`\n  ${selector} {`)[1]?.split("}")[0] ?? "";
    expect(body(".frame")).toContain("flex-direction: column");
    expect(body(".content")).toContain("display: contents");
    expect([body("main"), body(".rail"), body(".site-footer")].map((b) => /order: (\d)/.exec(b)?.[1])).toEqual(["1", "2", "3"]);
  });

  it("a profile's upkeep folds behind one button, which wider screens never see", () => {
    // The fold's button is the phone fold's own: hidden from 700 px, where the links sit in the head's row.
    expect(STYLES).toContain("@media (min-width: 700px) { .phone-fold > summary { display: none; } }");
    expect(decl(rule(".actions-more")?.body, "display")).toBe("flex");
    expect(decl(rule(".actions-more")?.body, "flex-wrap")).toBe("wrap");
    expect(decl(rule(".actions-fold > summary")?.body, "margin")).toBe("0");
    // Open on a phone, the fold takes a row of its own under its button.
    expect(STYLES).toMatch(/@media \(max-width: 699px\) \{\n {2}\.actions-fold\[open\] \{ flex-basis: 100%; \}\n {2}\.actions-fold\[open\] > summary \{ margin-bottom: 8px; \}\n\}/);
  });
});

describe("corners", () => {
  it("round a control by 6 px and the Pro chip by 4, and nothing else but the charts' bars", () => {
    const rounded = rules()
      .map((r) => [r.selector, decl(r.body, "border-radius")] as const)
      .filter(([, radius]) => radius !== undefined && radius !== "0");
    expect(rounded).toEqual([
      [".lang-toggle, .theme-toggle", "6px"],
      [".btn", "6px"],
      ['input[type="search"], input[type="text"], input[type="number"], input[type="email"], select, textarea', "6px"],
      [".rank-bar", "0 4px 4px 0"],
      // A meter against a cap is one whole: its track and its fill are rounded both ends.
      [".rank-bars.of-cap .rank-track", "4px"],
      [".rank-bars.of-cap .rank-bar", "4px"],
      [".pro-tag", "4px"],
    ]);
  });
});

// The charts' marks (operator, 2026-11-11: thick, inky bars do not invite a reader in): one emerald, a bar
// a thin mark with air around it and a rounded data end, scaffolding that steps back, a wash under a line.
describe("the charts' marks", () => {
  it("are one emerald in each theme, with its pale step, its darker step under the pointer and its wash", () => {
    expect(token(LIGHT, "--chart-bar")).toBe("#1f8a62");
    expect(token(LIGHT, "--chart-bar-light")).toBe("#bfe3d1");
    expect(token(LIGHT, "--chart-on")).toBe("#0f6b45");
    expect(token(LIGHT, "--chart-wash")).toBe("#1f8a621f");
    for (const block of [DARK, MEDIA]) {
      expect(token(block, "--chart-bar")).toBe("#22a873");
      expect(token(block, "--chart-bar-light")).toBe("#1b4a39");
      expect(token(block, "--chart-on")).toBe("#5ad6a0");
      expect(token(block, "--chart-wash")).toBe("#22a87326");
    }
    // A mark reads against the panel at 3:1 or better, and the mark under the pointer too.
    for (const theme of ["light", "dark"] as const) {
      for (const name of ["--chart-bar", "--chart-on"]) {
        expect(contrast(themeToken(theme, name)!, themeToken(theme, "--panel")!), `${theme} ${name}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("draw through those tokens alone: bars, lines, dots on a ring of the panel, ranked bars, and a quiet baseline", () => {
    expect(decl(rule(".chart-plot .bar")?.body, "fill")).toBe("var(--chart-bar)");
    expect(decl(rule(".chart-plot .bar-light")?.body, "fill")).toBe("var(--chart-bar-light)");
    expect(decl(rule(".chart-plot .area")?.body, "fill")).toBe("var(--chart-wash)");
    // The fade: a bar full at its data end and lighter at its foot, a wash that ends at nothing; one hue throughout.
    for (const stop of [".chart-plot .fade-top", ".chart-plot .fade-foot", ".chart-plot .wash-top", ".chart-plot .wash-foot"]) {
      expect(decl(rule(stop)?.body, "stop-color"), stop).toBe("var(--chart-bar)");
    }
    expect(decl(rule(".chart-plot .fade-top")?.body, "stop-opacity")).toBeUndefined();
    expect(Number(decl(rule(".chart-plot .fade-foot")?.body, "stop-opacity"))).toBeGreaterThanOrEqual(0.6);
    expect(decl(rule(".chart-plot .wash-foot")?.body, "stop-opacity")).toBe("0");
    const line = rule(".chart-plot .line")?.body;
    expect([decl(line, "stroke"), decl(line, "stroke-width")]).toEqual(["var(--chart-bar)", "2"]);
    const dot = rule(".chart-plot .dot")?.body;
    expect([decl(dot, "stroke"), decl(dot, "stroke-width")]).toEqual(["var(--chart-bar)", "8"]);
    const ring = rule(".chart-plot .dot-ring")?.body;
    expect([decl(ring, "stroke"), decl(ring, "stroke-width")]).toEqual(["var(--panel)", "12"]);
    expect(decl(rule(".chart-plot .dot-quiet")?.body, "stroke")).toBe("transparent");
    expect(decl(rule(".rank-bar")?.body, "background")).toBe("var(--chart-bar)");
    expect(decl(rule(".rank-track")?.body, "height")).toBe("8px");
    // The scaffolding: a baseline in the second border, solid hairline gridlines.
    expect(decl(rule(".chart-plot")?.body, "border-bottom")).toBe("1px solid var(--border-2)");
    expect(rules().some((r) => r.selector.includes(".grid") && /stroke-dasharray/.test(r.body))).toBe(false);
  });
});
