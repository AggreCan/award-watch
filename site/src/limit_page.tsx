// The answer to a request a per-address cap refuses (limits.ts throttle) when
// the request is a browser's navigation, a form post or a page asked for by a
// browser: a page in the site's shell, in the reader's language, with the
// message and a link back to the page the browser came from on this site
// (account/next.ts refererPath), else the account page (the home page while
// the accounts switch is off, when there is none). Its status and
// Retry-After are the refusal's. Nothing is read for it but the stats file
// the top bar's date comes from: no session, no rail counts, no database.
// A request that is not a browser's navigation (a script, a feed reader)
// keeps the plain text answer. The line is the address's, or the account's
// for a paying reader's download past its own cap (limits.ts throttle).

import type { Context } from "hono";
import { html } from "hono/html";
import { refererPath } from "./account/next";
import { accountsEnabled } from "./account/switch";
import { loadStats } from "./data";
import type { AppEnv } from "./env";
import { t } from "./i18n";
import { Layout, PageHead } from "./layout";

export function isNavigation(c: Context<AppEnv>): boolean {
  return c.req.header("sec-fetch-mode") === "navigate" || (c.req.header("accept") ?? "").toLowerCase().includes("text/html");
}

export type RefusalLine = "limits.too_many" | "limits.too_many_account";

export async function refusalPage(c: Context<AppEnv>, status: 429, line: RefusalLine = "limits.too_many"): Promise<Response> {
  const lang = c.get("lang") ?? "en";
  const stats = await loadStats(c.env).catch(() => null);
  const back = refererPath(c.req.header("referer"), c.req.url) ?? (accountsEnabled(c.env) ? "/account" : "/");
  const title = t(lang, "limits.title");
  const body = (
    <Layout lang={lang} title={title} dataAsOf={stats?.data_as_of ?? null}
      seo={{ path: new URL(c.req.url).pathname, description: t(lang, line), noindex: true }}>
      <PageHead lang={lang} title={title} lead={t(lang, line)} />
      <p><a href={back}>{t(lang, "limits.back")}</a></p>
    </Layout>
  );
  return c.html(html`<!doctype html>${body as any}`, status);
}
