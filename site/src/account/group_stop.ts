// The stop link of a grouped saved-search message (deliveries.ts, digests.ts
// groupDigest): /account/stop?g=<user id>&t=<tags>, in the message's footer
// and in its List-Unsubscribe header, where a mail client's one-click POST
// (RFC 8058) turns off the email of every search the message carried. Each
// section of the message keeps its own link to its search alone
// (/account/stop?s=&t=), as a single message carries.
//
// No table holds the group. Each search's tag is the first GROUP_TAG_BYTES
// bytes of SHA-256 over the search's id and its stop secret
// (delivery_tokens), written in base64url, so the link names its searches
// without carrying their ids and proves each one with its secret, which only
// the messages of that search carry. The route reads the account's searches
// with their secrets, computes each one's tag, and acts on those whose tag
// the link holds: a forwarded link turns off the email of the searches in
// that message and of no other, a tag changed or made up matches nothing
// (one in 2^48 a search), and the link can do nothing else (no search is
// deleted, nothing is shown but the searches' labels). A search deleted
// since the message drops out; the rest still match, so the link works for
// as long as its searches exist, as a single search's link does.
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
// The most searches one grouped message carries: an account's most (entitlements.ts SAVED_SEARCH_MAX).
export const GROUP_TAGS_MAX = 100;

const TAGS_RE = /^(?:[A-Za-z0-9_-]{8})+$/;
export const USER_RE = /^[0-9a-f]{32}$/;

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function groupTag(searchId: string, secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`stop group\n${searchId}\n${secret}`)));
  return base64url(digest.subarray(0, GROUP_TAG_BYTES));
}

// The link's path, the searches in the message's order.
export async function groupStopPath(userId: string, members: readonly { id: string; secret: string }[]): Promise<string> {
  const tags = await Promise.all(members.map((m) => groupTag(m.id, m.secret)));
  return `/account/stop?g=${userId}&t=${tags.join("")}`;
}

// The link's tags, or null for a value that is not one: a whole number of
// tags, at least one and at most GROUP_TAGS_MAX, each in base64url.
export function readGroupTags(value: string): Set<string> | null {
  if (!TAGS_RE.test(value) || value.length > GROUP_TAGS_MAX * GROUP_TAG_CHARS) return null;
  const out = new Set<string>();
  for (let i = 0; i < value.length; i += GROUP_TAG_CHARS) out.add(value.slice(i, i + GROUP_TAG_CHARS));
  return out;
}

// Which of the account's searches the link proves: those whose tag it holds.
export async function provenBy<T extends { id: string; secret: string }>(tags: ReadonlySet<string>, searches: readonly T[]): Promise<T[]> {
  const out: T[] = [];
  for (const s of searches) if (tags.has(await groupTag(s.id, s.secret))) out.push(s);
  return out;
}
