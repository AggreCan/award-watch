import type { Env } from "../env";

// The one switch for the whole accounts module. Off (the default in
// wrangler.jsonc, and whenever the database binding is missing): every
// /account route answers the site's 404, no page links to it, the rail shows
// nothing, the sign-in posts count against the page cap like any unknown
// path, and requireApiKey gates nothing. Nothing reads the accounts
// database while it is off; the switch test proves it with a binding that
// throws on any use.
export function accountsEnabled(env: Pick<Env, "ACCOUNTS_ENABLED" | "ACCOUNTS">): boolean {
  return env.ACCOUNTS_ENABLED === "true" && !!env.ACCOUNTS;
}
