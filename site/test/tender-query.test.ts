// The browser's view rules (public/tender-query.js, which tenders.js draws
// with) held to the server's: the same address reads as the same view,
// keeps the same notices in the same order and is written back the same,
// several values of a key included.
import { describe, expect, it } from "vitest";
import { filterRows, queryString, readSearch } from "../public/tender-query.js";
import type { TenderRow } from "../src/data";
import { filterTenders, readTenderQuery, tenderQueryString } from "../src/pages/tenders";
import { testClock } from "./assets";
import openTenders from "./fixtures/tenders-open.json";

const rows = openTenders as unknown as TenderRow[];
const server = (search: string) => readTenderQuery(new URL(`https://x/tenders${search}`));
const serverRefs = (search: string) => filterTenders(rows, server(search), testClock).map((r) => r.reference);
const clientRefs = (search: string) => (filterRows(rows, readSearch(search), testClock.now) as TenderRow[]).map((r) => r.reference);

const VIEWS = [
  "", "?sort=published", "?closing=7", "?q=propeller", "?buyer=dfo-mpo", "?code=7210",
  "?segment=43", "?province=QC", "?province=QC&national=0",
  // Several values of a key: any one of them, and every key given.
  "?segment=72&segment=82", "?category=GD&category=SRV", "?province=BC&province=ON&national=0",
  "?segment=72&segment=82&province=BC", "?segment=43&segment=82&province=QC&province=BC",
  "?segment=43&segment=82&province=QC&province=BC&national=0", "?category=gd&category=SRV&segment=43&sort=published",
  "?segment=82&province=qc&segment=43&province=BC&segment=82&national=0&category=srv&category=GD&province=ZZ&page=2",
  // The orders the list's heads set, each way, and one the list does not know.
  "?sort=closing-asc", "?sort=closing-desc", "?sort=published-asc", "?sort=closing-desc&province=QC", "?sort=up",
];

describe("the browser's view rules", () => {
  it("keep the notices the server keeps, in its order", () => {
    for (const view of VIEWS) expect(clientRefs(view), view).toEqual(serverRefs(view));
    // The union within a key and the intersection across keys, as the server answers.
    expect(clientRefs("?segment=72&segment=82")).toEqual(["cb-100-10000001", "cb-200-20005019"]);
    expect(clientRefs("?segment=43&segment=82&province=QC&province=BC")).toEqual(["cb-100-10000001", "cb-300-30000003"]);
    expect(clientRefs("?segment=72&segment=82&province=BC")).toEqual(["cb-200-20005019"]);
  });

  it("write a view's address as the server does, each value once in the fixed order, and read it back", () => {
    for (const view of VIEWS) {
      const s = readSearch(view);
      const q = server(view);
      expect(queryString(s, s.page), view).toBe(tenderQueryString(q));
      expect({ category: s.category, segment: s.segment, province: s.province, national: s.national }, view)
        .toEqual({ category: q.category, segment: q.segment, province: q.province, national: q.national });
      // Read back, the address is the same view.
      const again = readSearch(queryString(s, s.page));
      expect(again, view).toEqual(s);
    }
    expect(queryString(readSearch("?segment=82&segment=43&province=QC&province=BC&category=SRV&category=GD"), 1))
      .toBe("?category=GD&category=SRV&segment=43&segment=82&province=BC&province=QC");
  });
});
