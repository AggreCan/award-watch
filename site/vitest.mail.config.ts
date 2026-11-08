import { defineConfig } from "vitest/config";
import { MAIL_SUITE, workersPool } from "./vitest.config";

// The mail suite (docs/mail.md): every message the site sends, rendered in
// English and French under the log sender and checked line by line. Run by
// `npm run test:mail`, apart from the default suite (`npm test`), which
// leaves test-mail/ out. The same Workers pool and bindings as the default
// suite, and the same setup file, so the forms database the accounts-open
// run reads is there.
export default defineConfig({
  plugins: [workersPool()],
  test: {
    include: MAIL_SUITE.include,
    exclude: MAIL_SUITE.exclude,
    setupFiles: ["./test/setup.ts"],
  },
});
