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
  }
}

// Vite's ?raw suffix imports a file's text; the i18n test reads the client
// scripts this way to check the keys they ask for.
declare module "*?raw" {
  const content: string;
  export default content;
}
