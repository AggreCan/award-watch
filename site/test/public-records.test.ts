// The organization profile's record sections: each of the five sources in
// its own section, with its newest rows, its own totals and a link to the
// government's record of each row; the figures by year with the
// non-competitive share and what it is a share of; the published responses
// and corrections from the forms database.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { awardNoticeUrl, contractSearchUrl, grantUrl, lobbyUrl, tenderNoticeUrl } from "../src/pages/shared";
import { testEnv } from "./assets";

const html = async (path: string) => (await app.request(path, {}, testEnv())).text();
const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const section = (page: string, id: string) => {
  const start = page.indexOf(`<h2 id="${id}">`);
  return page.slice(start, page.indexOf("<h2 id=", start + 1));
};

describe("organization profile", () => {
  it("names the organization, its other spellings, its places, its registry match and its record span", async () => {
    const page = await html("/organizations/org-a000000001");
    expect(page).toContain("<h1>Exemplar Translation Services Inc.</h1>");
    expect(page).toContain('<p class="lead">Ottawa, Ontario</p>');
    expect(page).toContain("Also recorded as: EXEMPLAR TRANSLATION SERVICES INC");
    expect(page).toContain("Records from 2024-03-04 to 2026-09-15. Business number 000000001.");
    expect(page).toContain("Gatineau, Quebec");
    expect(page).toContain("Records under this name at 2 addresses.");
    expect(page).toContain("EXEMPLAR TRANSLATION SERVICES INC. <span class=\"mono\">0000001</span>, Active, registered 2009-05-01");
    expect(page).toContain("Exact name match");
    // One address: no note about shared names.
    expect(await html("/organizations/org-a000000002")).not.toContain("Records under this name at");
  });

  it("shows one tile per source, in short form, and says the sources are never added", async () => {
    const page = await html("/organizations/org-a000000001");
    // The short form with its exact value as its title, for the tip; $250,000 is exact as it stands.
    expect(page).toContain('<span class="tile-label">Published contracts</span><span class="tile-value" title="$1,875,000" data-tip="">$1.9M</span><span class="tile-note">101 records</span>');
    expect(page).toContain('<span class="tile-label">Award notices</span><span class="tile-value">$250,000</span><span class="tile-note">1 record</span>');
    expect(page).toContain('<p class="tiles-note">Each source is totalled separately (<a href="/methodology#counting">Methodology</a>).</p>');
    expect(page).not.toMatch(/Total across|Grand total/);
  });

  it("gives the figures by year with the non-competitive share and what it is a share of", async () => {
    const page = await html("/organizations/org-a000000001");
    const years = section(page, "years");
    // The share and its percentage; the whole is the Records or Value cell beside it.
    expect(years).toContain('<td data-label="Records" class="mono num">60</td>');
    expect(years).toContain('<td data-label="Non-competitive, by count" class="mono num">3 (5%)</td>');
    // The share by value rests on medium screens, so the table fits beside the rail.
    expect(years).toContain('<td data-label="Non-competitive, by value" class="mono num mdh">$54,000 (5%)</td>');
    expect(years).toContain('<td data-label="Non-competitive, by count" class="mono num">0 (0%)</td>');
    expect(years).toContain('class="chart-stack"');
    const grants = section(await html("/organizations/org-a000000002"), "years");
    expect(grants).toContain('<td data-label="Non-competitive, by count" class="mono num">Not applicable</td>');
  });

  it("lists the newest rows of each source with a link to the record, and where the rest are", async () => {
    const page = await html("/organizations/org-a000000001");
    const awards = section(page, "awards");
    expect(awards).toContain('<a href="/awards/cb-400-40000004">Translation standing offer, official languages</a>');
    expect(awards).toContain('<a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a>');
    expect(awards).toContain('<span class="flag flag-yes" title="The source records the contract as awarded through a competition');
    const contracts = section(page, "contracts");
    expect(contracts.match(/<tr>/g)?.length).toBe(101);
    expect(contracts).toContain(`<a href="${contractSearchUrl("C-2026-000")}" class="mono wrap" rel="nofollow noopener">C-2026-000</a>`);
    expect(contracts).toContain("Value as last reported: $36,001");
    expect(contracts).toContain('<span class="flag flag-unstated" title="The source leaves the procurement method blank for this record.">Method not stated</span>');
    expect(contracts).toContain('Showing the newest 100 of 101 records. The other one is in <a href="https://open.canada.ca/data/en/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b">the publisher&#39;s file</a>.');
    expect(contracts).toContain("1 record in another currency is shown with its currency and left out of the totals.");
    const lobbying = section(page, "lobbying");
    expect(lobbying).toContain("Example Officeholder, Assistant Deputy Minister, Public Services and Procurement Canada (PSPC)");
    expect(lobbying).toContain(`<a href="${lobbyUrl("500001")}" class="mono" rel="nofollow noopener">500001</a>`);
    // The sources with no record of the organization: one line after the lists, no empty panels, no link from their tiles.
    expect(page).not.toContain('<h2 id="history">');
    expect(page).not.toContain('<h2 id="grants">');
    expect(page).toContain('<p class="sources-line">No record in PSPC contract history or grants and contributions names this organization.</p>');
    expect(page).toContain('<div class="tile"><span class="tile-label">PSPC contract history</span>');
    expect(page).toContain('<a class="tile" href="#contracts"><span class="tile-label">Published contracts</span>');
    expect(page.indexOf('class="sources-line"')).toBeGreaterThan(page.indexOf('<h2 id="lobbying">'));

    const two = await html("/organizations/org-a000000002");
    const history = section(two, "history");
    expect(history).toContain('<a href="/history/w8472-000633">Vessel refit, mid-shore patrol</a>');
    expect(history).toContain('<th class="k-buyer mdh"><button type="button" class="th-sort">Client department</button></th>');
    expect(history).toContain('<span class="flag flag-no" title="The source&#39;s own term for a contract awarded without a competition');
    const grants = section(two, "grants");
    expect(grants).toContain(`<a href="${grantUrl("dfo-mpo", "GC-2025-0099")}" class="mono wrap" rel="nofollow noopener">GC-2025-0099</a>`);
    expect(grants).toContain("Small Craft Harbours");
    expect(grants).toContain(">Contribution</td>");
    // A cancelled notice is marked as such where it is listed.
    expect(section(two, "awards")).toContain('<span class="badge badge-cancelled">Cancelled</span>');
  });

  it("lists the main buyers per source", async () => {
    const buyers = section(await html("/organizations/org-a000000001"), "buyers");
    expect(buyers).toContain('<a href="/buyers/dfo-mpo">Fisheries and Oceans Canada</a>');
    expect(buyers).toContain('<td data-label="Value" class="mono num">$1,875,000</td>');
  });

  it("shows only the published responses and corrections, with their dates", async () => {
    const one = await html("/organizations/org-a000000001");
    expect(section(one, "responses")).toContain("The 2026 standing offer covers translation services for three departments");
    expect(section(one, "responses")).toContain("Received 2026-10-20");
    expect(one).not.toContain("A second statement that is still under review.");
    expect(one).not.toContain("office@example.invalid");
    expect(section(one, "corrections")).toContain("No correction to this profile so far.");
    const two = await html("/organizations/org-a000000002");
    expect(section(two, "corrections")).toContain("The city shown was the old head office");
    expect(section(two, "responses")).toContain("The organization has not published a response.");
  });

  it("reads in French", async () => {
    const page = nbsp(await html("/organizations/org-a000000002?lang=fr"));
    expect(page).toContain("Historique des contrats de SPAC");
    expect(page).toContain("Ports pour petits bateaux");
    expect(page).toContain("Pêches et Océans Canada");
    expect(page).toContain("Non concurrentiel");
    expect(page).toContain("1 (100 %)");
    expect(page).toContain("Sans objet");
  });
});

describe("record links", () => {
  it("are built the way each publisher's own pages are", () => {
    expect(tenderNoticeUrl("CB-100-10000001")).toBe("https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/cb-100-10000001");
    expect(awardNoticeUrl("cb-400-40000004")).toBe("https://canadabuys.canada.ca/en/tender-opportunities/award-notice/cb-400-40000004");
    expect(tenderNoticeUrl("CB-100-10000001", "fr")).toBe("https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/cb-100-10000001");
    expect(awardNoticeUrl("cb-400-40000004", "fr")).toBe("https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/cb-400-40000004");
    expect(grantUrl("dfo-mpo", "GC 1")).toBe("https://search.open.canada.ca/grants/record/dfo-mpo%2CGC%201%2Ccurrent");
    expect(contractSearchUrl("C-1&x")).toBe("https://search.open.canada.ca/contracts/?search_text=C-1%26x");
    expect(lobbyUrl("5 1")).toBe("https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/cmmLgPblcVw?comlogId=5%201");
  });
});
