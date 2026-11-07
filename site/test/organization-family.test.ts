// A profile's corporate family (operator ruling of 2026-11-07): the members
// side by side, each with its own record count and linked to its own
// profile, never a combined figure. The export adds `family` to a profile
// in a family; a profile without it, and an export from before families,
// show no section.
import { describe, expect, it } from "vitest";
import { profileAliases, profileFamily } from "../src/data";
import { app } from "../src/index";
import { familyTie } from "../src/pages/organization";
import profiles from "./fixtures/profiles-a00.json";
import { makeFakeAssets, testEnv } from "./assets";

const EM_DASH = String.fromCharCode(0x2014);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const ID = "org-a000000001";

const FAMILY = {
  name: "Exemplar Group",
  members: [
    { id: "org-a000000003", display_name: "Exemplar Holdings Ltd.", n_records: 1204, note: null },
    { id: ID, display_name: "Exemplar Translation Services Inc.", n_records: 103, note: "subsidiary" },
    { id: "org-a000000004", display_name: "Exemplar Atlantic Inc.", n_records: 12, note: "affiliate" },
    { id: "org-a000000005", display_name: "Exemplar-Harbour JV", n_records: 3, note: "joint venture" },
  ],
};

const withFamily = (family: unknown, id = ID) => {
  const shard = structuredClone(profiles) as Record<string, Record<string, unknown>>;
  shard[id].family = family;
  return testEnv(makeFakeAssets({}, { "profiles/a00.json": shard }));
};

const profilePage = async (env: object, lang = "") =>
  nbsp(await (await app.request(`/organizations/${ID}${lang ? `?lang=${lang}` : ""}`, {}, env)).text());

// The family panel, from its head to the end of its section.
const panel = (html: string) => {
  const start = html.indexOf('<h2 id="family">');
  if (start < 0) return "";
  const section = html.lastIndexOf("<section", start);
  return html.slice(section, html.indexOf("</section>", start) + "</section>".length);
};

describe("a profile's corporate family", () => {
  it("lists every member with its own records, linked to its own profile, the profile's own row marked and not linked", async () => {
    const html = await profilePage(withFamily(FAMILY));
    const family = panel(html);
    expect(family).toContain("<h2 id=\"family\">Corporate Family</h2>");
    expect(family).toContain('<span class="panel-count">4 profiles</span>');
    expect(family).toContain("Profiles grouped under <strong>Exemplar Group</strong>.");
    // A table on the column system, sorted in the browser like the others.
    expect(family).toMatch(/<table class="restack cols family" style="--tmin:[^"]+" data-sorting="client">/);
    for (const head of ["Organization", "Relationship", "Records"]) expect(family).toContain(`<button type="button" class="th-sort">${head}</button>`);
    expect(family).toContain('<td data-label="Organization"><a href="/organizations/org-a000000003">Exemplar Holdings Ltd.</a></td><td data-label="Relationship"></td><td data-label="Records" class="mono num">1,204</td>');
    expect(family).toContain('<tr class="family-self"><td data-label="Organization">Exemplar Translation Services Inc. <span class="muted small">(this profile)</span></td><td data-label="Relationship">Subsidiary</td><td data-label="Records" class="mono num">103</td></tr>');
    expect(family).not.toContain(`href="/organizations/${ID}"`);
    expect(family).toContain('<a href="/organizations/org-a000000004">Exemplar Atlantic Inc.</a></td><td data-label="Relationship">Affiliate</td>');
    expect(family).toContain('<td data-label="Relationship">Joint venture</td>');
    // The export's order, most records first, kept.
    const order = ["Exemplar Holdings Ltd.", "Exemplar Translation Services Inc.", "Exemplar Atlantic Inc.", "Exemplar-Harbour JV"].map((n) => family.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(family).toContain("Each member's figures are its own; the site adds nothing across profiles.".replace("'", "&#39;"));
    expect(html).toContain('<script type="module" src="/sort.js"></script>');
    expect(html).not.toContain(EM_DASH);
  });

  it("adds nothing across members: no total row, no sum of the counts anywhere on the page", async () => {
    const html = await profilePage(withFamily(FAMILY));
    const family = panel(html);
    expect(family.match(/<tr[ >]/g)).toHaveLength(5); // the head row and the four members
    expect(family).not.toMatch(/total|sum|combined/i);
    expect(family).not.toContain("<tfoot");
    const sum = 1204 + 103 + 12 + 3;
    for (const figure of [String(sum), sum.toLocaleString("en-CA"), String(sum - 103), (sum - 103).toLocaleString("en-CA")]) {
      expect(html, figure).not.toContain(figure);
    }
  });

  it("reads in French", async () => {
    const html = await profilePage(withFamily(FAMILY), "fr");
    const family = panel(html);
    expect(family).toContain("<h2 id=\"family\">Famille d’entreprises</h2>");
    expect(family).toContain("4 profils");
    expect(family).toContain("Profils regroupés sous <strong>Exemplar Group</strong>.");
    expect(family).toContain("(ce profil)");
    for (const word of ["Filiale", "Société affiliée", "Coentreprise", "Lien", "Dossiers", "Organisation"]) expect(family).toContain(word);
    expect(family).toContain("1 204");
    expect(family).toContain("Les chiffres de chaque membre sont les siens; le site n’additionne rien d’un profil à l’autre.");
    for (const english of ["Corporate Family", "this profile", "Subsidiary", "Each member"]) expect(family).not.toContain(english);
    expect(html).not.toContain(EM_DASH);
  });

  it("is absent from a profile without a family, from the fixtures' export, and when the field is the wrong shape", async () => {
    expect(panel(await profilePage(testEnv()))).toBe("");
    expect(await profilePage(testEnv())).not.toContain("Corporate Family");
    for (const bad of [null, "Exemplar Group", { name: "Exemplar Group" }, { name: "", members: FAMILY.members }, { name: "X", members: [] },
      { name: "X", members: [{ id: "not-an-id", display_name: "A", n_records: 1, note: null }] },
      { name: "X", members: [{ id: ID, display_name: "A", n_records: -1, note: null }] },
      { name: "X", members: [{ id: ID, display_name: "A", n_records: 1, note: 3 }] }]) {
      const res = await app.request(`/organizations/${ID}`, {}, withFamily(bad));
      // A bad family never takes the profile down with it.
      expect(res.status, JSON.stringify(bad)).toBe(200);
      expect(await res.text(), JSON.stringify(bad)).not.toContain('<h2 id="family">');
    }
  });

  it("reads the field tolerantly and names only the seed's three ties", () => {
    expect(profileFamily({})).toBeNull();
    expect(profileFamily({ family: FAMILY })?.members.map((m) => m.note)).toEqual([null, "subsidiary", "affiliate", "joint venture"]);
    // A member without a note reads as none.
    expect(profileFamily({ family: { name: "X", members: [{ id: ID, display_name: "A", n_records: 2 }] } })?.members[0].note).toBeNull();
    expect(familyTie("en", "joint_venture")).toBe("Joint venture");
    expect(familyTie("en", "Joint-Venture")).toBe("Joint venture");
    expect(familyTie("en", "parent")).toBe("");
    expect(familyTie("fr", null)).toBe("");
  });
});

// "Also appears as" (the alias export carrying names, 2026-11-07): the names
// of the retired ids whose records the profile took, each with the alias
// seed's note word, under the profile's head; nothing when the export has no
// names. The families paragraph on the methodology page beside it.
describe("the names a profile also appears under", () => {
  // The export's shape: {id, name, note, reason}, the ones with a note first, at most 12, and
  // aliases_total_rows when there are more.
  const ALIASES = [
    { id: "org-a00000000f", name: "Exemplar Translations Ltd.", note: "former", reason: "seed" },
    { id: "org-a00000000c", name: "EXEMPLAR TRANSLATION SERVICES INC", note: "spelling", reason: "spelling" },
    { id: "org-a00000000b", name: "Exemplar TS", note: "short", reason: "seed" },
    { id: "org-a00000000a", name: "Exemplar Translation Services Inc. Atlantic Branch", note: "branch", reason: "seed" },
    // No seed word (a merge made by a rule): the name alone.
    { id: "org-a000000009", name: "Exemplar Translation Svcs", note: null, reason: "truncation" },
  ];
  const withAliases = (aliases: unknown, total?: number) => {
    const shard = structuredClone(profiles) as Record<string, Record<string, unknown>>;
    shard[ID].aliases = aliases;
    if (total !== undefined) shard[ID].aliases_total_rows = total;
    return testEnv(makeFakeAssets({}, { "profiles/a00.json": shard }));
  };
  const line = (html: string) => /<p class="page-note org-aliases">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";

  it("lists each retired name with its note word under the head, in both languages", async () => {
    const html = await profilePage(withAliases(ALIASES));
    expect(line(html)).toBe(
      "Also appears as: <span>Exemplar Translations Ltd.</span><span class=\"muted\"> (former name)</span>; " +
      "<span>EXEMPLAR TRANSLATION SERVICES INC</span><span class=\"muted\"> (spelling)</span>; " +
      "<span>Exemplar TS</span><span class=\"muted\"> (short form)</span>; " +
      "<span>Exemplar Translation Services Inc. Atlantic Branch</span><span class=\"muted\"> (branch)</span>; " +
      "<span>Exemplar Translation Svcs</span>",
    );
    // Under the head's title, before the first panel.
    expect(html.indexOf("org-aliases")).toBeGreaterThan(html.indexOf("<h1"));
    expect(html.indexOf("org-aliases")).toBeLessThan(html.indexOf('<section class="tiles"'));
    // A name listed here is not listed again among the spellings the records carry.
    expect(html).not.toContain("Also recorded as:");
    const fr = await profilePage(withAliases(ALIASES), "fr");
    expect(line(fr)).toContain("Apparaît aussi sous : <span>Exemplar Translations Ltd.</span><span class=\"muted\"> (ancien nom)</span>");
    for (const word of ["(graphie)", "(forme abrégée)", "(succursale)"]) expect(line(fr)).toContain(word);
    for (const english of ["Also appears as", "former name", "short form"]) expect(fr).not.toContain(english);
    for (const page of [html, fr]) expect(page).not.toContain(EM_DASH);
  });

  it("lists what the export lists and says how many more from aliases_total_rows, each name once and never the profile's own", async () => {
    const twelve = [
      { id: "org-b000000000", name: "Exemplar Translation Services Inc.", note: "spelling", reason: "seed" },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `org-b0000000${String(i + 1).padStart(2, "0")}`, name: `Exemplar Name ${i + 1}`, note: "spelling", reason: "seed" })),
      { id: "org-b000000099", name: "exemplar  name 1", note: "former", reason: "seed" },
    ];
    const text = line(await profilePage(withAliases(twelve, 20)));
    expect(text).not.toContain("<span>Exemplar Translation Services Inc.</span>");
    expect(text.match(/<span>Exemplar Name/g)).toHaveLength(10);
    expect(text).toContain("<span>Exemplar Name 10</span>");
    expect(text).not.toContain("former name");
    // 20 retired ids, 12 listed: 8 more.
    expect(text).toContain('<span class="muted">; and 8 more</span>');
    expect(line(await profilePage(withAliases(twelve, 20), "fr"))).toContain("et 8 autres");
    // No total, or one no larger than the list: nothing more to say.
    for (const total of [undefined, 12, 3]) expect(line(await profilePage(withAliases(twelve, total)))).not.toContain("more");
    // A list longer than the export's cap shows its first 12 and counts the rest.
    const long = Array.from({ length: 15 }, (_, i) => ({ id: `org-c0000000${String(i).padStart(2, "0")}`, name: `Long Name ${i}`, note: null }));
    const longLine = line(await profilePage(withAliases(long)));
    expect(longLine.match(/<span>Long Name/g)).toHaveLength(12);
    expect(longLine).toContain("; and 3 more");
  });

  it("is absent when the export carries no names, and a malformed field never takes the profile down", async () => {
    const plain = await profilePage(testEnv());
    expect(plain).not.toContain("org-aliases");
    expect(plain).toContain("Also recorded as:");
    for (const bad of [null, "Exemplar", {}, [], [null, 3, { name: "" }, { note: "former" }, { name: 7 }]]) {
      const res = await app.request(`/organizations/${ID}`, {}, withAliases(bad));
      expect(res.status, JSON.stringify(bad)).toBe(200);
      expect(await res.text(), JSON.stringify(bad)).not.toContain("org-aliases");
    }
  });

  it("reads the field tolerantly: the seed's four words, any other word or none showing the name alone", () => {
    expect(profileAliases({})).toEqual({ names: [], more: 0 });
    expect(profileAliases({ aliases: [{ name: " A  Name ", note: "former" }, { name: "B", note: "typo" }, { name: "C" }], aliases_total_rows: 5 }))
      .toEqual({ names: [{ name: "A Name", note: "former" }, { name: "B", note: null }, { name: "C", note: null }], more: 2 });
    expect(profileAliases({ aliases: [{ name: "A" }], aliases_total_rows: "many" })).toEqual({ names: [{ name: "A", note: null }], more: 0 });
  });

  it("redirects a retired id whose alias entry carries its name and note beside the live id", async () => {
    const env = testEnv(makeFakeAssets({}, {
      "aliases/a0.json": { "org-a00000000f": { to: ID, name: "Exemplar Translations Ltd.", note: "former" }, "org-a00000000e": { to: "org-a00000000e" } },
    }));
    const moved = await app.request("/organizations/org-a00000000f", {}, env);
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe(`/organizations/${ID}`);
    // An entry pointing at itself is still no alias.
    expect((await app.request("/organizations/org-a00000000e", {}, env)).status).toBe(404);
  });

  it("explains families on the methodology page's identity section, in both languages", async () => {
    const en = nbsp(await (await app.request("/methodology", {}, testEnv())).text());
    const identity = en.slice(en.indexOf('<h2 id="organizations">'), en.indexOf('<h2 id="buyers">'));
    expect(identity).toContain("Some organizations belong to a corporate family");
    expect(identity).toContain("are never added together.");
    const fr = nbsp(await (await app.request("/methodology?lang=fr", {}, testEnv())).text());
    expect(fr).toContain("Certaines organisations appartiennent à une famille d");
    expect(fr).not.toContain("Some organizations belong to a corporate family");
  });
});
