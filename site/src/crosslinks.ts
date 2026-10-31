// Links between pages that do not read each other's files: from a profile to
// the A to Z directory that lists it, and from any record to its buyer's
// page. A profile's other inbound links are its sitemap entry and the lists
// on buyer, category and ranking pages, so the directory is the link every
// profile can count on.

import { OUTSIDE, PROVINCES, UNKNOWN } from "./constants";
import { type DirectorySummary, BUYER_ID_RE, loadDirectory } from "./data";
import type { Env } from "./env";

export function directoryPath(code: string, n = 1): string {
  return n === 1 ? `/organizations/directory/${code}` : `/organizations/directory/${code}/${n}`;
}

// The directory a profile's place puts it in: its province when Canadian,
// "xx" for an address outside Canada, "un" when the records carry none.
export function directoryCode(province: string | null | undefined, country: string | null | undefined): string {
  if (province && (PROVINCES as readonly string[]).includes(province)) return province.toLowerCase();
  if (country && country !== "CA") return OUTSIDE.toLowerCase();
  return UNKNOWN.toLowerCase();
}

// A buyer's page, or null for an id that is not one (a record whose buyer the
// pipeline could not map carries none).
export function buyerPath(id: string | null | undefined): string | null {
  return id && BUYER_ID_RE.test(id) ? `/buyers/${id}` : null;
}

// Each directory's counts (directory/index.json), for the links on the
// profiles and the organizations page; null when the file is missing or
// unreadable, and then no page shows a link.
export async function loadDirectories(env: Env): Promise<ReadonlyMap<string, DirectorySummary> | null> {
  try {
    const doc = await loadDirectory(env);
    return doc ? new Map(doc.directories.map((d) => [d.code, d])) : null;
  } catch (e) {
    console.error(`directory links: ${String(e).slice(0, 200)}`);
    return null;
  }
}
