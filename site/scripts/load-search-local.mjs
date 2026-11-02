// Loads the local search database (wrangler's local D1 `awardwatch-search`,
// which `wrangler dev` serves as SEARCH) from the batches the pipeline's sync
// wrote, so /search answers in local development. Write them first, as a full
// reload from the local database:
//
//   cd pipeline && python -m awardwatch_pipeline search-sync --full --db ../data/awardwatch.sqlite
//
// then `npm run search:local` here. The first batch of a full reload drops
// and recreates the tables, so this can run again at any time. Nothing here
// touches the remote database: every command carries --local.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../../data/out/search/", import.meta.url));
const manifestPath = `${out}manifest.json`;
if (!existsSync(manifestPath)) {
  console.error("No data/out/search/manifest.json. Run the pipeline's search-sync first (see this file's head).");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!manifest.full) {
  console.error("The manifest is not a full reload; run search-sync with --full for a local load.");
  process.exit(1);
}

// The pinned Wrangler, run by this Node without a shell, so no argument is
// ever read by one.
const wranglerJs = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const wrangler = (...args) => {
  const res = spawnSync(process.execPath, [wranglerJs, "d1", "execute", "awardwatch-search", "--local", ...args], {
    stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error(res.stdout);
    process.exit(res.status ?? 1);
  }
  return res.stdout;
};

wrangler("--file=../pipeline/search_schema.sql");
for (const batch of manifest.batches) {
  console.log(`applying ${batch}`);
  wrangler(`--file=${out}${batch}`);
}
const answer = wrangler("--json", "--command=SELECT (SELECT COUNT(*) FROM search_orgs) AS orgs, (SELECT COUNT(*) FROM search_buyers) AS buyers");
const counts = JSON.parse(answer.slice(answer.indexOf("[")))[0].results[0];
const expected = manifest.expected;
console.log(`search_orgs ${counts.orgs} (expected ${expected.search_orgs}), search_buyers ${counts.buyers} (expected ${expected.search_buyers})`);
process.exit(counts.orgs === expected.search_orgs && counts.buyers === expected.search_buyers ? 0 : 1);
