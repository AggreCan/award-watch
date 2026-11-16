// The pool (docs/accounts.md, Seats, The pool): every counted figure of a
// subscription with seats is the subscription's, counted over its group (the
// holder and the members its plan covers, entitlements.ts planFor) inside the
// insert that holds it, so two people of one group posting at once cannot pass
// it together: D1 writes one statement at a time, and each counts the rows the
// other committed.
//
// An account in no group, which is every account until a seat is taken, sends
// the statement it always sent, word for word, with the values it always
// bound. An account in a group sends the statement's twin: the same text with
// the count that holds the figure read as user_id IN over POOL_SLOTS places
// numbered after the statement's own, the group's ids bound there and NULL in
// the places left over (NULL equals nothing, so it matches no row). The ids
// are the ones the request's session read gave (Account.group), never a value
// from the request, and no more than POOL_SLOTS of them are bound.
//
// The pool is counts only: a twin counts the group's rows and selects, returns
// or changes nothing of another account. Whatever else the statement checks
// (the same name, the same report, the same filter) stays the account's own.

import { type Group, PLAN_SEATS } from "./entitlements";

// The places a twin's count holds: the most people any plan's group holds,
// the holder and its member seats (PLAN_SEATS), 5 on Ultra.
export const POOL_SLOTS = Math.max(...Object.values(PLAN_SEATS));

// The group's places in a twin, numbered from first: "(?9, ?10, ?11, ?12, ?13)" for 9.
export const groupIn = (first: number): string =>
  `(${Array.from({ length: POOL_SLOTS }, (_, i) => `?${first + i}`).join(", ")})`;

// The values for those places: the group's ids in its order, then NULL. planFor
// never lists more than the plan's seats, so none is left out.
export const groupIds = (group: Group): (string | null)[] =>
  Array.from({ length: POOL_SLOTS }, (_, i) => group.ids[i] ?? null);

// Who a counted figure is held for: an account and the group the session read
// put it in, absent for an account in no group.
export type InGroup = { group?: Group };

// The statement an account sends and what it binds after the statement's own
// values: in no group, sql and nothing more; in a group, groupSql, then
// groupOnly (a value only the twin reads, as the figure the first dashboard's
// twin holds), then the group's ids. The one place a statement's form is
// chosen, so no caller spells the group.
export function pooled(who: InGroup, sql: string, groupSql: string, groupOnly: readonly unknown[] = []): { sql: string; binds: unknown[] } {
  return who.group ? { sql: groupSql, binds: [...groupOnly, ...groupIds(who.group)] } : { sql, binds: [] };
}
