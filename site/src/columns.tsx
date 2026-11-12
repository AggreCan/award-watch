import { createContext, useContext, type FC, type PropsWithChildren } from "hono/jsx";
import { headOrder } from "../public/sort.js";

// One column system for every table on the site. Each column is of a kind,
// and a kind has one width wherever it appears (th.k-* in public/styles.css
// carries the same numbers; a test holds the two together), so the buyer
// column is as wide on an organization's profile as on the awards list. The
// main column of a table (its title, description, or the name a row is
// about) takes whatever width is left. Tables lay out at a fixed width:
// content never moves a column, and a long word breaks inside its cell.
// A guide's comparison table (src/guides.ts) may have two main columns, two
// columns of sentences side by side, which share that width equally; every
// other table has one.

export const COLUMN_WIDTHS = {
  date: 112, // a date or a year
  datetime: 184, // a date with a time, or a closing date with its status chip under it ("Date de clôture passée" on one line)
  value: 132, // one record's amount, up to eleven digits ("$13,044,299,191") on one line
  total: 148, // a sum over many records (up to twelve digits)
  // A source's name over a figure from it: "Grants and contributions" over a
  // total, or a count, with the longest name, "Historique des contrats de
  // SPAC" (186 px of type), on one line; also the watchlist's new records by
  // source.
  tally: 204,
  count: 96, // a count, an amendment number
  // A day's requests on the API usage page: one key's, up to its daily cap
  // ("20,000", 46 px of type, in a last column's 56 px), or the day's total
  // over the keys ("200,000", 54 px, in 64). At the count's 96 px the total
  // and five keys did not fit a 700 px window.
  requests: 80,
  // A rank: up to three digits under "Rank" or "Rang", beside the 16 px a
  // first column keeps on its left. At the count's 96 px a ranked list in
  // half a row gave its names 40 px less and wrapped them.
  rank: 56,
  comp: 168, // the competition flag, its longest label ("Méthode non précisée") on one line
  amend: 144, // amendments and value growth; with value, the widest table fits 1600 px
  record: 168, // links to the government's own record, "Avis sur AchatsCanada" on one line
  org: 216, // an organization, or another party (officials, a registrant)
  buyer: 200, // a buyer, a department, an institution, a publisher
  region: 180, // regions of delivery, a city
  source: 180, // a source's name
  label: 128, // a short label: a status, a type, a code, a stage, a feed file
  share: 160, // "3 of 60 (5%)"
  // A part of the row's own count and its percentage: "12,345 (100%)" (97 px
  // of type) on one line. At the share's 160 px a year table did not fit a
  // 700 px window.
  part: 120,
  file: 220, // a file name or an API endpoint
  text: 192, // a second column of running text
} as const;

export type ColumnKind = "main" | keyof typeof COLUMN_WIDTHS;

// The main column never gets narrower than this. A table's least width in a
// range (its shown columns, the main one at this floor) is never more than
// the content column the stylesheet gives it there (test/columns.test.ts),
// so where a table would not fit, a column rests rather than the table
// scrolling sideways.
export const MAIN_MIN = 128;

// A secondary column rests (is hidden) while the content column is too
// narrow for the whole table, from 700 px of viewport up to 1279 px ("md"),
// 1439 px ("lg"), 1599 px ("xl") or 1919 px ("xxl"). The content column is
// the window less a 15 px scrollbar, the 264 px rail from 1000 px, the
// page's 24 px padding on each side and the panel's two 1 px borders: 635 px
// at 700, 671 at 1000 (where the rail appears), 951 at 1280, 1111 at 1440,
// 1271 at 1600 and 1591 at 1920; half of it, less the gutter, in a panel
// grid's track, and at most 878 px in a document. Below 700 px a table
// restacks into labelled blocks and shows every column again. What a
// resting column holds still shows in the range it rests, under another
// column's figure (.md-only from 700 to 1279 px, .lg-down from 700 to 1439).
export type Rest = "md" | "lg" | "xl" | "xxl";

export const REST_CLASS: Record<Rest, string> = { md: "mdh", lg: "lgh", xl: "xlh", xxl: "xxh" };

export function restClass(rest: Rest | undefined): string | undefined {
  return rest ? REST_CLASS[rest] : undefined;
}

// A head the server orders by, on a table it sorts (Table's sorting
// "server"): the address of the same view in the next order (ascending,
// descending, then the list's own order) and the order now, when this
// column sets it. key alone names the order for a table a client script
// draws (clientTable), which writes the address itself.
export type SortState = "ascending" | "descending";
export type HeadSort = { key?: string; href?: string; state?: SortState | null };

export type Column = { kind: ColumnKind; label: unknown; rest?: Rest; class?: string; sort?: HeadSort };

// A tally column is a figure's when its table says so (class "num"): the
// watchlist's new records by source are words.
const NUMERIC: ReadonlySet<ColumnKind> = new Set<ColumnKind>(["value", "total", "count", "requests", "rank", "share", "part"]);

export function headClass(c: Column): string {
  return [`k-${c.kind}`, NUMERIC.has(c.kind) ? "num" : "", c.rest ? REST_CLASS[c.rest] : "", c.class ?? ""]
    .filter(Boolean)
    .join(" ");
}

function widthOf(kind: ColumnKind): number {
  return kind === "main" ? MAIN_MIN : COLUMN_WIDTHS[kind];
}

// The least width a table takes in each range: every column it shows there
// at its kind's width, and the main column at its minimum. all is from
// 1920 px up; xxl is the range where the "xxl" columns rest, xl where the
// "xl" and "xxl" ones do, and so on down to md, where every resting column does.
export function minWidths(cols: readonly Column[]): { all: number; xxl: number; xl: number; lg: number; md: number } {
  const sum = (list: readonly Column[]) => list.reduce((n, c) => n + widthOf(c.kind), 0);
  const shownIn = (...resting: Rest[]) => cols.filter((c) => !c.rest || !resting.includes(c.rest));
  return {
    all: sum(cols),
    xxl: sum(shownIn("xxl")),
    xl: sum(shownIn("xxl", "xl")),
    lg: sum(shownIn("xxl", "xl", "lg")),
    md: sum(cols.filter((c) => !c.rest)),
  };
}

// The same numbers as custom properties for the stylesheet, which picks the
// one for the viewport's range. A table with no column resting in the widest
// range leaves its --tmin-xxl out (the stylesheet falls back to --tmin).
export function tableStyle(cols: readonly Column[]): string {
  const w = minWidths(cols);
  const xxl = w.xxl !== w.all ? `--tmin-xxl:${w.xxl}px;` : "";
  return `--tmin:${w.all}px;${xxl}--tmin-xl:${w.xl}px;--tmin-lg:${w.lg}px;--tmin-md:${w.md}px`;
}

export type MaybeColumn = Column | false | null | undefined;

export function shownColumns(cols: readonly MaybeColumn[]): Column[] {
  return cols.filter((c): c is Column => !!c);
}

export function tableClass(restack: boolean, cls?: string): string {
  return [restack ? "restack" : "", "cols", cls ?? ""].filter(Boolean).join(" ");
}

// Who orders a table's rows when a reader asks (public/sort.js reads it from
// the table). "client": every row of the list is on the page, so the script
// sorts them there, by any column. "server": the list runs past the page (a
// next-page link), so only the heads the server can order by carry a link
// (Column.sort) and the others stay plain labels: sorting one page in the
// browser would pass for sorting the list. "none": a table whose rows only
// read in their own order (a tree of levels).
export type Sorting = "client" | "server" | "none";

// The orders a server-sorted list offers, as headOrder in public/sort.js
// reads them: the value in the address, the column, the direction.
export type SortOrders = readonly (readonly [string, string, "asc" | "desc"])[];

// A head's link on a server-sorted list. href turns the next order's value
// into the view's address (the other filters kept, the first page); none
// is the value of the list's own order.
export function headSort(orders: SortOrders, current: string, column: string, href: (value: string) => string, none = ""): HeadSort {
  const h = headOrder(orders, current, column, none);
  return { key: column, href: href(h.next), state: h.state };
}

// Whether a table on the page sorts in the browser, for the layout, which
// then loads public/sort.js and its words after the content (src/layout.tsx);
// and whether the page draws a tip (a chart, the home map or a short-form
// figure, src/chart.tsx useTips), for which it loads public/tooltip.js.
// charts counts the page's chart stacks (src/chart.tsx), so each one's gradients
// get ids of their own that are the same on every render of the page.
export type TableUse = { sortable: boolean; tips?: boolean; charts?: number };
export const TableUseContext = createContext<TableUse | null>(null);

// For a page whose sortable table a client script draws after load (the
// tender list while the server waits for it): the script and its words come
// all the same.
export const SortsHere: FC = () => {
  const use = useContext(TableUseContext);
  if (use) use.sortable = true;
  return null;
};

// A head cell that sorts in the page, for a table drawn outside the column
// system (the account pages' own lists, whose table carries
// data-sorting="client"). kind says how its cells read where no k-* class
// can ("date"); a head with class "num" reads figures.
export const SortHead: FC<PropsWithChildren<{ class?: string; kind?: "date" }>> = ({ class: cls, kind, children }) => {
  const use = useContext(TableUseContext);
  if (use) use.sortable = true;
  return <th class={cls} data-kind={kind}><button type="button" class="th-sort">{children as any}</button></th>;
};

// The head row and widths of a table a client script draws (public/tenders.js),
// so the script carries no copy of the column system. Each head is its
// class, its label, and the order it sets on a server-sorted list ("" for
// none).
export function clientTable(cols: readonly Column[], cls?: string, sorting: Sorting = "client"): {
  cls: string; style: string; sorting: Sorting; heads: [string, string, string][];
} {
  return {
    cls: tableClass(true, cls), style: tableStyle(cols), sorting,
    heads: cols.map((c) => [headClass(c), String(c.label), c.sort?.key ?? ""]),
  };
}

// One head cell. On a client-sorted table the label is a button for
// public/sort.js; on a server-sorted one it is a link where the server
// orders by the column, aria-sort on the cell while it does; anywhere else
// it is the label alone.
const Head: FC<{ c: Column; sorting: Sorting }> = ({ c, sorting }) => {
  if (sorting === "client") return <th class={headClass(c)}><button type="button" class="th-sort">{c.label as any}</button></th>;
  if (sorting === "server" && c.sort?.href) {
    return (
      <th class={headClass(c)} aria-sort={c.sort.state ?? undefined}>
        <a href={c.sort.href} class="th-sort" rel="nofollow">{c.label as any}</a>
      </th>
    );
  }
  return <th class={headClass(c)}>{c.label as any}</th>;
};

// A table on the system: the head row drawn from the columns, the body passed
// in. Every table restacks into labelled blocks on a phone unless it says
// otherwise (its cells then need no data-label, and it scrolls instead), and
// sorts in the browser unless it says otherwise (sorting).
export const Table: FC<PropsWithChildren<{ cols: readonly MaybeColumn[]; class?: string; restack?: boolean; sorting?: Sorting }>> = ({
  cols, class: cls, restack = true, sorting = "client", children,
}) => {
  const shown = shownColumns(cols);
  // The script gives a server-sorted table's links their hint too.
  const use = useContext(TableUseContext);
  if (use && (sorting === "client" || (sorting === "server" && shown.some((c) => c.sort?.href)))) use.sortable = true;
  return (
    <table class={tableClass(restack, cls)} style={tableStyle(shown)} data-sorting={sorting === "none" ? undefined : sorting}>
      <thead>
        <tr>
          {shown.map((c) => <Head c={c} sorting={sorting} />)}
        </tr>
      </thead>
      {children}
    </table>
  );
};
