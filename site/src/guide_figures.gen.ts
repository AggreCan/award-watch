// Written by scripts/make-guide-figures.mjs (npm run figures) and by nothing else: each guide figure's image
// sizes and the place of each of its marks, read from the pages rendered from the sample records in site/figures/.
// Do not edit it by hand: change the figure in src/guides.ts or the sample records and run the tool again
// (docs/guides.md, Figures).

import type { FigureEntry } from "./guides";

export const GUIDE_FIGURES: Readonly<Record<string, FigureEntry>> = {
  "new-notices": {
    slug: "how-to-bid-on-government-of-canada-contracts", page: "/tenders/new", region: "section.panel:has(table)",
    targets: [
      ".panel-head",
      "tbody tr:first-child td.c-buyer",
      "tbody tr:first-child td.c-date",
    ],
    en: {
      wide: {"width":838,"height":273,"viewport":1153,"boxes":[[0.84,2.56,98.33,14.65],[53.34,47.07,23.87,26.74],[77.21,47.07,21.96,26.74]]},
      phone: {"width":370,"height":608,"viewport":390,"boxes":[[1.89,1.15,96.22,6.58],[6.22,30.92,87.57,7.89],[6.22,38.82,87.57,8.88]]},
    },
    fr: {
      wide: {"width":838,"height":297,"viewport":1153,"boxes":[[0.84,2.36,98.33,13.47],[53.34,48.65,23.87,24.58],[77.21,48.65,21.96,24.58]]},
      phone: {"width":370,"height":661,"viewport":390,"boxes":[[1.89,1.06,96.22,8.02],[6.22,30.41,87.57,7.26],[6.22,37.67,87.57,8.17]]},
    },
  },
  "award-head": {
    slug: "how-to-bid-on-government-of-canada-contracts", page: "/awards/cw9391528", region: "header.page-head .page-head-row",
    targets: [
      "p.eyebrow, h1",
      "p.page-note",
      ".page-actions",
    ],
    en: {
      wide: {"width":838,"height":180,"viewport":1153,"boxes":[[0.72,3.33,92.75,30],[0.72,56.67,65.04,13.33],[0.72,78.89,53.25,17.78]]},
      phone: {"width":370,"height":240,"viewport":390,"boxes":[[1.62,2.5,96.76,20.83],[1.62,50.83,96.76,10],[1.62,67.5,96.76,30]]},
    },
    fr: {
      wide: {"width":838,"height":180,"viewport":1153,"boxes":[[0.72,3.33,92.75,30],[0.72,56.67,65.04,13.33],[0.72,78.89,60.36,17.78]]},
      phone: {"width":370,"height":270,"viewport":390,"boxes":[[1.62,2.22,96.76,29.63],[1.62,56.3,96.76,8.89],[1.62,71.11,96.76,26.67]]},
    },
  },
  "notice-head": {
    slug: "reading-a-canadabuys-tender-notice", page: "/tenders/cb-900-90000101", region: "header.page-head .page-head-row",
    targets: [
      ".lead",
      ".page-actions a",
      "p.page-note:has(.mono)",
      ".page-note + .page-note",
    ],
    en: {
      wide: {"width":838,"height":188,"viewport":1153,"boxes":[[0.72,36.17,68.56,26.6],[72.14,79.79,27.14,17.02],[0.72,67.02,65.04,8.51],[0.72,79.79,65.04,17.02]]},
      phone: {"width":370,"height":278,"viewport":390,"boxes":[[1.62,33.81,96.76,17.99],[1.62,86.33,61.47,11.51],[1.62,54.68,96.76,5.76],[1.62,63.31,96.76,17.27]]},
    },
    fr: {
      wide: {"width":838,"height":188,"viewport":1153,"boxes":[[0.72,36.17,69.53,26.6],[73.11,79.79,26.17,17.02],[0.72,67.02,65.04,8.51],[0.72,79.79,65.04,17.02]]},
      phone: {"width":370,"height":302,"viewport":390,"boxes":[[1.62,31.13,96.76,24.5],[1.62,87.42,59.27,10.6],[1.62,58.28,96.76,5.3],[1.62,66.23,96.76,15.89]]},
    },
  },
  "notice-dates": {
    slug: "reading-a-canadabuys-tender-notice", page: "/tenders/cb-900-90000101", region: ".panel-grid",
    targets: [
      ":scope > .panel:first-child dl > dt:nth-of-type(2), :scope > .panel:first-child dl > dt:nth-of-type(2) + dd",
      ":scope > .panel:first-child dl > dt:nth-of-type(3), :scope > .panel:first-child dl > dt:nth-of-type(3) + dd",
      ":scope > .panel:last-child dl > dt:nth-of-type(3), :scope > .panel:last-child dl > dt:nth-of-type(3) + dd",
    ],
    en: {
      wide: {"width":838,"height":471,"viewport":1153,"boxes":[[0.84,17.62,98.33,7.86],[0.84,25.48,98.33,7.86],[0.84,90.66,98.33,7.86]]},
      phone: {"width":370,"height":595,"viewport":390,"boxes":[[1.89,13.95,96.22,9.58],[1.89,23.53,96.22,6.22],[1.89,89.24,96.22,9.58]]},
    },
    fr: {
      wide: {"width":838,"height":487,"viewport":1153,"boxes":[[0.84,17.04,98.33,7.6],[0.84,24.64,98.33,7.6],[0.84,90.97,98.33,7.6]]},
      phone: {"width":370,"height":567,"viewport":390,"boxes":[[1.89,14.64,96.22,10.05],[1.89,24.69,96.22,6.53],[1.89,88.71,96.22,10.05]]},
    },
  },
  "notice-procurement": {
    slug: "reading-a-canadabuys-tender-notice", page: "/tenders/cb-900-90000101", region: "section.panel:has(> dl.wide)",
    targets: [
      "dl.wide > dt:nth-of-type(2), dl.wide > dt:nth-of-type(2) + dd",
      "dl.wide > dt:nth-of-type(3), dl.wide > dt:nth-of-type(3) + dd",
      "dl.wide > dt:nth-of-type(5), dl.wide > dt:nth-of-type(5) + dd",
      "dl.wide > dt:nth-of-type(7), dl.wide > dt:nth-of-type(7) + dd",
      "dl.wide > dt:nth-of-type(8), dl.wide > dt:nth-of-type(8) + dd",
    ],
    en: {
      wide: {"width":838,"height":457,"viewport":1153,"boxes":[[0.84,18.16,98.33,8.1],[0.84,26.26,98.33,8.1],[0.84,42.45,98.33,25.6],[0.84,77.9,98.33,12.47],[0.84,90.37,98.33,8.1]]},
      phone: {"width":370,"height":689,"viewport":390,"boxes":[[1.89,12.05,96.22,5.37],[1.89,17.42,96.22,8.27],[1.89,33.96,96.22,37.3],[1.89,79.54,96.22,11.18],[1.89,90.71,96.22,8.27]]},
    },
    fr: {
      wide: {"width":838,"height":477,"viewport":1153,"boxes":[[0.84,17.4,98.33,7.76],[0.84,25.16,98.33,11.95],[0.84,44.86,98.33,24.53],[0.84,78.83,98.33,11.95],[0.84,90.78,98.33,7.76]]},
      phone: {"width":370,"height":737,"viewport":390,"boxes":[[1.89,11.26,96.22,5.02],[1.89,16.28,96.22,7.73],[1.89,34.46,96.22,40.3],[1.89,82.5,96.22,8.82],[1.89,91.32,96.22,7.73]]},
    },
  },
  "trade-line": {
    slug: "trade-agreements-and-thresholds-on-federal-tenders", page: "/tenders/cb-900-90000303", region: "section.panel:has(> dl.wide)",
    targets: [
      "dl.wide > dt:nth-of-type(5), dl.wide > dt:nth-of-type(5) + dd",
      "dl.wide > dt:nth-of-type(6), dl.wide > dt:nth-of-type(6) + dd",
      "dl.wide > dt:nth-of-type(6) + dd li:nth-child(1)",
      "dl.wide > dt:nth-of-type(6) + dd li:nth-child(5)",
    ],
    en: {
      wide: {"width":838,"height":542,"viewport":1153,"boxes":[[0.84,35.79,98.33,6.83],[0.84,42.62,98.33,30.44],[27.33,44.28,69.93,3.69],[27.33,61.99,69.93,3.69]]},
      phone: {"width":370,"height":854,"viewport":390,"boxes":[[1.89,27.4,96.22,9.02],[1.89,36.42,96.22,40.4],[36.49,37.47,57.3,4.68],[36.49,65.11,57.3,4.68]]},
    },
    fr: {
      wide: {"width":838,"height":582,"viewport":1153,"boxes":[[0.84,36.77,98.33,9.79],[0.84,46.56,98.33,28.35],[27.33,48.11,69.93,3.44],[27.33,64.6,69.93,3.44]]},
      phone: {"width":370,"height":874,"viewport":390,"boxes":[[1.89,29.06,96.22,6.52],[1.89,35.58,96.22,44.05],[49.5,36.61,44.29,4.58],[49.5,68.19,44.29,4.58]]},
    },
  },
  "buy-canadian-description": {
    slug: "buy-canadian-policy-on-federal-tenders", page: "/tenders/cb-900-90000606", region: "section.panel:has(.prose)",
    targets: [
      ".panel-head h2",
      ".prose p:nth-child(2)",
      ".prose p:nth-child(3)",
    ],
    en: {
      wide: {"width":838,"height":222,"viewport":1153,"boxes":[[2.74,8.33,23.13,7.21],[2.74,42.79,79.04,32.43],[2.74,78.83,79.04,10.81]]},
      phone: {"width":370,"height":342,"viewport":390,"boxes":[[6.22,5.41,52.39,4.68],[6.22,27.78,87.57,42.11],[6.22,72.22,87.57,21.05]]},
    },
    fr: {
      wide: {"width":838,"height":270,"viewport":1153,"boxes":[[2.74,6.85,18.07,5.93],[2.74,35.19,79.04,35.56],[2.74,73.7,79.04,17.78]]},
      phone: {"width":370,"height":414,"viewport":390,"boxes":[[6.22,4.47,40.93,3.86],[6.22,28.74,87.57,46.38],[6.22,77.05,87.57,17.39]]},
    },
  },
  "security-description": {
    slug: "security-requirements-on-federal-contracts", page: "/tenders/cb-900-90000303", region: "section.panel:has(.prose)",
    targets: [
      ".panel-head h2",
      ".prose p:nth-child(2)",
      ".prose p:nth-child(3)",
    ],
    en: {
      wide: {"width":838,"height":198,"viewport":1153,"boxes":[[2.74,9.34,23.13,8.08],[2.74,47.98,79.04,12.12],[2.74,64.14,79.04,24.24]]},
      phone: {"width":370,"height":318,"viewport":390,"boxes":[[6.22,5.82,52.39,5.03],[6.22,44.97,87.57,15.09],[6.22,62.58,87.57,30.19]]},
    },
    fr: {
      wide: {"width":838,"height":222,"viewport":1153,"boxes":[[2.74,8.33,18.07,7.21],[2.74,53.6,79.04,10.81],[2.74,68.02,79.04,21.62]]},
      phone: {"width":370,"height":318,"viewport":390,"boxes":[[6.22,5.82,40.93,5.03],[6.22,44.97,87.57,15.09],[6.22,62.58,87.57,30.19]]},
    },
  },
  "acan-dates": {
    slug: "advance-contract-award-notices-acan", page: "/tenders/cb-900-90000202", region: ".panel-grid",
    targets: [
      ":scope > .panel:first-child dl > dt:nth-of-type(1), :scope > .panel:first-child dl > dt:nth-of-type(1) + dd",
      ":scope > .panel:first-child dl > dt:nth-of-type(2), :scope > .panel:first-child dl > dt:nth-of-type(2) + dd",
      ":scope > .panel:first-child dl > dt:nth-of-type(3), :scope > .panel:first-child dl > dt:nth-of-type(3) + dd",
    ],
    en: {
      wide: {"width":838,"height":463,"viewport":1153,"boxes":[[0.84,10.15,98.33,7.78],[0.84,17.93,98.33,7.99],[0.84,25.92,98.33,7.99]]},
      phone: {"width":370,"height":567,"viewport":390,"boxes":[[1.89,8.29,96.22,6.35],[1.89,14.64,96.22,10.05],[1.89,24.69,96.22,6.53]]},
    },
    fr: {
      wide: {"width":838,"height":479,"viewport":1153,"boxes":[[0.84,9.81,98.33,7.52],[0.84,17.33,98.33,7.72],[0.84,25.05,98.33,7.72]]},
      phone: {"width":370,"height":547,"viewport":390,"boxes":[[1.89,8.59,96.22,6.58],[1.89,15.17,96.22,10.42],[1.89,25.59,96.22,6.76]]},
    },
  },
  "acan-published": {
    slug: "advance-contract-award-notices-acan", page: "/contracts/nrcan-rncan/C-2026-2027-Q2-90231", region: ".panel-grid > section.panel",
    targets: [
      ":scope > dl > dt:nth-of-type(1), :scope > dl > dt:nth-of-type(1) + dd",
      ":scope > dl > dt:nth-of-type(2), :scope > dl > dt:nth-of-type(2) + dd",
      ":scope > dl > dt:nth-of-type(5), :scope > dl > dt:nth-of-type(5) + dd",
    ],
    en: {
      wide: {"width":557,"height":328,"viewport":1440,"boxes":[[1.35,14.33,97.4,10.98],[1.35,25.3,97.4,12.5],[1.35,60.37,97.4,11.28]]},
      phone: {"width":370,"height":444,"viewport":390,"boxes":[[1.89,10.59,96.22,12.61],[1.89,23.2,96.22,9.23],[1.89,58.11,96.22,12.84]]},
    },
    fr: {
      wide: {"width":557,"height":364,"viewport":1440,"boxes":[[1.35,12.91,97.4,9.89],[1.35,22.8,97.4,11.26],[1.35,54.4,97.4,10.16]]},
      phone: {"width":370,"height":420,"viewport":390,"boxes":[[1.89,11.19,96.22,8.57],[1.89,19.76,96.22,13.57],[1.89,55.71,96.22,13.57]]},
    },
  },
  "instrument-details": {
    slug: "standing-offers-and-supply-arrangements", page: "/instruments/EN578-991533%2F001%2FZT", region: "section.panel:has(> dl.wide)",
    targets: [
      "dl.wide > dt:nth-of-type(1), dl.wide > dt:nth-of-type(1) + dd",
      "dl.wide > dt:nth-of-type(4), dl.wide > dt:nth-of-type(4) + dd",
      "dl.wide > dt:nth-of-type(5), dl.wide > dt:nth-of-type(5) + dd",
      "dl.wide > dt:nth-of-type(7), dl.wide > dt:nth-of-type(7) + dd",
    ],
    en: {
      wide: {"width":838,"height":386,"viewport":1153,"boxes":[[0.84,12.18,98.33,9.33],[0.84,40.67,98.33,9.59],[0.84,50.26,98.33,9.59],[0.84,69.43,98.33,9.59]]},
      phone: {"width":370,"height":546,"viewport":390,"boxes":[[1.89,8.61,96.22,10.26],[1.89,39.74,96.22,10.44],[1.89,50.18,96.22,10.44],[1.89,67.4,96.22,6.78]]},
    },
    fr: {
      wide: {"width":838,"height":386,"viewport":1153,"boxes":[[0.84,12.18,98.33,9.33],[0.84,40.67,98.33,9.59],[0.84,50.26,98.33,9.59],[0.84,69.43,98.33,9.59]]},
      phone: {"width":370,"height":566,"viewport":390,"boxes":[[1.89,8.3,96.22,9.89],[1.89,38.34,96.22,10.07],[1.89,48.41,96.22,10.07],[1.89,65.02,96.22,6.54]]},
    },
  },
  "instrument-holders": {
    slug: "standing-offers-and-supply-arrangements", page: "/instruments/EN578-991533%2F001%2FZT", region: "section.panel:has(#holders)",
    targets: [
      "tbody tr:first-child td:first-child a",
      "tbody tr:first-child td:nth-child(2)",
      "tbody tr:nth-child(3) td:nth-child(4)",
    ],
    en: {
      wide: {"width":838,"height":266,"viewport":1153,"boxes":[[2.74,33.83,23.12,6.02],[48.57,29.89,21.48,21.43],[70.05,65.23,11.46,13.72]]},
      phone: {"width":370,"height":621,"viewport":390,"boxes":[[6.22,9.82,52.88,2.58],[6.22,13.37,87.57,4.51],[6.22,72.95,87.57,4.51]]},
    },
    fr: {
      wide: {"width":838,"height":298,"viewport":1153,"boxes":[[2.74,35.57,23.12,5.37],[48.57,32.05,21.48,19.13],[70.05,63.59,11.46,12.25]]},
      phone: {"width":370,"height":777,"viewport":390,"boxes":[[6.22,7.85,52.88,2.06],[6.22,10.68,87.57,6.18],[6.22,71.17,87.57,6.18]]},
    },
  },
  "psib-published": {
    slug: "indigenous-business-set-asides-psib", page: "/contracts/isc-sac/C-2026-2027-Q2-90117", region: ".panel-grid > section.panel",
    targets: [
      ":scope > dl > dt:nth-of-type(7), :scope > dl > dt:nth-of-type(7) + dd",
      ":scope > dl + p",
      ":scope > p:last-of-type",
    ],
    en: {
      wide: {"width":557,"height":433,"viewport":1440,"boxes":[[1.35,62.82,97.4,13.16],[4.22,79.91,91.65,7.39],[4.22,90.99,91.65,3.7]]},
      phone: {"width":370,"height":605,"viewport":390,"boxes":[[1.89,61.49,96.22,16.03],[6.22,80.33,87.57,7.93],[6.22,90.91,87.57,5.29]]},
    },
    fr: {
      wide: {"width":557,"height":509,"viewport":1440,"boxes":[[1.35,57.37,97.4,19.06],[4.22,79.76,91.65,6.29],[4.22,89.19,91.65,6.29]]},
      phone: {"width":370,"height":617,"viewport":390,"boxes":[[1.89,56.4,96.22,18.96],[6.22,78.12,87.57,10.37],[6.22,91.09,87.57,5.19]]},
    },
  },
  "award-value": {
    slug: "three-records-of-one-federal-contract", page: "/awards/cw9391528", region: ".panel-stack > section.panel:nth-of-type(2)",
    targets: [
      "dl > dt:nth-of-type(1), dl > dt:nth-of-type(1) + dd",
      "dl > dt:nth-of-type(2), dl > dt:nth-of-type(2) + dd",
      "dl > dt:nth-of-type(3), dl > dt:nth-of-type(3) + dd",
    ],
    en: {
      wide: {"width":557,"height":229,"viewport":1440,"boxes":[[1.26,20.52,97.4,15.72],[1.26,36.24,97.4,16.16],[1.26,52.4,97.4,16.16]]},
      phone: {"width":370,"height":305,"viewport":390,"boxes":[[1.89,15.41,96.22,18.36],[1.89,33.77,96.22,25.25],[1.89,59.02,96.22,12.13]]},
    },
    fr: {
      wide: {"width":557,"height":229,"viewport":1440,"boxes":[[1.26,20.52,97.4,15.72],[1.26,36.24,97.4,16.16],[1.26,52.4,97.4,16.16]]},
      phone: {"width":370,"height":285,"viewport":390,"boxes":[[1.89,16.49,96.22,19.65],[1.89,36.14,96.22,20],[1.89,56.14,96.22,12.98]]},
    },
  },
  "history-parties": {
    slug: "three-records-of-one-federal-contract", page: "/history/cw9391528", region: ".panel-stack",
    targets: [
      ":scope > section:nth-of-type(1) dl > dt:nth-of-type(3), :scope > section:nth-of-type(1) dl > dt:nth-of-type(3) + dd",
      ":scope > section:nth-of-type(1) dl > dt:nth-of-type(4), :scope > section:nth-of-type(1) dl > dt:nth-of-type(4) + dd",
      ":scope > section:nth-of-type(2) dl > dt:nth-of-type(2), :scope > section:nth-of-type(2) dl > dt:nth-of-type(2) + dd, :scope > section:nth-of-type(2) dl > dt:nth-of-type(3), :scope > section:nth-of-type(2) dl > dt:nth-of-type(3) + dd",
    ],
    en: {
      wide: {"width":557,"height":692,"viewport":1440,"boxes":[[1.26,17.34,97.4,5.35],[1.26,22.69,97.4,5.35],[1.26,42.77,97.4,10.69]]},
      phone: {"width":370,"height":852,"viewport":390,"boxes":[[1.89,16.43,96.22,6.69],[1.89,23.12,96.22,6.69],[1.89,43.19,96.22,13.38]]},
    },
    fr: {
      wide: {"width":557,"height":692,"viewport":1440,"boxes":[[1.26,17.34,97.4,5.35],[1.26,22.69,97.4,5.35],[1.26,42.77,97.4,10.69]]},
      phone: {"width":370,"height":832,"viewport":390,"boxes":[[1.89,16.83,96.22,6.85],[1.89,23.68,96.22,6.85],[1.89,44.23,96.22,11.3]]},
    },
  },
  "published-value": {
    slug: "three-records-of-one-federal-contract", page: "/contracts/dfo-mpo/C-2026-2027-Q2-90088", region: ".panel-stack > section.panel:nth-of-type(2)",
    targets: [
      "dl > dt:nth-of-type(1), dl > dt:nth-of-type(1) + dd",
      "dl > dt:nth-of-type(2), dl > dt:nth-of-type(2) + dd",
      "dl > dt:nth-of-type(3), dl > dt:nth-of-type(3) + dd",
      "dl > dt:nth-of-type(4), dl > dt:nth-of-type(4) + dd",
    ],
    en: {
      wide: {"width":557,"height":339,"viewport":1440,"boxes":[[1.26,13.86,97.4,10.62],[1.26,24.48,97.4,10.91],[1.26,35.4,97.4,10.91],[1.26,46.31,97.4,10.91]]},
      phone: {"width":370,"height":455,"viewport":390,"boxes":[[1.89,10.33,96.22,12.31],[1.89,22.64,96.22,12.53],[1.89,35.16,96.22,12.53],[1.89,47.69,96.22,12.53]]},
    },
    fr: {
      wide: {"width":557,"height":339,"viewport":1440,"boxes":[[1.26,13.86,97.4,10.62],[1.26,24.48,97.4,10.91],[1.26,35.4,97.4,10.91],[1.26,46.31,97.4,10.91]]},
      phone: {"width":370,"height":491,"viewport":390,"boxes":[[1.89,9.57,96.22,11.41],[1.89,20.98,96.22,11.61],[1.89,32.59,96.22,11.61],[1.89,44.2,96.22,11.61]]},
    },
  },
  "ending-list": {
    slug: "when-a-federal-contract-ends", page: "/expiring/3m", region: "section.panel:has(table)",
    targets: [
      ".panel-head .panel-count",
      "tbody tr:first-child td:first-child",
      "tbody tr:nth-child(2) td.lead-cell > span.small",
    ],
    en: {
      wide: {"width":838,"height":502,"viewport":1153,"boxes":[[96.33,3.69,0.93,3.19],[0.84,25.6,13.37,16.14],[15.16,52.79,15.9,2.99]]},
      phone: {"width":370,"height":1249,"viewport":390,"boxes":[[91.68,1.48,2.1,1.28],[6.22,16.65,87.57,3.84],[6.22,41.47,36.02,1.2]]},
    },
    fr: {
      wide: {"width":838,"height":534,"viewport":1153,"boxes":[[96.33,3.46,0.93,3],[0.84,27.06,13.37,15.17],[15.16,52.62,17.5,2.81]]},
      phone: {"width":370,"height":1327,"viewport":390,"boxes":[[91.68,1.39,2.1,1.21],[6.22,15.67,87.57,3.62],[6.22,40.09,39.65,1.13]]},
    },
  },
};
