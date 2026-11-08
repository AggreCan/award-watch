import { readFileSync, readdirSync, statSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

// The two suites (docs/mail.md). The default one, `npm test`, is every file
// under test/; the mail suite, `npm run test:mail` (vitest.mail.config.ts),
// is every file under test-mail/, and the default suite leaves that folder
// out by its include and again by its exclude. test/mail-suite-apart.test.ts
// reads both from the SUITES binding below and holds them to the files.
export const DEFAULT_SUITE = {
  include: ["test/**/*.test.ts"],
  exclude: [...configDefaults.exclude, "test-mail/**"],
};
export const MAIL_SUITE = {
  include: ["test-mail/**/*.test.ts"],
  exclude: [...configDefaults.exclude],
};

// The files under public/ that the static assets layer serves, the nightly's
// data/ folder left out: each path, its size and its first four bytes, so
// test/landing.test.ts can hold the landing page's stylesheet and fonts to
// what ships.
function publicFiles(dir = "./public", prefix = ""): { path: string; bytes: number; magic: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) return name === "data" && !prefix ? [] : publicFiles(full, `${prefix}${name}/`);
    return [{ path: `${prefix}${name}`, bytes: statSync(full).size, magic: readFileSync(full).subarray(0, 4).toString("latin1") }];
  });
}

// The schema and seed are read here, on the Node side, and handed to the
// Workers runtime as plain text bindings; the setup file applies them to the
// local forms database before the tests run. The stylesheet goes the same
// way, since a CSS import reaches a test empty even with ?raw; the column
// test reads its widths. Both suites run in this pool with these bindings.
export function workersPool() {
  return cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: {
      bindings: {
        SCHEMA_SQL: readFileSync("../pipeline/schema.sql", "utf8"),
        SEED_SQL: readFileSync("./seed/dev_seed.sql", "utf8"),
        STYLES_CSS: readFileSync("./public/styles.css", "utf8"),
        // The landing page's stylesheet and the files public/ ships (test/landing.test.ts).
        LANDING_CSS: readFileSync("./public/landing.css", "utf8"),
        PUBLIC_FILES: JSON.stringify(publicFiles()),
        // The hosted search database's schema; test/search.test.ts applies it.
        SEARCH_SCHEMA_SQL: readFileSync("../pipeline/search_schema.sql", "utf8"),
        // The same-day notices' tables in that database; test/intraday.test.ts applies them.
        INTRADAY_SCHEMA_SQL: readFileSync("../pipeline/intraday_schema.sql", "utf8"),
        // The records database's schema; test/analytics.test.ts applies it.
        RECORDS_SCHEMA_SQL: readFileSync("../pipeline/records_schema.sql", "utf8"),
        // The accounts switch starts off under test whatever wrangler.jsonc
        // ships, so the "switch off" tests hold while the site runs with it
        // on; the "switch on" tests set it themselves (test/accounts-helpers.ts).
        ACCOUNTS_ENABLED: "false",
        // Each suite's include and exclude, for test/mail-suite-apart.test.ts.
        SUITES: JSON.stringify({ default: DEFAULT_SUITE, mail: MAIL_SUITE }),
      },
    },
  });
}

export default defineConfig({
  plugins: [workersPool()],
  test: {
    include: DEFAULT_SUITE.include,
    exclude: DEFAULT_SUITE.exclude,
    setupFiles: ["./test/setup.ts"],
  },
});
