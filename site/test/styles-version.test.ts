// The stylesheet's version (src/layout.tsx STYLES_VERSION, the ?v= every page links public/styles.css with) held to
// the stylesheet it belongs to: PINNED names the version and the SHA-256 of public/styles.css (line ends read as LF).
// A change to the stylesheet with the version left as it was would let a browser keep the old stylesheet beside new
// markup; a version raised with no change to the stylesheet would cost every reader a download for nothing. Either
// fails here, and the fix is one change: raise STYLES_VERSION by one and set both values of PINNED to the new
// version and the hash the failure prints.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { STYLES_VERSION } from "../src/layout";

const PINNED = { version: 78, sha256: "10f510233c11087e3389f70c01d7219bfdb7702af6105e46288afdc9d6c1b574" };

const STYLES = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("the stylesheet's version", () => {
  it("moves with the stylesheet: a change to public/styles.css raises STYLES_VERSION by one, and the pin with it", async () => {
    const sha256 = await sha256Hex(STYLES.replace(/\r\n/g, "\n"));
    const changed = sha256 !== PINNED.sha256;
    const message = changed
      ? `public/styles.css changed: raise STYLES_VERSION in src/layout.tsx to ${PINNED.version + 1} and set PINNED in ` +
        `test/styles-version.test.ts to { version: ${PINNED.version + 1}, sha256: "${sha256}" }, in the same change`
      : `STYLES_VERSION moved to ${STYLES_VERSION} with no change to public/styles.css: put it back to ${PINNED.version}, ` +
        "or change the stylesheet and update PINNED in test/styles-version.test.ts with it";
    expect({ version: STYLES_VERSION, sha256 }, message).toEqual(PINNED);
  });

  it("is linked on every page at that version", async () => {
    const { get } = await import("./accounts-helpers");
    const html = await (await get("/about")).text();
    expect(html).toContain(`<link rel="stylesheet" href="/styles.css?v=${STYLES_VERSION}"/>`);
  });
});
