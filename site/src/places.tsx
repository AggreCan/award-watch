// The province filter the tender lists share: /tenders reads it among its
// other filters (src/pages/tenders.tsx), and the two day lists the home
// page's map links to, /tenders/new and /tenders/same-day, read it alone.
// Its own module so the pages can share it without importing each other.
//
// province: the codes asked for, each once, in PROVINCES order. national:
// whether a notice that names no province (Canada-wide or not stated) stays
// in the list beside them, on unless the address says national=0. derived:
// whether a province derived from another field (pipeline places.py) counts
// beside the stated ones, on unless the address says derived=0. The map's
// links carry national=0, so a province's list holds the notices its count
// counts.

import type { FC } from "hono/jsx";
import { PROVINCES } from "./constants";
import type { TenderRow } from "./data";
import { provinceName, t, type Lang } from "./i18n";

export interface PlaceQuery {
  province: string[];
  national: boolean;
  derived: boolean;
}

// The form sends national=0 from a hidden field and national=1 from the
// ticked box, so either 1 or no value at all keeps the notices in; derived the same.
export function readPlaceQuery(url: URL): PlaceQuery {
  const asked = new Set(url.searchParams.getAll("province").map((v) => v.trim().toUpperCase()));
  const national = url.searchParams.getAll("national");
  const derived = url.searchParams.getAll("derived");
  return {
    province: PROVINCES.filter((p) => asked.has(p)),
    national: national.length === 0 || national.includes("1"),
    derived: derived.length === 0 || derived.includes("1"),
  };
}

// Whether a notice passes the filter: one of the asked provinces among its
// stated ones (and its derived ones unless derived is off), or none at all
// while national is on. Every notice passes when no province is asked.
export function placedIn(r: TenderRow, q: PlaceQuery): boolean {
  if (!q.province.length) return true;
  const placed = q.derived && r.provinces_derived ? [...r.provinces, ...r.provinces_derived] : r.provinces;
  return q.province.some((v) => placed.includes(v)) || (q.national && placed.length === 0);
}

// The filter's part of an address, without the "?": the provinces, then
// national=0 and derived=0 where they change the list (beside a province).
// The same keys in the same order as tenderQueryString writes them.
export function placeParams(q: PlaceQuery): [string, string][] {
  if (!q.province.length) return [];
  return [
    ...q.province.map((p): [string, string] => ["province", p]),
    ...(q.national ? [] : [["national", "0"] as [string, string]]),
    ...(q.derived ? [] : [["derived", "0"] as [string, string]]),
  ];
}

// The chips over a day list filtered by the map: a province a chip, each
// linking to the same list without it, as the tender list's chips do.
export const PlaceChips: FC<{ lang: Lang; q: PlaceQuery; href: (q: PlaceQuery) => string }> = ({ lang, q, href }) =>
  q.province.length ? (
    <div class="toolbar">
      <div class="toolbar-chips">
        <span class="chips-label">{t(lang, "tenders.filters_active")}</span>
        {q.province.map((p) => (
          <a class="fchip" href={href({ ...q, province: q.province.filter((x) => x !== p) })}
            aria-label={t(lang, "tenders.remove_filter", { name: provinceName(lang, p) })}>
            <span>{t(lang, "tenders.filter_province")}</span> <b>{provinceName(lang, p)}</b>
            <span class="fchip-x" aria-hidden="true">×</span>
          </a>
        ))}
      </div>
    </div>
  ) : null;

// The provinces asked for, by name, for a line saying the filtered list is empty.
export function placeNames(lang: Lang, q: PlaceQuery): string {
  return q.province.map((p) => provinceName(lang, p)).join(", ");
}
