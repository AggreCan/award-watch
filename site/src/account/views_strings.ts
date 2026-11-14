// The strings of saved analytics views and their email (src/account/saved_views.ts,
// view_pages.tsx, view_mail.ts; docs/accounts.md, Saved views), in English and
// French, spread into the site's dictionary (src/i18n.ts) as the dashboard's
// are. French is written with plain spaces and straight apostrophes; the
// dictionary's typography pass adds the Canadian French forms when they are
// read. None of these reach a page while the switch is off, and no line that
// names Ultra reaches one while Ultra is not on sale.

export const VIEWS_STRINGS = {
  // The plan cards' rows (src/pro.tsx PLAN_ROWS): each plan's own figure, and Ultra's own row.
  "plans.saved_views": { en: "{n} saved analytics views", fr: "{n} vues d'analyse enregistrées" },
  "plans.view_mail": { en: "Saved views by email, weekly or monthly", fr: "Vues par courriel, chaque semaine ou mois" },

  // -- the Save control on a view (src/pages/analytics.tsx) ------------------------------------------
  "views.save": { en: "Save this view", fr: "Enregistrer cette vue" },
  "views.saved": { en: "Saved to your views.", fr: "Enregistrée dans vos vues." },
  "views.manage": { en: "Your saved views", fr: "Vos vues enregistrées" },
  "views.name": { en: "Name", fr: "Nom" },
  "views.name_hint": {
    en: "Up to 60 characters. Left empty, the site's label is used.",
    fr: "Jusqu'à 60 caractères. Laissé vide, l'étiquette du site s'applique.",
  },
  // The site's label of a view when the reader types no name: "National Defence, published contracts, 2016-17 to 2025-26".
  "views.label": { en: "{name}, {source}, {first} to {last}", fr: "{name}, {source}, {first} à {last}" },

  // -- /account/views ----------------------------------------------------------------------------------
  "views.title": { en: "Saved Views", fr: "Vues enregistrées" },
  "views.lead": {
    en: "Analytics views kept with their source, period and choices. Each opens as you saved it.",
    fr: "Des vues d'analyse conservées avec leur source, leur période et leurs choix. Chacune s'ouvre telle que vous l'avez enregistrée.",
  },
  "views.count": { en: "{n} of {cap} views", fr: "{n} vues sur {cap}" },
  "views.full": {
    en: "This account holds its {cap} saved views. Remove one to save another.",
    fr: "Ce compte conserve ses {cap} vues enregistrées. Retirez-en une pour en enregistrer une autre.",
  },
  "views.over_cap": {
    en: "This account holds {n} saved views, past the {cap} of its plan. All are kept, and those past the first {cap} are marked; remove some to save another.",
    fr: "Ce compte conserve {n} vues enregistrées, au-delà des {cap} de son forfait. Toutes sont gardées, et celles qui dépassent les {cap} premières sont marquées; retirez-en pour en enregistrer une autre.",
  },
  // The mark of a view past the plan's figure, after a move to a smaller plan.
  "views.past": { en: "Past this plan's number of views", fr: "Au-delà du nombre de vues de ce forfait" },
  "views.none": {
    en: "No saved view yet. Open an analytics view of a buyer, an organization or a segment and press Save this view.",
    fr: "Aucune vue enregistrée pour le moment. Ouvrez une vue d'analyse d'un acheteur, d'une organisation ou d'un segment et appuyez sur Enregistrer cette vue.",
  },
  "views.col_view": { en: "View", fr: "Vue" },
  "views.col_email": { en: "Email", fr: "Courriel" },
  "views.col_remove": { en: "Remove", fr: "Retirer" },
  "views.remove": { en: "Remove", fr: "Retirer" },
  "views.deliver_weekly": { en: "Weekly", fr: "Chaque semaine" },
  "views.deliver_monthly": { en: "Monthly", fr: "Chaque mois" },
  "views.deliver_off": { en: "Off", fr: "Désactivé" },
  "views.deliver_save": { en: "Save", fr: "Enregistrer" },
  // The gate lines: Pro and Ultra while Ultra is on sale, Pro alone otherwise.
  "views.gate": {
    en: "Saving views is part of Pro, which keeps {pro}, and of Ultra, which keeps {ultra}.",
    fr: "L'enregistrement de vues fait partie de Pro, qui en conserve {pro}, et d'Ultra, qui en conserve {ultra}.",
  },
  "views.gate_pro": { en: "Saving views is part of Pro, which keeps {pro}.", fr: "L'enregistrement de vues fait partie de Pro, qui en conserve {pro}." },
  "views.deliver_gate": {
    en: "Off. Email delivery of saved views is part of Ultra.",
    fr: "Désactivé. L'envoi des vues enregistrées par courriel fait partie d'Ultra.",
  },
  // A view's last delivery, under its select.
  "views.last_none": { en: "No message yet.", fr: "Aucun message pour le moment." },
  "views.last_sent": { en: "Sent {time}.", fr: "Envoyée {time}." },
  "views.last_failed": { en: "Not sent {time}: the mail service refused it.", fr: "Non envoyée {time} : le service de courriel l'a refusée." },
  "views.last_same": { en: "Checked {time}: nothing changed, no message.", fr: "Vérifiée {time} : rien n'a changé, aucun message." },
  "views.msg_removed": { en: "The view was removed.", fr: "La vue a été retirée." },
  "views.msg_changed": { en: "The view's email was changed.", fr: "Le courriel de la vue a été modifié." },

  // -- the analytics index's panel (src/pages/analytics_index.tsx) ------------------------------------
  "views.index_none": {
    en: "Press Save this view on an analytics view to keep it here with its source, period and choices.",
    fr: "Appuyez sur Enregistrer cette vue dans une vue d'analyse pour la garder ici avec sa source, sa période et ses choix.",
  },

  // -- the privacy page (src/account/privacy.tsx) -------------------------------------------------------
  "views.privacy": {
    en: "A saved analytics view keeps the view's address on the site (its source, period and choices), the name you gave it and its language. Saved views are deleted with the account.",
    fr: "Une vue d'analyse enregistrée conserve l'adresse de la vue sur le site (sa source, sa période et ses choix), le nom que vous lui avez donné et sa langue. Les vues enregistrées sont supprimées avec le compte.",
  },
  // While Ultra is on sale.
  "views.privacy_mail": {
    en: "A view sent by email also keeps whether it goes weekly or monthly, a digest of the figures its last message carried, so that an unchanged view sends nothing, and the date and outcome of each run for {days} days.",
    fr: "Une vue envoyée par courriel conserve aussi si elle part chaque semaine ou chaque mois, une empreinte des chiffres de son dernier message, afin qu'une vue inchangée n'envoie rien, et la date et l'issue de chaque envoi pendant {days} jours.",
  },

  // -- the stop link's pages (src/account/view_pages.tsx) -----------------------------------------------
  "views.stop_title": { en: "Stop a Saved View's Email", fr: "Arrêter le courriel d'une vue enregistrée" },
  "views.stop_lead": {
    en: "This turns the view's email off. The view stays in your saved views.",
    fr: "Ceci désactive le courriel de la vue. La vue reste dans vos vues enregistrées.",
  },
  "views.stop_panel": { en: "Saved View", fr: "Vue enregistrée" },
  "views.stop_button": { en: "Turn this view's email off", fr: "Désactiver le courriel de cette vue" },
  "views.stop_already": { en: "This view's email is already off.", fr: "Le courriel de cette vue est déjà désactivé." },
  "views.stopped_title": { en: "View's Email Off", fr: "Courriel de la vue désactivé" },
  "views.stopped_lead": {
    en: "The view's email is off. Turn it back on from your saved views.",
    fr: "Le courriel de la vue est désactivé. Réactivez-le à partir de vos vues enregistrées.",
  },
  "views.stopped_one_click": { en: "The view's email is off.", fr: "Le courriel de la vue est désactivé." },

  // -- the message (src/account/digests.ts viewDigest) ------------------------------------------------
  "view.mail_subject": { en: "{name}: figures to {date}", fr: "{name} : chiffres au {date}" },
  "view.mail_lead": {
    en: "Your saved view as of the data date {date}: {source}, fiscal years {first} to {last}.",
    fr: "Votre vue enregistrée à la date des données du {date} : {source}, exercices {first} à {last}.",
  },
  "view.mail_years": { en: "By Fiscal Year", fr: "Par exercice" },
  "view.mail_years_none": { en: "No record in these fiscal years.", fr: "Aucun dossier pour ces exercices." },
  "view.mail_largest": { en: "The largest records of {fy}", fr: "Les dossiers les plus importants de {fy}" },
  "view.mail_largest_none": { en: "No record with a counted value in {fy} yet.", fr: "Aucun dossier avec une valeur comptée en {fy} pour le moment." },
  // The preview line: the latest fiscal year's figures.
  "view.mail_pre": { en: "{fy}: {records}, {value}.", fr: "{fy} : {records}, {value}." },
  "view.mail_open": { en: "Open the view", fr: "Ouvrir la vue" },
  "view.mail_csv": { en: "The table as a CSV file (signed in)", fr: "Le tableau en fichier CSV (connexion requise)" },
  "view.mail_why_weekly": {
    en: "You receive this because you asked for this saved view by email, each week.",
    fr: "Vous recevez ce message parce que vous avez demandé cette vue enregistrée par courriel, chaque semaine.",
  },
  "view.mail_why_monthly": {
    en: "You receive this because you asked for this saved view by email, each month.",
    fr: "Vous recevez ce message parce que vous avez demandé cette vue enregistrée par courriel, chaque mois.",
  },
  "view.mail_stop": { en: "Stop this view's email", fr: "Arrêter le courriel de cette vue" },

  // The console's live mail check (src/account/mail_check.ts).
  "admin.mail_check_t_view": { en: "A saved view, weekly", fr: "Une vue enregistrée, chaque semaine" },
} as const satisfies Record<string, { en: string; fr: string }>;
