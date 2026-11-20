// The stop link of a grouped message (deliveries.ts, digests.ts groupDigest,
// briefingGroupDigest, viewGroupDigest): /account/stop?g=<user id>&t=<tags>
// for saved searches, ?gb= for briefings and ?gv= for saved views, in the
// message's footer and in its List-Unsubscribe header, where a mail client's
// one-click POST (RFC 8058) turns off the email of every item the message
// carried. Each section of the message keeps its own link to its item alone
// (/account/stop?s=, ?b= or ?v=, with &t=), as a single message carries.
//
// No table holds the group. Each item's tag is the first GROUP_TAG_BYTES
// bytes of SHA-256 over the kind's words, the item's id and its stop secret
// (delivery_tokens, briefings.secret, saved_views.secret), written in
// base64url, so the link names its items without carrying their ids and
// proves each one with its secret, which only the messages of that item
// carry. The kind's words keep a briefing's tag from standing for a search
// with the same id and secret, and a search's tag reads as it always did. The
// route reads the account's items of the link's kind with their secrets,
// computes each one's tag, and acts on those whose tag the link holds: a
// forwarded link turns off the email of the items in that message and of no
// other, a tag changed or made up matches nothing (one in 2^48 an item), and
// the link can do nothing else (no item is deleted, nothing is shown but the
// items' labels). An item deleted since the message drops out; the rest still
// match, so the link works for as long as its items exist, as a single item's
// link does.
//
// Why tags and not ids: Email Sending holds a custom header's value to 2,048
// bytes (developers.cloudflare.com/email-service/reference/headers/), and a
// URI inside List-Unsubscribe cannot be folded, so the whole link must also
// stay under RFC 5322's 998 characters a line. A hundred 32-character ids
// make 3,300 characters; a hundred tags make 800.

const encoder = new TextEncoder();

export const GROUP_TAG_BYTES = 6;
// Base64url of six bytes, no padding.
export const GROUP_TAG_CHARS = 8;
// The most items one grouped message carries: an account's most saved searches and briefings together
// (entitlements.ts SAVED_SEARCH_MAX); saved views are fewer (SAVED_VIEW_MAX).
export const GROUP_TAGS_MAX = 100;

// The kinds of grouped message, each with its link's parameter and the words its tags are made over.
export type GroupKind = "searches" | "briefings" | "views";
export const GROUP_PARAM: Readonly<Record<GroupKind, string>> = { searches: "g", briefings: "gb", views: "gv" };
const GROUP_WORDS: Readonly<Record<GroupKind, string>> = { searches: "stop group", briefings: "stop briefings", views: "stop views" };

const TAGS_RE = /^(?:[A-Za-z0-9_-]{8})+$/;
export const USER_RE = /^[0-9a-f]{32}$/;

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function groupTag(id: string, secret: string, kind: GroupKind = "searches"): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${GROUP_WORDS[kind]}\n${id}\n${secret}`)));
  return base64url(digest.subarray(0, GROUP_TAG_BYTES));
}

// The link's path, the items in the message's order.
export async function groupStopPath(userId: string, members: readonly { id: string; secret: string }[], kind: GroupKind = "searches"): Promise<string> {
  const tags = await Promise.all(members.map((m) => groupTag(m.id, m.secret, kind)));
  return `/account/stop?${GROUP_PARAM[kind]}=${userId}&t=${tags.join("")}`;
}

// The link's tags, or null for a value that is not one: a whole number of
// tags, at least one and at most GROUP_TAGS_MAX, each in base64url.
export function readGroupTags(value: string): Set<string> | null {
  if (!TAGS_RE.test(value) || value.length > GROUP_TAGS_MAX * GROUP_TAG_CHARS) return null;
  const out = new Set<string>();
  for (let i = 0; i < value.length; i += GROUP_TAG_CHARS) out.add(value.slice(i, i + GROUP_TAG_CHARS));
  return out;
}

// Which of the account's items the link proves: those whose tag it holds.
export async function provenBy<T extends { id: string; secret: string }>(
  tags: ReadonlySet<string>, items: readonly T[], kind: GroupKind = "searches",
): Promise<T[]> {
  const out: T[] = [];
  for (const s of items) if (tags.has(await groupTag(s.id, s.secret, kind))) out.push(s);
  return out;
}
