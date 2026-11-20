// The line a control reads where it refuses because the SUBSCRIPTION is full
// (docs/accounts.md, Seats; the seats design's 3.4 and 5.9), in place of the
// line that says "this account": Save this search and Add a Search, Follow,
// Save this briefing, the calendar feeds, New dashboard, Save this view,
// Create a key, and the notices a refused post returns to. A member reads
// pool.full, which names the holder to ask; the holder reads pool.full_holder,
// which points to the Seats page, where each seat's counts are.
//
// Only while the seats' switch is on and only for an account in a group: every
// other reader, an account in no group above all, is given nothing here and
// reads the line it read before, byte for byte. The holder's address comes
// from the member's own session (planFor's read of its own seat, Account.seat),
// never from a form, and only when that seat is the one that puts the account
// in this group. Counts and addresses only; nothing here reads a row.
//
// The switch: a component reads it from the page's shell (layout.tsx
// Shell.seats, set from seats.ts seatsOn); a line built before the page is
// drawn takes it from its caller (seats.ts seatsSwitched, which reads nothing).

import { useContext, type FC } from "hono/jsx";
import type { Env } from "../env";
import { fmtInt, t, tj, type Lang } from "../i18n";
import { RailContext } from "../layout";
import type { Group, SeatState } from "./entitlements";
import type { PoolFigure } from "./pool";
import { THINGS } from "./pool_lines";
import { seatsSwitched } from "./seats";

export const SEATS_PAGE = "/account/seats";

// Who reads a line: an account with the group and the seat its session read gave.
export type PoolReader = { group?: Group; seat?: SeatState };

// Which line the reader gets: the member's, with the holder's address from its
// own seat; the holder's; or none (an account in no group, or a seat that is not
// the one that puts it in this group).
type Side = { kind: "member"; holder: string } | { kind: "holder" } | null;

function sideOf(who: PoolReader): Side {
  const g = who.group;
  if (!g) return null;
  if (g.position === 0) return { kind: "holder" };
  const seat = who.seat;
  if (seat?.covered && seat.holderId === g.holderId && seat.holderEmail) return { kind: "member", holder: seat.holderEmail };
  return null;
}

const langQuery = (lang: Lang) => (lang === "fr" ? "?lang=fr" : "");

// The line, or null for every reader it is not for (on: the seats' switch).
// linked: the holder's names the Seats page as a link (markup); otherwise as
// words, for a notice that is text.
export function poolFullLine(lang: Lang, who: PoolReader, figure: PoolFigure, cap: number, on: boolean, linked = true): unknown {
  if (!on) return null;
  const side = sideOf(who);
  if (!side) return null;
  const vars = { cap: fmtInt(cap, lang), things: t(lang, THINGS[figure]) };
  if (side.kind === "member") return t(lang, "pool.full", { ...vars, holder: side.holder });
  if (!linked) return t(lang, "pool.full_holder", { ...vars, seats: t(lang, "pool.full_seats") });
  return tj(lang, "pool.full_holder", { ...vars, seats: <a href={`${SEATS_PAGE}${langQuery(lang)}`}>{t(lang, "pool.full_seats")}</a> });
}

// The same as text alone, for a notice a page keeps as a string.
export const poolFullText = (lang: Lang, who: PoolReader, figure: PoolFigure, cap: number, on: boolean): string | null =>
  poolFullLine(lang, who, figure, cap, on, false) as string | null;

// The text line with the switch read from the environment, which reads nothing.
export const poolFullNotice = (
  lang: Lang, who: PoolReader, figure: PoolFigure, cap: number, env: Pick<Env, "SEATS" | "ACCOUNTS_ENABLED" | "ACCOUNTS">,
): string | null => poolFullText(lang, who, figure, cap, seatsSwitched(env));

// The line in a control: drawn only while the page's shell says the switch is
// on and the reader is in a group, in a paragraph of its own when p is set (true,
// or the paragraph's class); else otherwise, the line the control drew before
// (nothing when none is given).
export const PoolFull: FC<{ lang: Lang; who: PoolReader; figure: PoolFigure; cap: number; otherwise?: unknown; p?: true | string }> = ({
  lang, who, figure, cap, otherwise, p,
}) => {
  const line = poolFullLine(lang, who, figure, cap, !!useContext(RailContext)?.seats);
  if (line === null) return (otherwise ?? null) as any;
  if (p === true) return <p>{line as any}</p>;
  return p ? <p class={p}>{line as any}</p> : <>{line as any}</>;
};

// An address where a column is narrow (the Seats page's pool table heads, the
// console's Seats panel): a line may break after its "@" and its dots, never
// inside a word, so an address is never broken in the middle of a name.
export const breakable = (address: string): unknown[] =>
  address.split(/(?<=[@.])/).flatMap((part, i) => (i ? [<wbr />, part] : [part]));

// Whether the shell's switch is on and the reader in a group, for a control
// whose own words change with it.
export const usePooled = (who: PoolReader): boolean => !!useContext(RailContext)?.seats && sideOf(who) !== null;
