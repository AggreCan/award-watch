import type { FC, PropsWithChildren } from "hono/jsx";

// One column system for every table on the site. Each column is of a kind,
// and a kind has one width wherever it appears (th.k-* in public/styles.css
// carries the same numbers; a test holds the two together), so the buyer
// column is as wide on an organization's profile as on the awards list. The
// main column of a table (its title, description, or the name a row is
// about) takes whatever width is left. Tables lay out at a fixed width:
// content never moves a column, and a long word breaks inside its cell.

export const COLUMN_WIDTHS = {
  date: 112, // a date or a year
  datetime: 156, // a date with a time, or a closing date with its status chip under it
  value: 132, // one record's amount, up to eleven digits ("$13,044,299,191") on one line
  total: 148, // a sum over many records (up to twelve digits)
  count: 96, // a count, a rank, an amendment number
  comp: 168, // the competition flag, its longest label ("Méthode non précisée") on one line
  amend: 144, // amendments and value growth; with value, the widest table fits 1600 px
  record: 168, // links to the government's own record, "Avis sur AchatsCanada" on one line
  org: 216, // an organization, or another party (officials, a registrant)
  buyer: 200, // a buyer, a department, an institution, a publisher
  region: 180, // regions of delivery, a city
  source: 180, // a source's name
  label: 128, // a short label: a status, a type, a code, a stage, a feed file
  share: 160, // "3 of 60 (5%)"
  file: 220, // a file name or an API endpoint
  text: 192, // a second column of running text
} as const;

export type ColumnKind = "main" | keyof typeof COLUMN_WIDTHS;

// The main column never gets narrower than this: below it the table keeps
// its width and its wrapper scrolls sideways. At this floor the awards list,
// buyer included, fits a 1280 px screen.
export const MAIN_MIN = 152;

// A secondary column rests (is hidden) while the content column is too
// narrow for the whole table, from 700 px of viewport up to 1279 px ("md"),
// 1439 px ("lg") or 1599 px ("xl"). With the 240 px rail those are content
// columns of about 975, 1135 and 1295 px. Below 700 px a table restacks
// into labelled blocks and shows every column again.
export type Rest = "md" | "lg" | "xl";

export const REST_CLASS: Record<Rest, string> = { md: "mdh", lg: "lgh", xl: "xlh" };

export function restClass(rest: Rest | undefined): string | undefined {
  return rest ? REST_CLASS[rest] : undefined;
}

export type Column = { kind: ColumnKind; label: unknown; rest?: Rest; class?: string };

const NUMERIC: ReadonlySet<ColumnKind> = new Set<ColumnKind>(["value", "total", "count", "share"]);

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
// 1600 px up; xl is the range where the "xl" columns rest, lg where the "lg"
// and "xl" ones do, md where every resting column does.
export function minWidths(cols: readonly Column[]): { all: number; xl: number; lg: number; md: number } {
  const sum = (list: readonly Column[]) => list.reduce((n, c) => n + widthOf(c.kind), 0);
  return {
    all: sum(cols),
    xl: sum(cols.filter((c) => c.rest !== "xl")),
    lg: sum(cols.filter((c) => c.rest !== "xl" && c.rest !== "lg")),
    md: sum(cols.filter((c) => !c.rest)),
  };
}

// The same numbers as custom properties for the stylesheet, which picks the
// one for the viewport's range.
export function tableStyle(cols: readonly Column[]): string {
  const w = minWidths(cols);
  return `--tmin:${w.all}px;--tmin-xl:${w.xl}px;--tmin-lg:${w.lg}px;--tmin-md:${w.md}px`;
}

export type MaybeColumn = Column | false | null | undefined;

export function shownColumns(cols: readonly MaybeColumn[]): Column[] {
  return cols.filter((c): c is Column => !!c);
}

export function tableClass(restack: boolean, cls?: string): string {
  return [restack ? "restack" : "", "cols", cls ?? ""].filter(Boolean).join(" ");
}

// The head row and widths of a table a client script draws (public/tenders.js),
// so the script carries no copy of the column system.
export function clientTable(cols: readonly Column[], cls?: string): { cls: string; style: string; heads: [string, string][] } {
  return { cls: tableClass(true, cls), style: tableStyle(cols), heads: cols.map((c) => [headClass(c), String(c.label)]) };
}

// A table on the system: the head row drawn from the columns, the body passed
// in. Every table restacks into labelled blocks on a phone unless it says
// otherwise (its cells then need no data-label, and it scrolls instead).
export const Table: FC<PropsWithChildren<{ cols: readonly MaybeColumn[]; class?: string; restack?: boolean }>> = ({
  cols, class: cls, restack = true, children,
}) => {
  const shown = shownColumns(cols);
  return (
    <table class={tableClass(restack, cls)} style={tableStyle(shown)}>
      <thead>
        <tr>
          {shown.map((c) => <th class={headClass(c)}>{c.label as any}</th>)}
        </tr>
      </thead>
      {children}
    </table>
  );
};
