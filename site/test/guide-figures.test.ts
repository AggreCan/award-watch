// The guides' figures (docs/guides.md, Figures; src/guides.ts Figure,
// src/pages/guides.tsx GuideFigure, scripts/make-guide-figures.mjs): every
// figure says its alt text, caption and marks in both languages; the tool's
// positions file measures every figure the guides hold and nothing else, at
// both languages and widths, each mark inside its image; the eight files of
// every figure ship as WebP in public/ at twice the measured size, and no
// file there belongs to no figure; the page draws both themes' pictures, the
// phone file at the phone breakpoint, lazy and sized, one mark a callout and
// a legend of the same length, in English and French; the stylesheet shows
// one theme and one width of marks; the files never reach the Worker; and
// the sample records the pages are drawn from name no real firm.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import contracts from "../figures/contracts.json";
import endingRows from "../figures/data/expiring/3m/1.json";
import newDay from "../figures/data/tenders/new/2026-11-13.json";
import recordsSql from "../figures/records.sql?raw";
import tenders from "../figures/tenders.json";
import { COLUMN, MARK, PHONE_COLUMN } from "../scripts/guide-figure-marks.mjs";
import wrangler from "../wrangler.jsonc?raw";
import { GUIDE_FIGURES } from "../src/guide_figures.gen";
import { GUIDES, guideFigures, type Figure, type FigureShot } from "../src/guides";
import { app } from "../src/index";
import { t } from "../src/i18n";
import { FIGURE_PHONE_MEDIA, FIGURE_THEMES, FIGURE_WIDTHS, figureFile, guideText } from "../src/pages/guides";
import { testEnv } from "./assets";

const LANGS = ["en", "fr"] as const;
const PUBLIC_FILES = JSON.parse((env as unknown as { PUBLIC_FILES: string }).PUBLIC_FILES) as { path: string; bytes: number; magic: string }[];
const STYLES = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;
type Suite = { include: string[]; exclude: string[] };
const SUITES = JSON.parse((env as unknown as { SUITES: string }).SUITES) as { default: Suite; mail: Suite; figures: Suite };

const FIGURES = guideFigures();
const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const page = async (path: string) =>
  (await app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": "192.0.2.77" } }, testEnv())).text();
const files = (slug: string, f: Figure) =>
  LANGS.flatMap((lang) => FIGURE_WIDTHS.flatMap((width) => FIGURE_THEMES.map((theme) => figureFile(slug, f.id, lang, width, theme))));
// The markup of one figure on a page, from its opening tag to its close.
const figureOf = (html: string, id: string) => {
  const at = html.indexOf(`<figure class="guide-figure" id="figure-${id}">`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</figure>", at) + "</figure>".length);
};

describe("the figures' content", () => {
  it("gives every figure an id of its own, its alt text, caption and three to six marks, each in both languages", () => {
    expect(FIGURES.length).toBeGreaterThanOrEqual(GUIDES.length);
    // Every guide on this list has at least one.
    for (const g of GUIDES) expect(FIGURES.some((f) => f.slug === g.slug), g.slug).toBe(true);
    const ids = FIGURES.map((f) => f.figure.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { figure: f } of FIGURES) {
      expect(f.id, f.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(f.shot.page.startsWith("/"), f.id).toBe(true);
      expect(f.shot.region.trim(), f.id).not.toBe("");
      for (const lang of LANGS) {
        expect(f.alt[lang].trim(), `${f.id} alt`).not.toBe("");
        expect(f.caption[lang].trim(), `${f.id} caption`).not.toBe("");
        expect(f.caption[lang].endsWith("."), `${f.id} caption`).toBe(true);
      }
      expect(f.callouts.length, f.id).toBeGreaterThanOrEqual(3);
      expect(f.callouts.length, f.id).toBeLessThanOrEqual(6);
      for (const [n, c] of f.callouts.entries()) {
        expect(c.target.trim(), `${f.id} callout ${n + 1}`).not.toBe("");
        for (const lang of LANGS) expect(c.text[lang].trim(), `${f.id} callout ${n + 1}`).not.toBe("");
      }
    }
  });
});

describe("the positions file", () => {
  it("measures every figure as the guides hold it, and nothing else", () => {
    expect(Object.keys(GUIDE_FIGURES).sort()).toEqual(FIGURES.map((f) => f.figure.id).sort());
    for (const { slug, figure: f } of FIGURES) {
      const m = GUIDE_FIGURES[f.id];
      // Run `npm run figures` again when a figure's page, region or targets change.
      expect({ slug: m.slug, page: m.page, region: m.region, targets: m.targets }, f.id)
        .toEqual({ slug, page: f.shot.page, region: f.shot.region, targets: f.callouts.map((c) => c.target) });
    }
  });

  it("holds both languages and both widths, one box a callout, every box inside its image", () => {
    for (const { figure: f } of FIGURES) {
      for (const lang of LANGS) {
        for (const width of FIGURE_WIDTHS) {
          const shot: FigureShot = GUIDE_FIGURES[f.id][lang][width];
          const where = `${f.id} ${lang} ${width}`;
          expect(Number.isInteger(shot.width) && shot.width > 0, where).toBe(true);
          expect(Number.isInteger(shot.height) && shot.height > 0, where).toBe(true);
          // The wide image fits the figure's room in the guide's 846 px column (less the frame's indent) at the
          // desktop layout, shown at its own size; the phone one is a 390 px page's, shown at 0.85 or more.
          if (width === "wide") {
            expect(shot.width, where).toBeLessThanOrEqual(COLUMN - MARK.indent);
            expect(shot.viewport, where).toBeGreaterThanOrEqual(1000);
          } else {
            expect(shot.viewport, where).toBe(390);
            expect((PHONE_COLUMN - MARK.indent) / shot.width, `${where}: shown below 0.85 of its size`).toBeGreaterThanOrEqual(0.85);
          }
          expect(shot.boxes.length, where).toBe(f.callouts.length);
          for (const [x, y, w, h] of shot.boxes) {
            expect(x >= 0 && y >= 0 && w > 0 && h > 0, where).toBe(true);
            expect(x + w, where).toBeLessThanOrEqual(100.01);
            expect(y + h, where).toBeLessThanOrEqual(100.01);
          }
        }
      }
    }
  });
});

describe("the image files", () => {
  it("serves all eight of every figure from the static assets as WebP, each at twice its measured size", async () => {
    const assets = (env as unknown as { ASSETS: Fetcher }).ASSETS;
    for (const { slug, figure: f } of FIGURES) {
      for (const path of files(slug, f)) {
        const res = await assets.fetch(new Request(`https://assets.invalid${path}`));
        expect(res.status, path).toBe(200);
        expect(res.headers.get("content-type"), path).toBe("image/webp");
        const bytes = new Uint8Array(await res.arrayBuffer());
        const text = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
        expect(text(0, 4) + text(8, 12), path).toBe("RIFFWEBP");
        // The canvas size the extended header states (the browser writes a VP8X header with its colour profile).
        expect(text(12, 16), path).toBe("VP8X");
        const size = (at: number) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) + 1;
        const [, lang, width] = /\.(en|fr)\.(wide|phone)\./.exec(path)!;
        const shot = GUIDE_FIGURES[f.id][lang as "en" | "fr"][width as "wide" | "phone"];
        expect([size(24), size(27)], path).toEqual([shot.width * 2, shot.height * 2]);
      }
    }
  });

  it("ships no file under public/figures that belongs to no figure", () => {
    const shipped = PUBLIC_FILES.filter((f) => f.path.startsWith("figures/")).map((f) => `/${f.path}`).sort();
    const wanted = FIGURES.flatMap(({ slug, figure }) => files(slug, figure)).sort();
    expect(shipped).toEqual(wanted);
    for (const f of PUBLIC_FILES.filter((x) => x.path.startsWith("figures/"))) expect(f.magic, f.path).toBe("RIFF");
  });

  it("are static files the Worker never runs for", () => {
    const first = JSON.parse(/"run_worker_first":\s*(\[[^\]]*\])/.exec(wrangler)?.[1] ?? "[]") as string[];
    expect(first.length).toBeGreaterThan(0);
    expect(first.some((g) => g.startsWith("/figures") || g === "/*")).toBe(false);
    expect(wrangler).toContain('"directory": "./public"');
  });
});

describe("the figures on the page", () => {
  it("draws each figure where its guide holds one, and none elsewhere", async () => {
    for (const path of ["/guides", "/guides?lang=fr"]) expect(await page(path), path).not.toContain("guide-figure");
    for (const g of GUIDES) {
      const n = FIGURES.filter((f) => f.slug === g.slug).length;
      for (const lang of LANGS) {
        const html = await page(lang === "fr" ? `/guides/${g.slug}?lang=fr` : `/guides/${g.slug}`);
        expect((html.match(/<figure class="guide-figure"/g) ?? []).length, `${g.slug} ${lang}`).toBe(n);
      }
    }
  });

  it("gives each figure both themes' pictures, the phone file at the breakpoint, sized and lazy, one mark a callout and its legend", async () => {
    expect(FIGURE_PHONE_MEDIA).toBe("(max-width: 699px)");
    for (const { slug, figure: f } of FIGURES) {
      for (const lang of LANGS) {
        const html = await page(lang === "fr" ? `/guides/${slug}?lang=fr` : `/guides/${slug}`);
        const fig = figureOf(html, f.id);
        const where = `${f.id} ${lang}`;
        expect(fig, where).not.toBe("");
        const shots = GUIDE_FIGURES[f.id][lang];
        const alt = decode(guideText(lang, f.alt));
        for (const theme of FIGURE_THEMES) {
          const picture = new RegExp(`<picture class="fig-${theme}">([\\s\\S]*?)</picture>`).exec(fig)?.[1] ?? "";
          expect(picture, `${where} ${theme}`).not.toBe("");
          expect(picture).toContain(`<source media="${FIGURE_PHONE_MEDIA}" srcset="${figureFile(slug, f.id, lang, "phone", theme)}" ` +
            `width="${shots.phone.width}" height="${shots.phone.height}"/>`);
          const img = /<img [^>]*>/.exec(picture)?.[0] ?? "";
          expect(img, `${where} ${theme}`).toContain(`src="${figureFile(slug, f.id, lang, "wide", theme)}"`);
          expect(img).toContain(`width="${shots.wide.width}" height="${shots.wide.height}"`);
          expect(img).toContain('loading="lazy"');
          expect(decode(img)).toContain(`alt="${alt}"`);
        }
        for (const width of FIGURE_WIDTHS) {
          const marks = new RegExp(`<div class="fig-marks fig-marks-${width}" aria-hidden="true">([\\s\\S]*?)</div>`).exec(fig)?.[1] ?? "";
          const spans = [...marks.matchAll(/<span class="fig-mark" style="left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%;height:([\d.]+)%">/g)];
          expect(spans.map((m) => m.slice(1, 5).map(Number)), `${where} ${width}`).toEqual(shots[width].boxes.map((b) => [...b]));
          expect([...marks.matchAll(/<span class="fig-num">(\d+)<\/span>/g)].map((m) => Number(m[1]))).toEqual(f.callouts.map((_, i) => i + 1));
        }
        expect(fig).toContain(`style="--fig-wide:${shots.wide.width}px;--fig-phone:${shots.phone.width}px"`);
        const legend = /<ol class="fig-legend">([\s\S]*?)<\/ol>/.exec(fig)?.[1] ?? "";
        const items = [...legend.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => nbsp(decode(m[1])));
        expect(items, where).toEqual(f.callouts.map((c) => nbsp(guideText(lang, c.text))));
        expect(nbsp(decode(fig))).toContain(nbsp(`${guideText(lang, f.caption)} ${t(lang, "guides.figure_sample")}</p>`));
        expect(fig.indexOf("<figcaption>")).toBeGreaterThan(fig.indexOf("fig-marks-phone"));
      }
    }
  });

  it("says the record is a sample in both languages", () => {
    expect(t("en", "guides.figure_sample")).toBe("The record pictured is a sample made for this guide.");
    expect(t("fr", "guides.figure_sample")).toContain("exemple");
  });
});

describe("the stylesheet", () => {
  it("shows the theme's picture, never wider than its capture or the column, and the marks of the width", () => {
    const flat = STYLES.replace(/\s+/g, " ");
    expect(flat).toContain(`.fig-frame { position: relative; width: calc(100% - ${MARK.indent}px); max-width: var(--fig-wide); margin-left: ${MARK.indent}px; }`);
    expect(flat).toContain(".fig-frame img { display: block; width: 100%; max-width: 100%; height: auto; }");
    expect(flat).toContain(".fig-frame .fig-dark { display: none; }");
    expect(flat).toContain(':root[data-theme="dark"] .fig-frame .fig-light { display: none; }');
    expect(flat).toContain(':root[data-theme="dark"] .fig-frame .fig-dark { display: block; }');
    expect(flat).toContain('@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .fig-frame .fig-light { display: none; } ' +
      ':root:not([data-theme="light"]) .fig-frame .fig-dark { display: block; } }');
    expect(flat).toContain(".fig-marks-phone { display: none; }");
    expect(flat).toContain("@media (max-width: 699px) { .fig-frame { max-width: var(--fig-phone); } .fig-marks-wide { display: none; } .fig-marks-phone { display: block; } }");
    // The emerald edge, and the numeral in the filled button's type on the emerald.
    expect(flat).toMatch(/\.fig-num \{[^}]*background: var\(--accent\); color: var\(--on-primary\);/);
  });

  it("draws the marks with the numbers the capture tool checks them by (scripts/guide-figure-marks.mjs)", () => {
    const flat = STYLES.replace(/\s+/g, " ");
    // The edge `gap` out from the field, `edge` wide.
    expect(flat).toContain(`.fig-mark { position: absolute; outline: ${MARK.edge}px solid var(--accent); outline-offset: ${MARK.gap}px; }`);
    // The number's square to the left of the edge, its right side against the edge's left side, its top level with the edge's top.
    const out = MARK.gap + MARK.edge;
    expect(flat).toContain(`.fig-num { position: absolute; top: -${out}px; left: -${out + MARK.square}px; width: ${MARK.square}px; height: ${MARK.square}px;`);
    // The indent and the column's padding a hanging square takes, and the column's widths the tool fits the images to.
    expect(flat).toContain(`margin-left: ${MARK.indent}px;`);
    expect(flat).toMatch(new RegExp(`\\.doc \\{[^}]*padding: 0 ${MARK.padding}px ${MARK.padding}px;[^}]*border: 1px solid var\\(--border\\);`));
    expect(flat).toContain("--measure: 880px;");
    expect(COLUMN).toBe(880 - 2 * MARK.padding - 2);
    // A 390 px phone: the 16 px gutters (--gutter on phones), then the column's padding and border.
    expect(flat).toContain(":root { --gutter: 16px; }");
    expect(PHONE_COLUMN).toBe(390 - 2 * 16 - 2 * MARK.padding - 2);
    // A hanging square stays at least 2 px inside the column's padding (the tool refuses one that would not).
    expect(MARK.clear).toBeGreaterThanOrEqual(2);
  });
});

describe("the capture", () => {
  it("runs as its own suite under `npm run figures`, apart from the default one", () => {
    expect(pkg.scripts.figures).toBe("node scripts/make-guide-figures.mjs");
    expect(SUITES.figures.include).toEqual(["figures/**/*.test.ts"]);
    expect(SUITES.default.include).toEqual(["test/**/*.test.ts"]);
    expect(SUITES.mail.include).toEqual(["test-mail/**/*.test.ts"]);
  });

  it("draws its pages from sample records whose suppliers are plainly samples", () => {
    const names = [
      ...Object.values(contracts).map((c) => c.supplier),
      ...endingRows.map((r) => r.organization),
      ...[...recordsSql.matchAll(/\(\d+, '([^']+)'\)/g)].map((m) => m[1]),
      ...[...recordsSql.matchAll(/\(\d+, \d+, \d+, '([^']+)', NULL,/g)].map((m) => m[1]),
    ];
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const name of names) expect(name, name).toMatch(/^Sample [A-Z][A-Za-z ]+(?:Inc\.|Ltd\.)$/);
    // A notice's description that names its intended supplier names a sample too.
    for (const d of Object.values(tenders)) {
      for (const text of [d.description_en, d.description_fr]) {
        for (const m of text.matchAll(/\b([A-Z][a-z]+ [A-Z][a-z]+ (?:Inc|Ltd)\.)/g)) expect(m[1], text).toMatch(/^Sample /);
      }
    }
  });

  it("gives every sample record a reference number in a range the real series is nowhere near", () => {
    const UNREAL = [
      /^cb-900-9000\d{4}$/, // CanadaBuys notice references
      /^C-\d{4}-\d{4}-Q[1-4]-9\d{4}$/, // published contracts' references
      /^CW9\d{6}$/i, // PSPC contract numbers
      /^[A-Z0-9]{5}-99\d{4}(?:\/\d{3}\/[A-Z]{2})?$/, // PSPC solicitation, procurement and agreement numbers
      /^NRCan-5099\d{6}$/, // a department's own solicitation number
      /^\d{2}999\d{5}$/, // procurement identification and solicitation numbers in figures
    ];
    const refs = [
      ...Object.entries(tenders).flatMap(([k, d]) => [k, d.reference, d.solicitation]),
      ...newDay.map((r) => r.reference),
      ...Object.values(contracts).flatMap((c) => [c.reference, c.contract_number, c.procurement_number, c.solicitation, c.tender_reference]),
      ...endingRows.map((r) => r.reference.slice(r.reference.indexOf(":") + 1)),
      ...[...recordsSql.matchAll(/\(\d+, '[a-z-]+', '([^']+)', '([^']+)', \d+, \d+, \d+, '\d{4}-/g)].flatMap((m) => [m[1], m[2]]),
      ...[...recordsSql.matchAll(/'[a-z-]+:([^']+)'/g)].map((m) => m[1]),
      ...[...recordsSql.matchAll(/\(\d+, '([A-Z0-9]{5}-\d{6}\/\d{3}\/[A-Z]{2})',/g)].map((m) => m[1]),
      // The pages the figures are captured from name their records too.
      ...FIGURES.map((f) => decodeURIComponent(f.figure.shot.page.split("/").at(-1) ?? "")).filter((r) => r !== "new" && r !== "3m"),
    ].filter((r): r is string => typeof r === "string");
    expect(refs.length).toBeGreaterThanOrEqual(30);
    for (const ref of refs) expect(UNREAL.some((re) => re.test(ref)), ref).toBe(true);
  });
});
