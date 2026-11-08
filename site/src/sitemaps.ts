// The sitemaps: the index and the parts the pipeline writes under
// data/sitemaps/ (export_static.write_sitemaps), and the parts of the
// published contracts, which the Worker reads from the records database
// because 1.3 million pages are too many files for the static export.
// Everything is served from the site root (/sitemap.xml, /sitemap-<n>.xml,
// /sitemap-contracts-<n>.xml) because a sitemap may only list URLs at or
// below its own directory. docs/seo.md describes the scheme.
//
// Languages: the pipeline lists each page once, by its English address. The
// Worker owns the addressing (canonicalUrl in seo.ts: the plain address is
// the English page, ?lang=fr the French one), so it writes each entry twice,
// English then French, each carrying the alternates of both and x-default
// (xhtml:link, the sitemap form of hreflang, as Google reads it).

import type { Context } from "hono";
import { BUYER_ID_RE, assetResponse } from "./data";
import type { AppEnv } from "./env";
import type { Lang } from "./i18n";
import { REF_MAX } from "./pages/published";
import { contractPath } from "./pages/shared";
import { CONTRACT_SITEMAP_ROWS, readContractSitemap } from "./records_tables";
import { readRecords } from "./records_db";
import { SITE_ORIGIN, alternates, canonicalUrl } from "./seo";

const XML_HEADERS = { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" };
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

// The protocol's cap on the URLs of one file, and the entries a pipeline part
// holds at most (export_static.SITEMAP_MAX_URLS; test/seo-intent.test.ts
// holds the two equal): written twice, a full part stays within the cap. A
// part with more entries (one written before the pipeline halved its parts)
// keeps one entry a page, the English one, which still names the French one
// as its alternate.
export const SITEMAP_URL_MAX = 50_000;
export const SITEMAP_PART_MAX = 25_000;

// The published contracts' parts: the records database's keys are signed
// 64-bit hashes, spread evenly, so the key space cut into CONTRACT_PARTS equal
// ranges gives parts of about the same size whose addresses never change
// (about 10,000 contracts each at 1.3 million; CONTRACT_SITEMAP_ROWS, 25,000,
// is reached near 3.2 million). A power of two, so the ranges are exact.
export const CONTRACT_PARTS = 128;

// A part holds 25,000 addresses and most need no escaping, so a text with
// nothing to escape is returned as it is rather than run through five replaces.
const XML_SPECIAL = /[&<>"']/;
const escapeXml = (s: string) => !XML_SPECIAL.test(s) ? s :
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const unescapeXml = (s: string) => !s.includes("&") ? s :
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// The alternates every language version of a page carries, written once for both.
function links(path: string): string {
  return alternates(path).map((a) => `<xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${escapeXml(a.href)}"/>`).join("");
}

// One page's entry in one language: its canonical address, its lastmod, and
// the alternates (links(path)).
function entry(path: string, lang: Lang, lastmod: string | null, alt: string): string {
  return `<url><loc>${escapeXml(canonicalUrl(path, lang))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}${alt}</url>`;
}

function urlset(entries: string[]): string {
  return `${[XML_DECL, `<urlset xmlns="${SITEMAP_NS}" xmlns:xhtml="${XHTML_NS}">`, ...entries, "</urlset>"].join("\n")}\n`;
}

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const URL_RE = /<url><loc>([^<]*)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?<\/url>/g;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A pipeline part with both languages. An entry whose address does not parse
// is dropped; one that carries a query is kept as it was, with no alternates.
export function withLanguages(xml: string): string {
  const found = [...xml.matchAll(URL_RE)];
  const both = found.length <= SITEMAP_PART_MAX;
  const out: string[] = [];
  for (const [whole, loc, mod] of found) {
    let url: URL;
    try {
      url = new URL(unescapeXml(loc));
    } catch {
      continue;
    }
    if (url.search) {
      out.push(whole);
      continue;
    }
    const lastmod = mod && DATE_RE.test(mod) ? mod : null;
    const alt = links(url.pathname);
    out.push(entry(url.pathname, "en", lastmod, alt));
    if (both) out.push(entry(url.pathname, "fr", lastmod, alt));
  }
  return urlset(out);
}

// The index with the published contracts' parts after the pipeline's, each
// dated by the records database's data date.
export function withContractParts(xml: string, lastmod: string | null): string {
  const at = xml.lastIndexOf("</sitemapindex>");
  if (at < 0) return xml;
  const stamp = lastmod ? `<lastmod>${lastmod}</lastmod>` : "";
  const parts = Array.from({ length: CONTRACT_PARTS }, (_, i) => `<sitemap><loc>${SITE_ORIGIN}/sitemap-contracts-${i + 1}.xml</loc>${stamp}</sitemap>`);
  return `${xml.slice(0, at)}${parts.join("")}${xml.slice(at)}`;
}

// The first and last key of part n (1 to CONTRACT_PARTS), as decimal text.
export function contractPartKeys(n: number): [string, string] {
  const width = (1n << 64n) / BigInt(CONTRACT_PARTS);
  const first = -(1n << 63n) + BigInt(n - 1) * width;
  return [first.toString(), (first + width - 1n).toString()];
}

// /sitemap.xml and /sitemap-<n>.xml. The index lists the contracts' parts
// only while the records database is ready, which one small read tells.
export async function sitemapFile(c: Context<AppEnv>): Promise<Response> {
  const m = /^sitemap(?:-([0-9]{1,4}))?\.xml$/.exec(c.req.param("file") ?? "");
  const res = m ? await assetResponse(c.env, `sitemaps/${m[1] ? `sitemap-${m[1]}` : "index"}.xml`) : null;
  if (!m || !res) return c.notFound();
  const text = await res.text();
  if (m[1]) return new Response(withLanguages(text), { headers: XML_HEADERS });
  const records = await readRecords(c.env, []);
  const body = records.state === "ready" ? withContractParts(text, records.asOf) : text;
  return new Response(body, { headers: XML_HEADERS });
}

// /sitemap-contracts-<n>.xml: the published contracts whose key falls in part
// n, each in both languages. 503 while the records database is missing,
// loading or failing, so a crawler comes back rather than drop the part.
export async function contractSitemap(c: Context<AppEnv>): Promise<Response> {
  const m = /^sitemap-contracts-([1-9][0-9]{0,2})\.xml$/.exec(c.req.param("file") ?? "");
  const n = m ? Number(m[1]) : 0;
  if (n < 1 || n > CONTRACT_PARTS) return c.notFound();
  const [first, last] = contractPartKeys(n);
  const read = await readContractSitemap(c.env, first, last);
  if (read.state !== "ready") {
    return new Response(null, { status: 503, headers: { "Retry-After": "3600", "Cache-Control": "no-store" } });
  }
  const out: string[] = [];
  for (const row of (read.rows[0] ?? []).slice(0, CONTRACT_SITEMAP_ROWS)) {
    const dept = typeof row.dept === "string" ? row.dept.toLowerCase() : "";
    const ref = typeof row.ref === "string" ? row.ref : "";
    // Only an address the page answers 200 for (pages/published.tsx's checks).
    if (!BUYER_ID_RE.test(dept) || dept.length > 80 || !ref || ref.length > REF_MAX || CONTROL_RE.test(ref)) continue;
    const path = contractPath(dept, ref);
    const alt = links(path);
    out.push(entry(path, "en", null, alt), entry(path, "fr", null, alt));
  }
  return new Response(urlset(out), { headers: XML_HEADERS });
}
