// The page to return to: ?next= on the sign-in pages, a form's next field, or
// the page a browser came from (its Referer). A path on this site only, never
// another host, never the sign-in pages. routes.tsx reads next with safeNext;
// the refusal pages (src/limit_page.tsx, and routes.tsx for a form sent under
// an earlier sign-in) read the referring page with refererPath.

import { isOwnAddress } from "../api";

export const NEXT_MAX = 300;

export function safeNext(raw: string | undefined | null): string | null {
  if (!raw || raw.length > NEXT_MAX || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw) || raw.startsWith("/account/sign-in") || raw.startsWith("/account/check")) return null;
  return raw;
}

// The page a request came from, as its path and query, when the Referer names
// one of the site's own pages (the referrer policy keeps the full address on
// the site's pages) and safeNext keeps it; null for another site's, for none,
// and for one safeNext refuses.
export function refererPath(referer: string | undefined | null, requestUrl: string): string | null {
  if (!referer || !isOwnAddress(referer, requestUrl)) return null;
  try {
    const url = new URL(referer);
    return safeNext(`${url.pathname}${url.search}`);
  } catch {
    return null;
  }
}
