// The organizations in the landing page's scrolling band (src/pages/landing.tsx):
// forty of the largest award holders in the public records, each a link to its
// profile. The band's copy says the site holds records on them and never
// implies that they use or endorse the site (counsel's condition, 2026-11-08;
// docs/landing.md).
//
// domain names the organization's own website, for its logo from Brandfetch's
// Logo API: the page embeds the logo link in an <img> while the Worker has a
// client id (env.BRANDFETCH_CLIENT_ID), and shows the name alone otherwise.
// No logo image is ever fetched, cached or stored by the site; the browser
// asks Brandfetch for it, as Brandfetch's terms require.

export interface LandingOrg {
  id: string;
  name: string;
  domain: string;
}

// The two rows of the band, in the order they scroll: the first row moves left,
// the second right.
export const LANDING_ORGS_A: readonly LandingOrg[] = [
  { id: "org-feeb4d85db", name: "Chantier Davie", domain: "davie.ca" },
  { id: "org-31379410ac", name: "General Dynamics", domain: "gd.com" },
  { id: "org-8b5c2838ad", name: "IBM Canada", domain: "ibm.com" },
  { id: "org-51278ffa03", name: "Deloitte", domain: "deloitte.com" },
  { id: "org-4ef5847ca9", name: "Accenture", domain: "accenture.com" },
  { id: "org-f749e7bf72", name: "PwC", domain: "pwc.com" },
  { id: "org-58a73fddc8", name: "Thales", domain: "thalesgroup.com" },
  { id: "org-0b9a1b5863", name: "Lockheed Martin Canada", domain: "lockheedmartin.com" },
  { id: "org-73bbe27dd5", name: "Bombardier", domain: "bombardier.com" },
  { id: "org-269e65b4fe", name: "WSP", domain: "wsp.com" },
  { id: "org-aaaf31bf3d", name: "EllisDon", domain: "ellisdon.com" },
  { id: "org-5e7f72534e", name: "PCL", domain: "pcl.com" },
  { id: "org-caf04790c0", name: "Irving Shipbuilding", domain: "irvingshipbuilding.com" },
  { id: "org-a9f1e3f4c1", name: "Babcock Canada", domain: "babcockcanada.com" },
  { id: "org-a08996242a", name: "Bell", domain: "bell.ca" },
  { id: "org-27d3175ce9", name: "Oracle Canada", domain: "oracle.com" },
  { id: "org-53efffd84f", name: "DXC Technology", domain: "dxc.com" },
  { id: "org-87418829a7", name: "Raytheon Canada", domain: "rtx.com" },
  { id: "org-f742649a34", name: "Rheinmetall Canada", domain: "rheinmetall.ca" },
  { id: "org-e46c9f1aa5", name: "L3Harris", domain: "l3harris.com" },
];

export const LANDING_ORGS_B: readonly LandingOrg[] = [
  { id: "org-77ed664e0c", name: "Calian", domain: "calian.com" },
  { id: "org-70fc77be3d", name: "MDA", domain: "mda.space" },
  { id: "org-07cf1e6800", name: "Telesat", domain: "telesat.com" },
  { id: "org-a60e99aca1", name: "Pfizer Canada", domain: "pfizer.ca" },
  { id: "org-1003493162", name: "Sanofi Pasteur", domain: "sanofi.ca" },
  { id: "org-0b08d0eefa", name: "Merck Canada", domain: "merck.ca" },
  { id: "org-83c0ed95a8", name: "Sun Life", domain: "sunlife.ca" },
  { id: "org-f446692cbf", name: "Canada Life", domain: "canadalife.com" },
  { id: "org-dad3143611", name: "Moneris", domain: "moneris.com" },
  { id: "org-bbff025323", name: "TEKsystems", domain: "teksystems.com" },
  { id: "org-8e325d850b", name: "S.I. Systems", domain: "sisystems.com" },
  { id: "org-7572052cb5", name: "Medavie", domain: "medavie.ca" },
  { id: "org-286e21da38", name: "Parsons", domain: "parsons.com" },
  { id: "org-dc3562afa7", name: "Sikorsky", domain: "sikorsky.com" },
  { id: "org-15c6048fdd", name: "Leonardo", domain: "leonardo.com" },
  { id: "org-f626a9b4c9", name: "General Atomics", domain: "ga-asi.com" },
  { id: "org-346728e161", name: "Pomerleau", domain: "pomerleau.ca" },
  { id: "org-1b9fe9aed6", name: "BGIS", domain: "bgis.com" },
  { id: "org-98a8b3db65", name: "Vancouver Shipyards", domain: "seaspan.com" },
  { id: "org-299675f626", name: "Imperial Oil", domain: "imperialoil.ca" },
];

export const LANDING_ORGS: readonly LandingOrg[] = [...LANDING_ORGS_A, ...LANDING_ORGS_B];

// The logo link Brandfetch documents for an <img> (docs.brandfetch.com,
// Logo API): the organization's domain, an 80 px square (twice the 40 px
// tile, for high-density screens), a lettermark where Brandfetch holds no
// logo, and the client id. Nothing here requests it.
export function brandfetchLogoUrl(domain: string, clientId: string): string {
  return `https://cdn.brandfetch.io/domain/${encodeURIComponent(domain)}/w/80/h/80/fallback/lettermark?c=${encodeURIComponent(clientId)}`;
}
