// The analytics builder's views kept on an account (docs/accounts.md,
// Dashboard and Saved views; docs/analytics.md, "The builder"): a view as a
// dashboard's tile, of kind "build" (the view's chart, sorted bars, figures or
// table at the tile's size) or "number" (its latest figure with its change from
// the fiscal year before), and a view saved under a name, of kind "build".
// Ultra's, and only while the builder's switch is on (plan.ts builderOn): with
// it off nothing here is offered, no post of either kind is taken, and a tile
// kept from before reads nothing and says it cannot be read now.
//
// A tile keeps the view's address as its ref, in the builder's one form
// (builder.ts buildAddress), at most OPTS_MAX characters: a post must give that
// form for a view the menus offer, a buyer the buyers' list holds, and for a
// figure a view that gives one a year (figureOffered). Read back, the address
// is read as the page reads one (readBuild) and checked again (buildProblem),
// never trusted as stored: a combination no longer offered says why, a buyer
// no longer listed says the view was removed. Its statements are the page's
// own (builder_sql.ts buildPlan; a figure's through figureChoice), with
// cube_meta first when it reads a cube, and join the dashboard's one records
// batch; it is drawn by the page's own code (pages/builder.tsx buildTileBody,
// figureBody). Each statement names an index and ends in a LIMIT, as the
// builder's tests hold them; a supplier withheld as a person is named by no
// row.
//
// A saved view of kind "build" is the address in the same form, posted to
// /account/views by the builder page's Save this view (view_pages.tsx
// SaveViewRow) and kept through the saved views' own insert (saved_views.ts
// addView: the plan's figure and its group's twin, the same address once).
// Its email is not offered: its row has no select (view_pages.tsx), the post
// that sets one leaves it off (saved_views.ts setViewDelivery) and the
// delivery run never takes it up (view_mail.ts reads a view's address as an
// analytics view's, which a builder's never is).

import type { Context } from "hono";
import {
  BUILD_PATH, type BuildChoice, buildAddress, buildProblem, buildShape, figureChoice, figureOffered, readBuildAddress, usesOrgs,
} from "../builder";
import { CUBE_META_SQL, buildPlan } from "../builder_sql";
import { type BuyerSummary, loadBuyers, loadStats } from "../data";
import type { AppEnv, Env } from "../env";
import { sourceLabel, t, type Key, type Lang } from "../i18n";
import { todayOf } from "../layout";
import { buildLabel, buildTileBody, figureBody, labelNames, namesOf, problemText, subjectsText, viewTitle } from "../pages/builder";
import { allowsBuilder, builderOn } from "../plan";
import { EARLIEST_FY, fiscalLabel, fiscalYearOf, type Query, type Row } from "../records_db";
import { audit } from "./audit";
import { buildFit, buildKey, buildPlot } from "./dashboard_fit";
import { OPTS_MAX } from "./dashboard_rule";
import { addView, cleanName, subjectName } from "./saved_views";
import type { Account } from "./session";

// The two kinds of tile, in the order the dashboard lists its kinds (dashboard.tsx PANEL_KINDS).
export const BUILD_KINDS = ["build", "number"] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];
export const isBuildKind = (v: unknown): v is BuildKind => typeof v === "string" && (BUILD_KINDS as readonly string[]).includes(v);

// Whether this request's reader gets the builder's views: the switch on, and a plan that holds the builder.
export const buildsOn = (env: Env, plan: Account["plan"] | null | undefined): boolean => builderOn(env) && !!plan && allowsBuilder(plan);

// -- a tile's ref, checked as a post gives it --------------------------------------------------------

// The ref a post names, in its stored form: the view's address in its one form, a view the menus offer for a subject
// chosen in full (each buyer one the buyers' list holds, when it can be read), and for a figure a view that gives one
// a fiscal year. current: the data date's fiscal year, which the period is read at. null for anything else.
export function buildRef(kind: BuildKind, raw: unknown, current: number, buyerIds: ReadonlySet<string> | null): string | null {
  const c = readBuildAddress(raw, current, { max: OPTS_MAX, canonical: true });
  if (!c || buildProblem(c, buyerIds) || (kind === "number" && !figureOffered(c))) return null;
  return buildAddress(c);
}

// What a post of either kind reads to check its ref: the data date's fiscal year and the buyers' ids (null when the
// list cannot be read: the ids are then held to their form alone, and a buyer the list no longer holds draws as removed).
export async function buildContext(env: Env): Promise<{ current: number; buyerIds: ReadonlySet<string> | null } | null> {
  const stats = await loadStats(env).catch(() => null);
  if (!stats?.data_as_of) return null;
  const index = await loadBuyers(env).catch(() => null);
  return { current: fiscalYearOf(todayOf(stats.data_as_of)), buyerIds: index ? new Set(index.buyers.map((b) => b.id)) : null };
}

// The year a ref is read at for its shape alone, which the period plays no part in.
const SHAPE_YEAR = EARLIEST_FY + 100;

// A tile's size key (public/dash-grid.js LEAST): its view's shape (dashboard_fit.ts buildKey), and a figure's own.
export function buildSizeKey(kind: BuildKind, ref: string): string {
  if (kind === "number") return "number";
  const c = readBuildAddress(ref, SHAPE_YEAR, { max: OPTS_MAX });
  if (!c) return buildKey("table", 0);
  const s = buildShape(c);
  return buildKey(s.shape, s.panels);
}

// -- a tile read ---------------------------------------------------------------------------------------

// What the dashboard draws of a body once read (dashboard.tsx Body).
type Drawn = { body: unknown; item?: string; meta?: unknown; shown?: number; total?: number; cls?: string };
// A tile resolved: its head, its Open, its reads (dashboard.tsx Job), or none and the line that says why (note).
export type BuildTile = {
  title: string; item: string | null; href: string; note?: Key;
  job: { queries: Query[]; draw: (rows: Row[][] | null) => Drawn | null } | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_KEY: Readonly<Record<BuildKind, Key>> = { build: "dash.kind_build", number: "dash.kind_number" };

// A tile of either kind at its size (w, h): what it reads and how its rows are drawn. on: the builder is this
// reader's now (buildsOn); off, it reads nothing and says it cannot be read now. today: the data date, which the
// period and the contracts ending count from; asOf: the records' own date once the page's batch is read. buyers:
// the buyers' list (dashboard.tsx contextOf reads it once a page that holds such a tile), for the names and the check.
export function buildTile(o: {
  lang: Lang; kind: BuildKind; ref: string; w: number; h: number; on: boolean; today: string; asOf: () => string | null | undefined;
  buyers: readonly BuyerSummary[] | null;
}): BuildTile {
  const { lang, kind } = o;
  const plain = t(lang, KIND_KEY[kind]);
  if (!o.on) return { title: plain, item: null, href: "", job: null, note: "dash.unavailable" };
  const current = fiscalYearOf(o.today);
  const view = readBuildAddress(o.ref, current, { max: OPTS_MAX });
  if (!view) return { title: plain, item: null, href: BUILD_PATH, job: null };
  const href = buildAddress(view);
  // A figure is headed by the view's figure alone ("Median value"), the period's one.
  const title = viewTitle(lang, kind === "number" ? { ...view, rows: "none" } : view);
  const problem = buildProblem(view, o.buyers ? new Set(o.buyers.map((b) => b.id)) : null);
  // A buyer the list no longer holds: what the tile showed is gone.
  if (problem?.kind === "choose" || (kind === "number" && !figureOffered(view))) return { title, item: null, href, job: null };
  if (problem) return { title, item: null, href, job: { queries: [], draw: () => ({ body: <p class="muted">{problemText(lang, view, problem)}</p> }) } };
  const c: BuildChoice = kind === "number" ? figureChoice(view) : view;
  const plan = buildPlan(c, { current, day: o.today });
  const queries: Query[] = plan.cubes ? [{ sql: CUBE_META_SQL, params: [] }, ...plan.queries] : plan.queries;
  const names = { buyer: namesOf(lang, o.buyers ?? []), org: (id: string) => id };
  const shape = buildShape(view);
  const fit = buildFit(shape.shape, o.w, o.h, shape.panels, view.measure === "ending" ? shape.panels : 1);
  return {
    title, href,
    // An organization's name comes with its rows; until then the tile is named by its id.
    item: usesOrgs(view.subject) ? null : subjectsText(lang, view, names),
    job: {
      queries,
      draw: (rows) => {
        if (!rows) return null;
        // A cube the nightly has not filled yet (no cube_meta row) has no figures to show.
        const date = plan.cubes ? rows[0]?.[0]?.as_of : null;
        if (plan.cubes && !(typeof date === "string" && DATE_RE.test(date))) return null;
        const model = plan.read(plan.cubes ? rows.slice(1) : rows);
        const asOf = plan.cubes ? (date as string) : o.asOf() ?? o.today;
        const item = subjectsText(lang, view, labelNames(lang, o.buyers ?? [], model));
        const meta = view.measure === "ending" ? t(lang, "dash.meta_due", { date: asOf })
          : t(lang, "analytics.lead", { source: sourceLabel(lang, c.source), first: fiscalLabel(lang, c.first), last: fiscalLabel(lang, c.last) });
        if (kind === "number") return { item, meta, body: figureBody({ lang, c, model, current }) };
        const drawn = buildTileBody(
          { lang, c, model, current, all: o.buyers ?? [] },
          { rows: fit.rows, plot: fit.plot, width: fit.width, grow: (shown) => buildPlot(shape.shape, shape.panels, fit, shown) },
        );
        return { item, meta, body: drawn.body, shown: drawn.shown, total: drawn.total, cls: "dash-rest dash-stack-540" };
      },
    },
  };
}

// -- a saved view of the builder --------------------------------------------------------------------

// Whether a post to /account/views names a view of the builder rather than an analytics view.
export const isBuildAddress = (raw: unknown): boolean => typeof raw === "string" && raw.startsWith(`${BUILD_PATH}?`);

// Save this view on the builder's page (routes.tsx POST /account/views): Ultra's, while the switch is on, else the
// form is refused; the address in its one form, a view the menus offer for a subject chosen in full, or refused;
// the name typed, or the site's label of the view (pages/builder.tsx buildLabel: the buyers by the list's names, an
// organization by its page's). The saved views' own insert holds the plan's figure; the answer goes back to the view,
// which then reads saved, or full.
export async function saveBuildView(c: Context<AppEnv>, who: Account, fields: Record<string, string>, back: (path: string) => Response): Promise<Response> {
  const lang = c.get("lang");
  if (!buildsOn(c.env, who.plan)) return c.text(t(lang, "form.rejected"), 400);
  const at = await buildContext(c.env);
  if (!at) return c.text(t(lang, "build.unavailable"), 503);
  const address = buildRef("build", fields.address, at.current, at.buyerIds);
  const view = address ? readBuildAddress(address, at.current, { max: OPTS_MAX }) : null;
  if (!address || !view) return c.text(t(lang, "form.rejected"), 400);
  const index = await loadBuyers(c.env).catch(() => null);
  const orgs = new Map<string, string>();
  for (const id of usesOrgs(view.subject) ? view.orgs : []) orgs.set(id, (await subjectName(c.env, lang, "organization", id)) ?? id);
  const name = cleanName(fields.name) || buildLabel(lang, view, { buyer: namesOf(lang, index?.buyers ?? []), org: (id) => orgs.get(id) ?? id });
  const result = await addView(c.env, who, { kind: "build", address, name }, lang);
  if (result === "missing") return c.notFound();
  if (result === "added") await audit(c.env, who.userId, "view_saved", "build");
  return back(address);
}
