// A profile's corporate family (operator ruling of 2026-11-07): the members
// side by side, each with its own record count and linked to its own
// profile, never a combined figure. The export adds `family` to a profile
// in a family; a profile without it, and an export from before families,
// show no section.
import { describe, expect, it } from "vitest";
import { profileFamily } from "../src/data";
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
