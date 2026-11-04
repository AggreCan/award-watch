import { readFileSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The schema and seed are read here, on the Node side, and handed to the
// Workers runtime as plain text bindings; the setup file applies them to the
// local forms database before the tests run. The stylesheet goes the same
// way, since a CSS import reaches a test empty even with ?raw; the column
// test reads its widths.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          SCHEMA_SQL: readFileSync("../pipeline/schema.sql", "utf8"),
          SEED_SQL: readFileSync("./seed/dev_seed.sql", "utf8"),
          STYLES_CSS: readFileSync("./public/styles.css", "utf8"),
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
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
