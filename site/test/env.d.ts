// Bindings as the test runtime sees them. The pool's own type file refers to
// Cloudflare.Env, which wrangler normally generates; declaring it here keeps
// the typecheck self-contained.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SEARCH: D1Database;
    SEARCH_SCHEMA_SQL: string;
    INTRADAY_SCHEMA_SQL: string;
    DATA: R2Bucket;
    ASSETS: Fetcher;
    SCHEMA_SQL: string;
    SEED_SQL: string;
    STYLES_CSS: string;
    LANDING_CSS: string;
    PUBLIC_FILES: string;
  }
}

// Vite's ?raw suffix imports a file's text; the i18n test reads the client
// scripts this way to check the keys they ask for.
declare module "*?raw" {
  const content: string;
  export default content;
}

// Vite's import.meta.glob: the hardening test reads every source file and
// every workflow as text with it, so a reader or a trigger added later is
// covered without a list to keep.
interface ImportMeta {
  glob(pattern: string | string[], options?: { query?: string; import?: string; eager?: boolean }): Record<string, unknown>;
}
