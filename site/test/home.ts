// The app home (src/pages/home.tsx) is what "/" shows a signed-in reader;
// anyone else gets the landing page there (src/pages/landing.tsx rootPage,
// docs/landing.md). The tests of the app home's own content (its tiles,
// lists, map, head and rail) reach it through homeApp: the site's own
// middleware (src/index.tsx siteMiddleware), with "/" answered by homePage
// whatever the session, so they hold the page in both switch states as they
// did when it was the home for everyone. test/landing.test.ts holds the
// choice between the two at "/", through the real app.
import { Hono } from "hono";
import type { AppEnv } from "../src/env";
import { app, siteMiddleware } from "../src/index";
import { homePage } from "../src/pages/home";

export const homeApp = new Hono<AppEnv>();
siteMiddleware(homeApp);
homeApp.get("/", homePage);

// The home's own address, with or without a query ("/?lang=fr").
export const isHomePath = (path: string): boolean => path === "/" || path.startsWith("/?");

// app.request, with the home's address answered by the app home.
export function homeRequest(path: string, init?: RequestInit, env?: object): Response | Promise<Response> {
  return (isHomePath(path) ? homeApp : app).request(path, init, env as never);
}

// -- the landing page's switch-dependent pieces --------------------------------------

// What the accounts switch changes on the landing page (src/pages/landing.tsx),
// one entry a piece, each with what stands in its place: with the switch off
// nothing is Pro and there are no accounts. The switch guards
// (test/accounts-switch.test.ts, test/radar-gate.test.ts) strip these from both
// states and hold the rest of the page byte for byte; with the switch off the
// pieces marked "on only" match nothing.
export const LANDING_SWITCH_PIECES: readonly { what: string; re: RegExp; to: string; onOnly: boolean }[] = [
  { what: "the plan cards", re: /<section class="lp-pricing"[\s\S]*?<\/section>/g, to: "", onOnly: true },
  // The nav's Analytics and Pro links, its sign-in button, and the hero's See Pro plans.
  { what: "the links to Pro, Analytics and the sign-in page", re: /<a class="[^"]*\blp-on\b[^"]*" href="[^"]*">[^<]*<\/a>/g, to: "", onOnly: true },
  // Track tenders free: a free account while accounts exist, the Atom feeds while they do not.
  { what: "Track tenders free's address", re: /href="\/account\/sign-in">/g, to: 'href="/feeds">', onOnly: true },
  { what: "the hero note on accounts and Pro", re: /<span class="lp-note-account">[^<]*<\/span>/g, to: "", onOnly: true },
  { what: "the Pro lines under the feature bands", re: /<p class="lp-pro">[^<]*<\/p>/g, to: "", onOnly: true },
  { what: "the watch sentence", re: /<span class="lp-watch">[^<]*<\/span>/g, to: "", onOnly: true },
  // The profile shot's buttons as the profile draws them: Follow and Analytics, or the browser watchlist's.
  { what: "the profile shot's buttons", re: /(<div class="lp-profile">[\s\S]*?<div class="lp-acts">)[\s\S]*?(<\/div>)/g, to: "$1$2", onOnly: false },
  // The third step: Pro's deliveries, or the Atom feeds and the browser watchlist.
  { what: "the third step's text", re: /<p class="lp-step3">[^<]*<\/p>/g, to: '<p class="lp-step3"></p>', onOnly: false },
  // The footer's Analytics and Pro plan links (layout.tsx FooterRow), as on every page.
  { what: "the footer's Analytics and Pro links", re: /<a href="\/(?:analytics|pro)">[^<]*<\/a>/g, to: "", onOnly: true },
];

export function landingCore(page: string): string {
  return LANDING_SWITCH_PIECES.reduce((s, p) => s.replace(p.re, p.to), page);
}
