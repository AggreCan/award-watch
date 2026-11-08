// The mail suite (site/test-mail/, docs/mail.md) is apart from this one:
// vitest.config.ts takes test/ only and names test-mail/ in its exclude, so
// `npm test` never runs a mail test, and `npm run test:mail` runs them with
// vitest.mail.config.ts. The include and exclude are read from the config
// itself (the SUITES binding it hands the runtime), the files from the two
// folders, and each file is matched the way vitest matches a glob.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import mailConfig from "../vitest.mail.config.ts?raw";

type Suite = { include: string[]; exclude: string[] };
const SUITES = JSON.parse((env as unknown as { SUITES: string }).SUITES) as { default: Suite; mail: Suite };

// Paths from site/, as vitest matches them: "test-mail/messages.test.ts".
// The globs list the files without loading them.
const MAIL_FILES = Object.keys(import.meta.glob("../test-mail/**/*")).map((f) => f.slice("../".length));
const DEFAULT_FILES = Object.keys(import.meta.glob("./**/*.test.ts")).map((f) => `test/${f.slice("./".length)}`);
const WORKFLOWS = import.meta.glob("../../.github/workflows/*.yml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

// A glob as vitest reads one: "**/" any folders or none, "**" anything, "*"
// anything within one folder name.
function globRe(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const matches = (file: string, globs: readonly string[]) => globs.some((g) => globRe(g).test(file));
const inSuite = (file: string, s: Suite) => matches(file, s.include) && !matches(file, s.exclude);

describe("the mail suite", () => {
  it("is left out by the default config: its include takes test/ only and its exclude names test-mail/", () => {
    expect(SUITES.default.include).toEqual(["test/**/*.test.ts"]);
    expect(SUITES.default.exclude).toEqual(["**/node_modules/**", "**/.git/**", "test-mail/**"]);
    expect(SUITES.mail.include).toEqual(["test-mail/**/*.test.ts"]);
    expect(SUITES.mail.exclude).toEqual(["**/node_modules/**", "**/.git/**"]);
    // The matcher reads the globs as vitest does.
    expect(globRe("test/**/*.test.ts").test("test/a.test.ts")).toBe(true);
    expect(globRe("test/**/*.test.ts").test("test/deep/a.test.ts")).toBe(true);
    expect(globRe("test/**/*.test.ts").test("test-mail/a.test.ts")).toBe(false);
    expect(globRe("test-mail/**").test("test-mail/deep/a.test.ts")).toBe(true);
    expect(globRe("**/node_modules/**").test("node_modules/x/a.test.ts")).toBe(true);
  });

  it("holds files the default suite never picks and the mail config picks", () => {
    const tests = MAIL_FILES.filter((f) => f.endsWith(".test.ts"));
    expect(tests.length).toBeGreaterThanOrEqual(2);
    for (const file of MAIL_FILES) {
      expect(inSuite(file, SUITES.default), file).toBe(false);
      // Twice over: the include leaves it out, and the exclude names it.
      expect(matches(file, SUITES.default.include), file).toBe(false);
      expect(matches(file, SUITES.default.exclude), file).toBe(true);
    }
    for (const file of tests) expect(inSuite(file, SUITES.mail), file).toBe(true);
  });

  it("leaves every file of the default suite to the default suite", () => {
    // The glob leaves out the file that holds it.
    expect(DEFAULT_FILES).toContain("test/accounts-mail.test.ts");
    expect(DEFAULT_FILES.length).toBeGreaterThan(70);
    for (const file of DEFAULT_FILES) {
      expect(inSuite(file, SUITES.default), file).toBe(true);
      expect(inSuite(file, SUITES.mail), file).toBe(false);
    }
  });

  it("runs under its own script and config, and no workflow runs either suite", () => {
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts["test:mail"]).toBe("vitest run --config vitest.mail.config.ts");
    expect(mailConfig).toContain("include: MAIL_SUITE.include");
    expect(mailConfig).toContain("exclude: MAIL_SUITE.exclude");
    expect(mailConfig).not.toContain("DEFAULT_SUITE");
    // The suites are local (docs/mail.md); the live check is a workflow of its own that calls the site.
    expect(Object.keys(WORKFLOWS)).toContain("../../.github/workflows/mail-check.yml");
    for (const [file, text] of Object.entries(WORKFLOWS)) {
      expect(text, file).not.toMatch(/\bvitest\b|npm (?:run )?test/);
    }
  });
});
