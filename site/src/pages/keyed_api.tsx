// The keyed API's part of the Data page's API section: the endpoints, what
// each parameter takes, what a list answers, the limits, the errors and a
// curl example. The Data page shows it only while the accounts switch is on,
// since the endpoints answer 404 while it is off. Everything here comes from
// src/api_keyed_spec.ts and the request limits /terms quotes, so the page
// cannot drift from the routes.

import type { FC } from "hono/jsx";
import { KEYED_ENDPOINTS, KEYED_PARAMS, KEY_PER_DAY, KEY_PER_DAY_ULTRA, KEY_PER_MINUTE, OPEN_Q_MAX, RECORD_PAGES_MAX } from "../api_keyed_spec";
import { Table } from "../columns";
import { fmtInt, t, tj, type Lang } from "../i18n";
import { SITE_ORIGIN } from "../seo";
import { REQUEST_LIMITS } from "./docs";

export const KEYED_EXAMPLE = `curl -H "Authorization: Bearer $AWARDWATCH_KEY" "${SITE_ORIGIN}/api/v1/tenders/open?province=ON&closing=7"`;

// ultra: Ultra is on sale (pages/data.tsx), so the limits state each paid plan's figure for the day.
export const KeyedApiDocs: FC<{ lang: Lang; ultra?: boolean }> = ({ lang, ultra }) => {
  const mono = (s: string) => <span class="mono">{s}</span>;
  return (
    <>
      <h3 id="api-keyed">{t(lang, "keyed.title")}</h3>
      <p>{tj(lang, "keyed.intro", { base: mono("/api/v1"), auth: mono("Authorization"), xkey: mono("X-Api-Key") })}</p>
      <div class="table-wrap bordered">
        <Table cols={[
          { kind: "file", label: t(lang, "data.col_endpoint") },
          { kind: "main", label: t(lang, "data.col_contents") },
          { kind: "text", label: t(lang, "keyed.col_params") },
        ]}>
          <tbody>
            {KEYED_ENDPOINTS.map((e) => (
              <tr>
                <td data-label={t(lang, "data.col_endpoint")} class="mono">GET {e.path}</td>
                <td data-label={t(lang, "data.col_contents")}>{t(lang, e.text)}</td>
                <td data-label={t(lang, "keyed.col_params")}>{e.params.length ? mono(e.params.join(", ")) : t(lang, "keyed.no_params")}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div class="table-wrap bordered">
        <Table cols={[
          { kind: "label", label: t(lang, "keyed.col_param") },
          { kind: "main", label: t(lang, "keyed.col_values") },
        ]}>
          <tbody>
            {KEYED_PARAMS.map(([name, key]) => (
              <tr>
                <td data-label={t(lang, "keyed.col_param")} class="mono">{name}</td>
                <td data-label={t(lang, "keyed.col_values")}>{t(lang, key, { open: OPEN_Q_MAX, records: RECORD_PAGES_MAX })}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <p>{t(lang, "keyed.answers")}</p>
      <p>
        {ultra
          ? t(lang, "keyed.limits_plans", {
            minute: fmtInt(KEY_PER_MINUTE, lang), day: fmtInt(KEY_PER_DAY, lang), ultra_day: fmtInt(KEY_PER_DAY_ULTRA, lang), address: REQUEST_LIMITS.api,
          })
          : t(lang, "keyed.limits", { minute: fmtInt(KEY_PER_MINUTE, lang), day: fmtInt(KEY_PER_DAY, lang), address: REQUEST_LIMITS.api })}
      </p>
      <p>{t(lang, "keyed.errors")}</p>
      <p>{t(lang, "keyed.example")}</p>
      <pre class="cite-block">{KEYED_EXAMPLE}</pre>
    </>
  );
};
