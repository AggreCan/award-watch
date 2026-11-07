// The calendar files' strings (src/calendar.ts): the "Add to calendar" link
// every notice and contract page carries, and the words inside an event,
// which the per-notice file and a Pro account's feed share. Spread into the
// site's dictionary (src/i18n.ts) like the accounts module's. French follows
// the dictionary's rules: plain spaces and straight apostrophes here, the
// Canadian French forms added when read.

export const CALENDAR_STRINGS = {
  "cal.add": { en: "Add to calendar", fr: "Ajouter au calendrier" },

  // The event's title. A notice without a buyer, or a contract without one,
  // leaves the middle part out.
  "cal.closes": { en: "Closes: {title} · {buyer}", fr: "Clôture : {title} · {buyer}" },
  "cal.closes_alone": { en: "Closes: {title}", fr: "Clôture : {title}" },
  "cal.ends": { en: "Ends: {holder} · {buyer} · {title}", fr: "Prend fin : {holder} · {buyer} · {title}" },
  "cal.ends_alone": { en: "Ends: {holder} · {title}", fr: "Prend fin : {holder} · {title}" },
  // The last event of a feed the cap cut, on the data date.
  "cal.more_closing": { en: "Award Watch: {n} more closing dates, see the site", fr: "Award Watch : {n} autres dates de clôture, voir le site" },
  "cal.more_end": { en: "Award Watch: {n} more end dates, see the site", fr: "Award Watch : {n} autres dates de fin, voir le site" },
  "cal.more_dates": { en: "Award Watch: {n} more dates, see the site", fr: "Award Watch : {n} autres dates, voir le site" },
  "cal.more_text": {
    en: "This feed holds the {max} soonest dates. The rest are on the site: {url}",
    fr: "Ce flux contient les {max} dates les plus proches. Les autres sont sur le site : {url}",
  },

  // CATEGORIES, after "Award Watch".
  "cal.cat_closing": { en: "Closing", fr: "Clôture" },
  "cal.cat_end": { en: "Contract end", fr: "Fin de contrat" },

  // The description, one line each.
  "cal.d_reference": { en: "Reference: {v}", fr: "Référence : {v}" },
  "cal.d_buyer": { en: "Buyer: {v}", fr: "Acheteur : {v}" },
  "cal.d_type": { en: "Notice type: {v}", fr: "Type d'avis : {v}" },
  "cal.d_method": { en: "Procurement method: {v}", fr: "Méthode d'approvisionnement : {v}" },
  "cal.d_segments": { en: "Segments: {v}", fr: "Segments : {v}" },
  "cal.d_regions": { en: "Regions: {v}", fr: "Régions : {v}" },
  "cal.d_first_seen": { en: "First seen: {v}", fr: "Vu pour la première fois : {v}" },
  "cal.d_closing": { en: "Closing as published: {v}, {zone}", fr: "Clôture telle que publiée : {v}, {zone}" },
  "cal.zone_eastern": { en: "Eastern time", fr: "heure de l'Est" },
  "cal.d_cancelled": { en: "The notice was cancelled.", fr: "L'avis a été annulé." },
  "cal.d_cancelled_contract": { en: "The contract was cancelled.", fr: "Le contrat a été annulé." },
  "cal.d_holder": { en: "Holder: {v}", fr: "Titulaire : {v}" },
  "cal.d_value": { en: "Value counted: {v}", fr: "Valeur comptée : {v}" },
  "cal.d_amendments": { en: "Amendments: {n}", fr: "Modifications : {n}" },
  "cal.d_amendments_growth": { en: "Amendments: {n}, value change {growth}", fr: "Modifications : {n}, variation de la valeur {growth}" },
  "cal.d_start": { en: "Start: {v}", fr: "Début : {v}" },
  "cal.d_end": { en: "End: {v}", fr: "Fin : {v}" },
  "cal.d_source": { en: "Source: {v}", fr: "Source : {v}" },
  "cal.d_site": { en: "On Award Watch: {v}", fr: "Sur Award Watch : {v}" },
  "cal.d_canadabuys": { en: "On CanadaBuys: {v}", fr: "Sur AchatsCanada : {v}" },

  // A standing offer's or supply arrangement's expiry, which the watches'
  // feed lists for an organization watch that follows it (src/account/feeds.ts
  // watchEnds): the title, its category and its description's lines.
  "cal.expires": { en: "Expires: {agreement} · {type} · {holder}", fr: "Expire : {agreement} · {type} · {holder}" },
  "cal.expires_untyped": { en: "Expires: {agreement} · {holder}", fr: "Expire : {agreement} · {holder}" },
  "cal.cat_expiry": { en: "Instrument expiry", fr: "Expiration d'instrument" },
  "cal.d_agreement": { en: "Agreement number: {v}", fr: "Numéro de l'accord : {v}" },
  "cal.d_instrument_type": { en: "Type: {v}", fr: "Type : {v}" },
  "cal.d_description": { en: "Description: {v}", fr: "Description : {v}" },
  "cal.d_end_user": { en: "End user: {v}", fr: "Utilisateur final : {v}" },
  "cal.d_expiry": { en: "Expiry: {v}", fr: "Expiration : {v}" },
  "cal.d_holders": { en: "Active holders: {n}", fr: "Titulaires actifs : {n}" },

  // The cap's event when one event is left out (src/calendar.ts capped): a
  // feed whose statements left a single row unread beside the ones it kept.
  "cal.more_closing_one": { en: "Award Watch: 1 more closing date, see the site", fr: "Award Watch : 1 autre date de clôture, voir le site" },
  "cal.more_end_one": { en: "Award Watch: 1 more end date, see the site", fr: "Award Watch : 1 autre date de fin, voir le site" },
  "cal.more_dates_one": { en: "Award Watch: 1 more date, see the site", fr: "Award Watch : 1 autre date, voir le site" },
} as const satisfies Record<string, { en: string; fr: string }>;
