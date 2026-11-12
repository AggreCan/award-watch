// Ultra, the plan above Pro, outside the payments (docs/accounts.md, Ultra):
// the third plan in the code (src/account/entitlements.ts) and its tier
// table, read with and without it; whether Ultra is on sale
// (src/account/payments.ts ultraOnSale); every public page and account page
// byte for byte while it is not; the third plan card, the Pro page's section
// and answers, the Product markup, the landing page's card and the Terms
// while it is; an Ultra account granted by hand, which uses its features and
// sees its labels whether or not Ultra is on sale; and the console's grant,
// filters and counts. Payments are in test/accounts-ultra-billing.test.ts.
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_PRO_SQL, PAID_PLANS, PLANS, RULES, allowed, cachedPlanOf, entitlementWrites, isPlan, lastKnownPlan, matchCap, planFor, planFromRows, planRank,
  watchCap,
} from "../src/account/entitlements";
import { ultraOnSale } from "../src/account/payments";
import { keyQuota } from "../src/api_keyed_spec";
import { allKeys, rawEntry, t, type Key } from "../src/i18n";
import { app } from "../src/index";
import { PLAN_LINE_MAX, PLAN_ROWS, ULTRA_GLYPH_PATH, ULTRA_INCLUDES, ULTRA_LINES, planLine, rowFor, ultraLines } from "../src/pro";
import { KEYS_MAX } from "../src/account/api_keys";
import { planYears } from "../src/records_db";
import {
  ACCOUNTS, PRO_SALE, ULTRA_VARS, csrf, decode, grantPro, grantUltra, nbsp, newEmail, nextIp, onEnv, post, signIn, ultraEnv, useAccountsDb, userId,
  withoutTiers,
} from "./accounts-helpers";
import { FILES, makeFakeAssets, testEnv } from "./assets";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const STYLES = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;
// The fixtures with the 6- and 12-month windows written (the 3-month rows), so the radar's deeper windows render their
// tease panel, as test/pro-mark.test.ts writes them.
const DEEP_FILES: Record<string, unknown> = Object.fromEntries((["6m", "12m"] as const).flatMap((w) => [
  [`expiring/${w}/index.json`, { ...(FILES["expiring/3m/index.json"] as object), window: w }],
  [`expiring/${w}/1.json`, FILES["expiring/3m/1.json"]],
]));
const payEnv = (extra: Record<string, unknown> = {}) => onEnv({ ASSETS: makeFakeAssets({}, DEEP_FILES), ...PRO_SALE, ...extra });
const saleEnv = (extra: Record<string, unknown> = {}) => ultraEnv({ ASSETS: makeFakeAssets({}, DEEP_FILES), ...extra });

afterEach(() => {
  vi.restoreAllMocks();
});

// A page as a reader without the app home's special case gets it (the landing page at "/").
const request = (path: string, env: object, cookie?: string) => {
  const headers: Record<string, string> = { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() };
  if (cookie) headers.cookie = cookie;
  return app.request(path, { headers }, env);
};
const page = async (path: string, env: object, cookie?: string) => {
  const res = await request(path, env, cookie);
  return { status: res.status, cache: res.headers.get("cache-control"), body: await res.text() };
};
const text = (s: string) => nbsp(decode(s)).replace(/’/g, "'");

// =====================================================================================

describe("the plans in the code", () => {
  it("are three, in rank order, the cache holding Ultra as pro", () => {
    expect(PLANS).toEqual(["free", "pro", "ultra"]);
    expect(PAID_PLANS).toEqual(["pro", "ultra"]);
    expect(PLANS.map(planRank)).toEqual([0, 1, 2]);
    expect(PLANS.map(cachedPlanOf)).toEqual(["free", "pro", "pro"]);
    for (const p of PLANS) expect(isPlan(p)).toBe(true);
    for (const v of ["", "ULTRA", "gold", null, undefined, 1]) expect(isPlan(v)).toBe(false);
  });

  it("give Ultra every Pro feature, and each counted figure at or above Pro's", () => {
    for (const [feature, pro] of Object.entries(RULES.pro) as [keyof typeof RULES.pro, number | boolean][]) {
      const ultra = RULES.ultra[feature];
      if (typeof pro === "number") expect(ultra as number, feature).toBeGreaterThanOrEqual(pro);
      else if (pro) expect(ultra, feature).toBe(true);
      // Every gate asks for a feature, never a plan: what opens for Pro opens for Ultra.
      if (allowed({ plan: "pro" }, feature)) expect(allowed({ plan: "ultra" }, feature), feature).toBe(true);
    }
    expect(matchCap("ultra")).toBeGreaterThanOrEqual(matchCap("pro"));
    expect(watchCap("ultra")).toBeGreaterThanOrEqual(watchCap("pro"));
    expect(keyQuota("ultra")).not.toBeNull();
    expect(keyQuota("ultra")!.perDay).toBeGreaterThanOrEqual(keyQuota("pro")!.perDay);
  });

  it("let the newest live row decide, an Ultra row as any other", () => {
    const now = new Date("2026-11-12T12:00:00.000Z");
    const row = (id: string, plan: string, created: string, ends: string | null = null) =>
      ({ id, plan, starts_at: "2026-11-01T00:00:00.000Z", ends_at: ends, created_at: created, revoked_at: null });
    expect(planFromRows([row("a", "pro", "2026-11-01T00:00:00.000Z"), row("b", "ultra", "2026-11-02T00:00:00.000Z")], now)).toEqual({ plan: "ultra", until: null });
    expect(planFromRows([row("a", "ultra", "2026-11-01T00:00:00.000Z"), row("b", "pro", "2026-11-02T00:00:00.000Z")], now)).toEqual({ plan: "pro", until: null });
    // An Ultra row that has ended leaves the Pro row before it.
    expect(planFromRows([row("a", "pro", "2026-11-01T00:00:00.000Z"), row("b", "ultra", "2026-11-02T00:00:00.000Z", "2026-11-10T00:00:00.000Z")], now))
      .toEqual({ plan: "pro", until: null });
    // The cache of an Ultra account says pro, and answers Pro through an outage.
    expect(lastKnownPlan({ id: "x", plan: "pro", plan_until: null }, now)).toEqual({ plan: "pro", until: null });
  });

  it("read the tier beside the row: Ultra, the cache written as pro once and not again", async () => {
    const email = newEmail("ultra-plan");
    await signIn(email);
    await grantUltra(email);
    const id = await userId(email);
    const holder = { id, plan: "free", plan_until: null };
    expect(await planFor(onEnv() as never, holder)).toEqual({ plan: "ultra", until: null, source: "entitlements" });
    expect(await ACCOUNTS.prepare("SELECT plan FROM users WHERE id = ?").bind(id).first()).toEqual({ plan: "pro" });
    // With the cache at pro, the next read writes nothing.
    const statements: string[] = [];
    const watched = new Proxy(ACCOUNTS, {
      get(target, prop) {
        if (prop === "prepare") return (sql: string) => (statements.push(sql), target.prepare(sql));
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    expect((await planFor(onEnv({ ACCOUNTS: watched }) as never, { id, plan: "pro", plan_until: null })).plan).toBe("ultra");
    expect(statements.some((s) => s.startsWith("UPDATE users"))).toBe(false);
    // The same-day gate and the daily check count it as a live paid plan.
    const at = new Date().toISOString();
    const before = (await ACCOUNTS.prepare(LIVE_PRO_SQL).bind(at).first<{ n: number }>())!.n;
    const other = newEmail("ultra-live");
    await signIn(other);
    await grantUltra(other);
    expect((await ACCOUNTS.prepare(LIVE_PRO_SQL).bind(new Date().toISOString()).first<{ n: number }>())!.n).toBe(before + 1);
  });

  it("read an Ultra row as Pro while the tier table is missing, saying so in one log line, and write no bare Pro row for Ultra", async () => {
    const email = newEmail("ultra-no-table");
    await signIn(email);
    await grantUltra(email);
    const id = await userId(email);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await withoutTiers(async () => {
      for (let i = 0; i < 2; i++) expect((await planFor(onEnv() as never, { id, plan: "pro", plan_until: null })).plan).toBe("pro");
      const lines = error.mock.calls.map((c) => String(c[0]));
      expect(lines.filter((l) => l.includes("entitlement_tiers missing"))).toHaveLength(1);
      expect(lines.every((l) => !l.includes("@"))).toBe(true);
      // An Ultra grant's batch fails whole: no entitlements row without its tier.
      const count = async () => (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?").bind(id).first<{ n: number }>())!.n;
      const n = await count();
      const at = new Date().toISOString();
      await expect(ACCOUNTS.batch(entitlementWrites(ACCOUNTS, {
        id: "f".repeat(32), userId: id, plan: "ultra", source: "manual", startsAt: at, endsAt: null, reference: "test", createdAt: at,
      }))).rejects.toThrow(/entitlement_tiers/);
      expect(await count()).toBe(n);
    });
    expect((await planFor(onEnv() as never, { id, plan: "pro", plan_until: null })).plan).toBe("ultra");
  });
});

describe("whether Ultra is on sale", () => {
  it("needs the switch, the payment source, all five variables in form and the tier table", async () => {
    expect(await ultraOnSale(saleEnv() as never)).toBe(true);
    expect(await ultraOnSale(payEnv() as never)).toBe(false);
    expect(await ultraOnSale({ ...saleEnv(), ACCOUNTS_ENABLED: "false" } as never)).toBe(false);
    expect(await ultraOnSale(onEnv(ULTRA_VARS) as never)).toBe(false);
    for (const [name, bad] of [
      ["STRIPE_PRODUCT_ULTRA", "product_1"], ["STRIPE_PRICE_ULTRA_MONTHLY", ""], ["STRIPE_PRICE_ULTRA_YEARLY", "prod_x"],
      ["PRICE_ULTRA_MONTHLY_CAD", "30.5"], ["PRICE_ULTRA_YEARLY_CAD", "three hundred"],
    ]) expect(await ultraOnSale(saleEnv({ [name]: bad }) as never), name).toBe(false);
    await withoutTiers(async () => expect(await ultraOnSale(saleEnv() as never)).toBe(false));
    expect(await ultraOnSale(saleEnv() as never)).toBe(true);
  });

  it("reads nothing of the accounts database while the variables are not set", async () => {
    const used: string[] = [];
    const trap = new Proxy({}, { get(_t, prop) { used.push(String(prop)); throw new Error("read"); } }) as D1Database;
    expect(await ultraOnSale(payEnv({ ACCOUNTS: trap }) as never)).toBe(false);
    expect(used).toEqual([]);
  });
});

// -- while Ultra is off sale -----------------------------------------------------------

const PUBLIC = [
  "/", "/?lang=fr", "/pro", "/pro?lang=fr", "/terms", "/terms?lang=fr", "/tenders/same-day", "/tenders/same-day?lang=fr", "/expiring/6m",
  "/expiring/12m?lang=fr", "/privacy", "/tenders", "/organizations/org-a000000001",
];

describe("while Ultra is off sale", () => {
  it("leaves every public page byte for byte as it is without Ultra's variables, signed out and signed in as Free or Pro", async () => {
    const free = newEmail("off-free");
    const freeCookie = await signIn(free, { env: payEnv() });
    const pro = newEmail("off-pro");
    const proCookie = await signIn(pro, { env: payEnv() });
    await grantPro(pro);
    const malformed = saleEnv({ STRIPE_PRODUCT_ULTRA: "nope" });
    for (const cookie of [undefined, freeCookie, proCookie]) {
      for (const path of PUBLIC) {
        const plain = await page(path, payEnv(), cookie);
        expect(await page(path, malformed, cookie), path).toEqual(plain);
        await withoutTiers(async () => expect(await page(path, saleEnv(), cookie), path).toEqual(plain));
        expect(plain.body, path).not.toContain("ultra-tag\"><svg viewBox=\"0 0 16 16\" width=\"12\"");
        expect(plain.body, path).not.toContain("plan-card-ultra");
      }
    }
  });

  it("leaves every account page byte for byte too, for Free and Pro accounts", async () => {
    const free = newEmail("off-acct-free");
    const freeCookie = await signIn(free, { env: payEnv() });
    const pro = newEmail("off-acct-pro");
    const proCookie = await signIn(pro, { env: payEnv() });
    await grantPro(pro);
    const PAGES = ["/account", "/account/billing", "/account/billing?plan=ultra", "/account/searches", "/account/watches", "/account/keys", "/account/matches"];
    for (const cookie of [freeCookie, proCookie]) {
      for (const path of PAGES) {
        const plain = await page(path, payEnv(), cookie);
        await withoutTiers(async () => expect(await page(path, saleEnv(), cookie), path).toEqual(plain));
      }
    }
  });

  it("with the switch off changes nothing, Ultra's variables or not, and reads no accounts database", async () => {
    const used: string[] = [];
    const trap = new Proxy({}, { get(_t, prop) { used.push(String(prop)); throw new Error("read"); } }) as D1Database;
    const off = { ...testEnv(), ...PRO_SALE, ACCOUNTS: trap };
    for (const path of ["/", "/terms", "/pro", "/tenders/same-day", "/expiring/6m", "/privacy"]) {
      expect(await page(path, { ...off, ...ULTRA_VARS }), path).toEqual(await page(path, off));
    }
    expect(used).toEqual([]);
  });
});

// -- while Ultra is on sale ------------------------------------------------------------

const cardsOf = (html: string): string[] => {
  const at = html.indexOf('<div class="plan-cards"');
  return html.slice(at, html.indexOf("</section>", at)).split(/(?=<div class="plan-card[ "])/).slice(1);
};
const rowsOf = (card: string) => [...card.matchAll(/<li( class="plan-lacks")?>([\s\S]*?)<\/li>/g)].map((m) => ({
  lacks: !!m[1], text: m[2].replace(/<span class="visually-hidden">[^<]*<\/span>/, "").replace(/<[^>]+>/g, ""),
}));

describe("the plan cards while Ultra is on sale", () => {
  it("are three, aligned, every row in every card, Ultra framed in sapphire with its chip in the head only", async () => {
    for (const lang of ["en", "fr"] as const) {
      // The tease panels (the same-day page's and the radar's deeper windows') and the Pro page.
      for (const path of ["/tenders/same-day", "/expiring/6m", "/expiring/12m", "/pro"]) {
        const html = text((await page(`${path}?lang=${lang}`, saleEnv())).body);
        const cards = cardsOf(html);
        expect(cards, `${lang} ${path}`).toHaveLength(3);
        for (const card of cards) {
          const list = /<ul class="plan-list">[\s\S]*?<\/ul>/.exec(card)?.[0] ?? "";
          expect(list.match(/<li[ >]/g), `${lang} ${path}`).toHaveLength(PLAN_ROWS.length);
        }
        const ultra = cards[2];
        expect(ultra).toMatch(/^<div class="plan-card plan-card-ultra"><div class="plan-card-head"><h3>Ultra<\/h3><span class="ultra-tag"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">/);
        expect(ultra).toContain(`<path d="${ULTRA_GLYPH_PATH}"></path>`);
        PLAN_ROWS.forEach((row, i) => expect(rowsOf(ultra)[i], `${lang} ${path} ${i}`).toEqual({ lacks: false, text: text(planLine(lang, row.ultra)) }));
        // The chip in the card's head, and in the rail's Dashboard item (src/layout.tsx), and nowhere else on the page.
        expect(html.match(/class="ultra-tag"/g), path).toHaveLength(2);
        expect(html).toMatch(/<a class="rail-item" href="\/account\/dashboard"><span class="rail-label">[^<]+<\/span><span class="ultra-tag">/);
        expect(html).not.toContain(EM_DASH);
        expect(html).not.toContain(EN_DASH);
      }
    }
  });

  it("state Ultra's own figure on every counted row, at or above Pro's, its lines within PLAN_LINE_MAX and never comparing", () => {
    for (const row of PLAN_ROWS) {
      const ultra = RULES.ultra[row.feature];
      const pro = RULES.pro[row.feature];
      if (typeof pro === "number") expect(ultra as number, row.ultra.key).toBeGreaterThanOrEqual(pro);
      else expect(ultra, row.ultra.key).toBe(true);
      expect(rowFor(row, "ultra")).toEqual({ wording: row.ultra, has: true });
      for (const lang of ["en", "fr"] as const) expect(planLine(lang, row.ultra).length, `${lang} ${row.ultra.key}`).toBeLessThanOrEqual(PLAN_LINE_MAX);
    }
    expect(ULTRA_INCLUDES.map(([f]) => f)).toEqual(PLAN_ROWS.map((r) => r.feature));
    for (const lang of ["en", "fr"] as const) {
      for (const key of ["plans.ultra_for", "plans.ultra_subscribe", "plans.move_ultra", "plans.move_pro"] as Key[]) {
        expect(t(lang, key).length, `${lang} ${key}`).toBeLessThanOrEqual(PLAN_LINE_MAX);
      }
    }
    expect(ultraLines("en")).toEqual([
      `${RULES.ultra.saved_searches} saved searches, by email`, `${RULES.ultra.watchlists} watches, each change by email`,
      `Analytics: every view, ${planYears("ultra")} fiscal years`, `API: ${KEYS_MAX} keys of ${keyQuota("ultra")!.perDay.toLocaleString("en-CA")} requests a day`,
      `${RULES.ultra.matches} matching notices for your organization`, `A dashboard of up to ${RULES.ultra.dashboard} panels`,
    ]);
    expect(ULTRA_LINES).toHaveLength(6);
  });

  it("lead a reader without a session to the sign-in page and on to Ultra's panel, a Free reader to its billing page", async () => {
    const out = cardsOf(text((await page("/pro", saleEnv())).body))[2];
    expect(out).toContain('<a href="/account/sign-in?next=%2Faccount%2Fbilling%3Fplan%3Dultra" class="btn">Subscribe to Ultra</a>');
    expect(out).toContain("<strong class=\"plan-amount\">CA$30</strong> a month or CA$301.50 a year");
    const cookie = await signIn(newEmail("sale-free"), { env: saleEnv() });
    const free = cardsOf(text((await page("/tenders/same-day", saleEnv(), cookie)).body))[2];
    expect(free).toContain('<a href="/account/billing?plan=ultra#subscribe" class="btn">Subscribe to Ultra</a>');
  });
});

describe("the Pro page while Ultra is on sale", () => {
  it("adds the section on Ultra after Who It Is For, the answer on moving, the refund's answer for both plans, and Ultra's Product", async () => {
    const html = text((await page("/pro", saleEnv())).body);
    const who = html.indexOf('<h2 id="who">');
    const ultra = html.indexOf('<h2 id="ultra">Ultra</h2>');
    expect(who).toBeGreaterThan(0);
    expect(ultra).toBeGreaterThan(who);
    expect(ultra).toBeLessThan(html.indexOf('<h2 id="free">'));
    const days = keyQuota("ultra")!.perDay.toLocaleString("en-CA");
    expect(html).toContain(`<p>Ultra includes everything in Pro, with these figures: ${RULES.ultra.saved_searches} saved searches by email, ${RULES.ultra.watchlists} watches, ${planYears("ultra")} fiscal years of analytics, API keys of ${days} requests a day each, and a dashboard of up to ${RULES.ultra.dashboard} panels you choose.</p>`);
    expect(html).toContain("<p>For people who follow a whole market: many buyers, segments and competitors at once.</p>");
    expect(html).toContain('<p class="pro-price">Ultra is CA$30 a month or CA$301.50 a year, taxes added at checkout.</p>');
    expect(html).toContain("<h3>Can I move from Pro to Ultra, or back?</h3>");
    expect(html).toContain("Yes, of your account's first payment, for Pro or Ultra:");
    expect(html).not.toContain("Yes, of your first payment: press");
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const products = ld.flat().filter((o) => o["@type"] === "Product");
    expect(products.map((p) => p.name)).toEqual(["Award Watch Pro", "Award Watch Ultra"]);
    expect(products[1].offers.map((o: { price: string }) => o.price)).toEqual(["30", "301.50"]);
    const faq = ld.flat().find((o) => o["@type"] === "FAQPage");
    expect(faq.mainEntity.map((q: { name: string }) => q.name)).toContain("Can I move from Pro to Ultra, or back?");
    const fr = text((await page("/pro?lang=fr", saleEnv())).body);
    expect(fr).toContain("Ultra coûte 30 $ CA par mois ou 301,50 $ CA par année, taxes ajoutées au paiement.");
    expect(fr).toContain("<h3>Puis-je passer de Pro à Ultra, ou revenir à Pro?</h3>");
    for (const p of [html, fr]) {
      expect(p).not.toContain(EM_DASH);
      expect(p).not.toContain(EN_DASH);
    }
  });

  it("makes Move to Ultra the page's filled button for a Pro reader", async () => {
    const email = newEmail("sale-pro-page");
    const cookie = await signIn(email, { env: saleEnv() });
    await grantPro(email);
    const html = text((await page("/pro", saleEnv(), cookie)).body);
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main.match(/class="btn btn-primary"/g)).toHaveLength(1);
    expect(cardsOf(html)[2]).toContain('<a href="/account/billing?plan=ultra#move" class="btn btn-primary">Move to Ultra</a>');
  });
});

describe("the landing page's Ultra card", () => {
  const section = (html: string) => /<section class="lp-pricing"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

  it("is the waitlist while Ultra is off sale, and the price, Ultra's own figures and Subscribe while it is on sale, without the form", async () => {
    const off = section(await (await request("/", payEnv())).text());
    expect(off).toContain('<span class="lp-soon-tag">Coming soon</span>');
    expect(off).toContain('name="kind" value="ultra"');
    for (const lang of ["en", "fr"] as const) {
      const on = text(section(await (await request(lang === "fr" ? "/?lang=fr" : "/", saleEnv())).text()));
      const card = /<div class="lp-plan lp-plan-ultra" id="ultra">[\s\S]*?<\/p><\/div>/.exec(on)?.[0] ?? "";
      expect(card, lang).not.toContain("lp-soon-tag");
      expect(card, lang).not.toContain("<form");
      expect(on, lang).not.toContain('name="kind" value="ultra"');
      const figure = lang === "fr" ? "30 $ CA" : "CA$30";
      const yearly = lang === "fr" ? "301,50 $ CA" : "CA$301.50";
      expect(card, lang).toContain(`<p class="lp-pr">${figure}<small>${text(t(lang, "landing.price_rest", { yearly }))}</small></p>`);
      expect(card, lang).toContain(`<p class="lp-for">${text(t(lang, "plans.ultra_for"))}</p>`);
      const rows = [...card.matchAll(/<li><svg[^>]*><path[^>]*><\/path><\/svg><span>([^<]*)<\/span><\/li>/g)].map((m) => m[1]);
      expect(rows, lang).toEqual([text(t(lang, "landing.everything_pro")), ...ultraLines(lang).map(text)]);
      expect(card, lang).toContain(`<a class="lp-btn" href="/account/sign-in?next=%2Faccount%2Fbilling%3Fplan%3Dultra">${text(t(lang, "plans.ultra_subscribe"))}</a>`);
      expect(on.match(/class="lp-btn lp-btn-fill"/g)?.length ?? 0, lang).toBe(1);
    }
  });
});

describe("the Terms", () => {
  it("cover the paid plans, Pro and Ultra, with Moving Between Plans, from the day Ultra is on sale, and the Pro terms before", async () => {
    const before = text((await page("/terms", payEnv())).body);
    expect(before).toContain("Paid Plan (Pro)");
    expect(before).not.toContain("Ultra");
    const after = text((await page("/terms", saleEnv())).body);
    expect(after).toContain('<h2 id="pro">Paid Plans (Pro and Ultra)</h2>');
    expect(after).toContain("These terms apply to the paid plans, Pro and Ultra, in addition to the terms above.");
    expect(after).toContain("<h3>What the Paid Plans Include</h3>");
    const order = ["Term and Renewal", "Moving Between Plans", "Cancellation", "Refund of the First Payment"].map((h) => after.indexOf(`<h3>${h}</h3>`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(after).toContain("A payment for moving from Pro to Ultra is not a first payment");
    expect(after).toContain("If Allwater ends a paid plan for any other reason, it refunds the unused part of the current period.");
    const fr = text((await page("/terms?lang=fr", saleEnv())).body);
    expect(fr).toContain("Forfaits payants (Pro et Ultra)");
    expect(fr).toContain("<h3>Passer d'un forfait à l'autre</h3>");
    for (const p of [after, fr]) expect(p).not.toContain(EM_DASH);
  });
});

// -- an Ultra account granted by hand -----------------------------------------------------

describe("an Ultra account granted by hand", () => {
  it("sees its own labels and uses Pro's features whether or not Ultra is on sale", async () => {
    const email = newEmail("hand-ultra");
    const cookie = await signIn(email, { env: payEnv() });
    await grantUltra(email);
    for (const env of [payEnv(), saleEnv()]) {
      const overview = text((await page("/account", env, cookie)).body);
      expect(overview).toContain('<span class="brand-plan brand-plan-ultra">ultra</span>');
      expect(overview).toContain("<dd>Ultra, no end date</dd>");
      // The same-day notices, a Pro feature, are open to it: no tease panel.
      const sameDay = (await page("/tenders/same-day", env, cookie)).body;
      expect(sameDay).not.toContain("pro-panel");
    }
    const fr = text((await page("/account?lang=fr", payEnv(), cookie)).body);
    expect(fr).toContain('<span class="brand-plan brand-plan-ultra">ultra</span>');
    expect(fr).toContain("<dd>Ultra, sans date de fin</dd>");
    // Off sale it sees two cards, neither marked as its own, and no way to buy either.
    const billing = text((await page("/account/billing", payEnv(), cookie)).body);
    const cards = cardsOf(billing);
    expect(cards).toHaveLength(2);
    expect(billing).not.toContain("plan-current");
    expect(cards[1]).not.toContain("#subscribe");
    // On sale, Ultra's card is its own.
    const sale = cardsOf(text((await page("/account/billing", saleEnv(), cookie)).body));
    expect(sale[2]).toContain('<span class="plan-current">Your plan</span>');
    // The sapphire subscript, in the bar's own lifted tone.
    expect(STYLES).toMatch(/\.brand-plan-ultra \{ color: var\(--ultra\); \}/);
    expect(STYLES).toMatch(/\.topbar \{[^}]*--ultra: var\(--bar-ultra\);/);
  });

  it("is not offered the email alerts' line, which offers a plan with delivery", async () => {
    const email = newEmail("hand-ultra-alerts");
    const cookie = await signIn(email, { env: payEnv() });
    const freePage = (await page("/segments/82", payEnv(), cookie)).body;
    expect(freePage).toContain('<p class="interest-pro">');
    await grantUltra(email);
    const ultraPage = (await page("/segments/82", payEnv(), cookie)).body;
    expect(ultraPage).toContain('<section class="panel interest">');
    expect(ultraPage).not.toContain('<p class="interest-pro">');
  });
});

// -- the stylesheet ------------------------------------------------------------------------

describe("the sapphire", () => {
  it("is defined for both themes and used by the Ultra chip, card and subscript alone", () => {
    expect(STYLES).toMatch(/:root \{[^}]*--ultra: #0f52ba;[^}]*--ultra-soft: #e3ebf9;/);
    expect(STYLES).toMatch(/:root\[data-theme="dark"\] \{[^}]*--ultra: #7eb0ff;[^}]*--ultra-soft: #13223d;/);
    expect(STYLES).toMatch(/:root:not\(\[data-theme="light"\]\) \{[^}]*--ultra: #7eb0ff;[^}]*--ultra-soft: #13223d;/);
    const css = STYLES.replace(/\/\*[\s\S]*?\*\//g, "");
    const users = [...css.matchAll(/([^{}]+)\{([^{}]*var\(--ultra(?:-soft)?\)[^{}]*)\}/g)].map((m) => m[1].trim());
    expect(users.length).toBeGreaterThan(0);
    for (const selector of users) expect(selector, selector).toMatch(/ultra|topbar/);
    // The charts keep the emerald.
    expect(css).not.toMatch(/--chart-[a-z-]+:\s*var\(--ultra/);
  });
});

// -- the console ---------------------------------------------------------------------------

describe("the console", () => {
  async function operator() {
    const email = newEmail("ultra-op");
    const env = payEnv({ OPERATOR_EMAILS: email });
    const cookie = await signIn(email, { env });
    return { cookie, env, csrf: await csrf(cookie, "/account", { env }) };
  }

  it("grants Ultra by hand with its tier row, revokes it, filters and counts it, and refuses it without the table", async () => {
    const op = await operator();
    const email = newEmail("console-ultra");
    await signIn(email, { env: op.env });
    const id = await userId(email);
    const form = await text((await page(`/admin/users/${id}`, op.env, op.cookie)).body);
    expect(form).toContain('<select name="plan"><option value="pro" selected="">Pro</option><option value="ultra">Ultra</option></select>');
    const grant = await post(`/admin/users/${id}/grant`, { csrf: op.csrf, plan: "ultra", until: "", reference: "trial" }, { cookie: op.cookie, env: op.env });
    expect(grant.status).toBe(303);
    expect(grant.headers.get("location")).toContain("m=granted_ultra");
    const row = await ACCOUNTS.prepare(
      "SELECT e.id, e.plan, t.tier FROM entitlements e LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id WHERE e.user_id = ?",
    ).bind(id).first<{ id: string; plan: string; tier: string }>();
    expect(row).toMatchObject({ plan: "pro", tier: "ultra" });
    const user = text((await page(`/admin/users/${id}?m=granted_ultra`, op.env, op.cookie)).body);
    expect(user).toContain("Ultra granted.");
    expect(user).toContain("<dd>Ultra, no end date</dd>");
    expect(user).toMatch(/<td data-label="Plan">ultra<\/td>/);
    // The accounts table's filter and the overview's counts.
    const filtered = text((await page(`/admin/accounts?q=${encodeURIComponent(email)}&plan=ultra`, op.env, op.cookie)).body);
    expect(filtered).toContain('<option value="ultra" selected="">Ultra now</option>');
    expect(filtered).toContain(email);
    expect(text((await page(`/admin/accounts?q=${encodeURIComponent(email)}&plan=pro`, op.env, op.cookie)).body)).not.toContain(`>${email}<`);
    const overview = text((await page("/admin", op.env, op.cookie)).body);
    expect(overview).toMatch(/<dt>On Ultra now, granted by hand<\/dt><dd>[1-9][0-9]*<\/dd>/);
    expect(overview).toContain("<dt>On Ultra now, paid through Stripe</dt>");
    // Revoked, the account is Free again.
    const revoke = await post(`/admin/users/${id}/entitlements/${row!.id}/revoke`, { csrf: op.csrf }, { cookie: op.cookie, env: op.env });
    expect(revoke.status).toBe(303);
    expect((await planFor(onEnv() as never, { id, plan: "pro", plan_until: null })).plan).toBe("free");
    // Without the table: the line naming the file, and nothing written; Pro still grants.
    await withoutTiers(async () => {
      const refused = await post(`/admin/users/${id}/grant`, { csrf: op.csrf, plan: "ultra", until: "", reference: "trial" }, { cookie: op.cookie, env: op.env });
      expect(refused.status).toBe(400);
      expect(text(await refused.text())).toContain("The Ultra table is not on the database yet: apply accounts_schema.sql.");
      expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?").bind(id).first<{ n: number }>())!.n).toBe(1);
      // The console's pages still read: Ultra rows as Pro, no Ultra counts.
      expect((await page(`/admin/users/${id}`, op.env, op.cookie)).status).toBe(200);
      expect((await page("/admin/accounts?plan=ultra", op.env, op.cookie)).status).toBe(200);
      expect(text((await page("/admin", op.env, op.cookie)).body)).not.toContain("On Ultra now");
      const pro = await post(`/admin/users/${id}/grant`, { csrf: op.csrf, plan: "pro", until: "", reference: "trial" }, { cookie: op.cookie, env: op.env });
      expect(pro.status).toBe(303);
    });
    // A plan the form does not offer is refused.
    expect((await post(`/admin/users/${id}/grant`, { csrf: op.csrf, plan: "gold", until: "", reference: "trial" }, { cookie: op.cookie, env: op.env })).status).toBe(400);
  });
});

// -- the words -----------------------------------------------------------------------------

describe("Ultra's strings", () => {
  const KEYS = allKeys().filter((k) =>
    k.startsWith("ultra.") || /ultra/.test(k) || ["billing.other_plan", "billing.panel_plans", "billing.panel_move", "billing.move_text",
      "billing.move_down_text", "billing.move_sent", "admin.grant_plan", "propage.q_move", "propage.a_move", "terms.pro_change", "terms.pro_change_title",
      "plans.move_pro"].includes(k));

  it("are in both languages, with no dash, straight apostrophes in the source, and no comparison on a plan line", () => {
    expect(KEYS.length).toBeGreaterThan(30);
    for (const key of KEYS) {
      const { en, fr } = rawEntry(key);
      for (const s of [en, fr]) {
        expect(s, key).not.toContain(EM_DASH);
        expect(s, key).not.toContain(EN_DASH);
        expect(s, key).not.toContain("’");
      }
    }
    const COMPARATIVE = /\b(more|higher|above|unlimited|plus|davantage|supérieure?s?|au-dessus|illimitée?s?)\b/i;
    // "au plus" is French for "at most", Ultra's own bound on its dashboard (propage.ultra_text, plans.dashboard), not a comparison.
    for (const key of KEYS.filter((k) => k.startsWith("plans.") || k.startsWith("propage.ultra"))) {
      expect((rawEntry(key).en + " " + rawEntry(key).fr).replace(/\bau plus\b/g, ""), key).not.toMatch(COMPARATIVE);
    }
    // No price figure is written into a string.
    for (const key of KEYS) expect(rawEntry(key).en + rawEntry(key).fr, key).not.toMatch(/\$\s?[0-9]|[0-9]\s?\$/);
  });
});
