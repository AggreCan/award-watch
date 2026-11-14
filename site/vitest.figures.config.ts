import { appendFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { FIGURES_SUITE, workersPool } from "./vitest.config.ts";

// The guides' figures (docs/guides.md, Figures): figures/render.test.ts has
// the Worker render each page a figure is captured from, from the sample
// records in figures/, and writes it to the console, since a test inside
// workerd cannot write a file. Here, on the Node side, each such line goes to
// the file FIGURES_DUMP names instead of the terminal, and
// scripts/make-guide-figures.mjs (`npm run figures`) reads it back. The same
// Workers pool, bindings and setup file as the default suite. The default
// reporter is named: it is the one that hands console lines to
// onConsoleLog, and vitest picks a quieter one when it runs under an agent.
export default defineConfig({
  plugins: [workersPool()],
  test: {
    include: FIGURES_SUITE.include,
    exclude: FIGURES_SUITE.exclude,
    setupFiles: ["./test/setup.ts"],
    reporters: ["default"],
    silent: false,
    onConsoleLog(log) {
      const out = process.env.FIGURES_DUMP;
      if (!out || !log.startsWith("@@FIG ")) return;
      appendFileSync(out, log.endsWith("\n") ? log : `${log}\n`);
      return false;
    },
  },
});
