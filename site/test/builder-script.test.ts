// The analytics builder's page script (public/builder.js) on a preview the server does not draw: an answer that is
// not the result (any status but 200, or no x-build-fragment header) or a fault writes one line into the result, "The
// view could not be drawn." and the form's own button to try again, from the words the page carries in its JSON block
// (#build-words), in the page's language. The suite runs without a browser, so the script is read through what it
// exports (drawable, failedLine, the line built on a small stand-in for the document) and its own text; what a
// browser does with the line (the button submitting the form it names) is the platform's.
import { beforeAll, describe, expect, it } from "vitest";
import { drawable, failedLine } from "../public/builder.js";
import builderJs from "../public/builder.js?raw";
import { t } from "../src/i18n";
import { get, grantUltra, nbsp, newEmail, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { RECORDS, seedBuilder } from "./builder-fixture";

useAccountsDb();
beforeAll(() => seedBuilder());

// A stand-in for the document: elements that keep their attributes, text and children, enough for failedLine.
type Fake = { tag: string; attrs: Record<string, string>; kids: (Fake | string)[]; type?: string; className?: string; textContent?: string };
const fakeDoc = {
  createElement(tag: string) {
    const el: Fake & { setAttribute: (k: string, v: string) => void; append: (...xs: (Fake | string)[]) => void } = {
      tag, attrs: {}, kids: [],
      setAttribute(k, v) { this.attrs[k] = v; },
      append(...xs) { this.kids.push(...xs); },
    };
    return el;
  },
};

describe("the builder's script on a preview it cannot draw", () => {
  it("draws only the result's own answer, and writes the line for anything else", () => {
    expect(drawable(200, "1")).toBe(true);
    for (const [status, header] of [[200, null], [200, "0"], [403, "1"], [404, null], [429, null], [500, "1"], [503, "1"]] as const) {
      expect(drawable(status, header), `${status} ${header}`).toBe(false);
    }
    const words = { failed: "The view could not be drawn.", retry: "Show this view" };
    const line = failedLine(fakeDoc as never, words) as unknown as Fake;
    expect(line.tag).toBe("p");
    expect(line.kids[0]).toBe("The view could not be drawn. ");
    const button = line.kids[1] as Fake;
    // The form's own button: a submit button that names the form, flat, with the form's words.
    expect([button.tag, button.type, button.attrs.form, button.className, button.textContent]).toEqual(["button", "submit", "build-form", "btn-link", "Show this view"]);
    expect(line.kids).toHaveLength(2);
    // Without words, no line: the result stays as it was.
    expect(failedLine(fakeDoc as never, null)).toBeNull();
  });

  it("writes the line on a refused answer and on a fault, never for a request a newer one replaced, and holds no words of its own", () => {
    const preview = builderJs.slice(builderJs.indexOf("const preview = async"), builderJs.indexOf("let timer = 0;"));
    expect(preview).toMatch(/if \(!drawable\(res\.status, res\.headers\.get\("x-build-fragment"\)\)\) \{\s*if \(controller === asked\) failed\(\);\s*return;\s*\}/);
    expect(preview).toMatch(/catch \{\s*(\/\/[^\n]*\n\s*)*if \(controller === asked\) failed\(\);\s*\}/);
    expect(builderJs).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    // Nothing runs on import outside a page.
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    expect(builderJs).toContain('if (typeof document !== "undefined") start();');
    expect(builderJs).toContain('document.getElementById("build-words")');
    // No sentence of its own in a string literal.
    const sentences = [...builderJs.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((s) => /\b[A-Z][a-z]+(?: [a-z]+)+/.test(s));
    expect(sentences).toEqual([]);
  });

  it("is given its words by the page, in the page's language, for an Ultra reader alone", async () => {
    const email = newEmail("builder-script");
    const cookie = await signIn(email);
    await grantUltra(email);
    const env = onEnv({ BUILDER: "on", RECORDS });
    for (const lang of ["en", "fr"] as const) {
      const html = await (await get(`/analytics/build${lang === "fr" ? "?lang=fr" : ""}`, { cookie, env })).text();
      const block = html.match(/<script type="application\/json" id="build-words">([\s\S]*?)<\/script>/)?.[1] ?? "";
      expect(block, lang).not.toMatch(/[<>&]/);
      const words = JSON.parse(block) as { failed: string; retry: string };
      expect({ failed: nbsp(words.failed), retry: nbsp(words.retry) }).toEqual({ failed: nbsp(t(lang, "build.preview_failed")), retry: nbsp(t(lang, "build.apply")) });
      expect(html.indexOf('id="build-words"')).toBeGreaterThan(0);
      expect(html.indexOf('id="build-words"')).toBeLessThan(html.indexOf('<script type="module" src="/builder.js">'));
    }
    expect([t("en", "build.preview_failed"), t("fr", "build.preview_failed")]).toEqual(["The view could not be drawn.", "La vue n’a pas pu être affichée."]);
    // The sample a reader without the builder sees loads no script and carries no words for it.
    const signedOut = await (await get("/analytics/build", { env })).text();
    expect(signedOut).not.toContain("build-words");
    expect(signedOut).not.toContain("/builder.js");
  });
});
