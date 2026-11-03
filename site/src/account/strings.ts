// The accounts module's strings, in English and French, spread into the
// site's dictionary (src/i18n.ts) so t() and the dictionary tests treat them
// like every other key. French follows the dictionary's rules: plain spaces
// and straight apostrophes here, the Canadian French forms added when read.
// None of these reach a page while the switch is off.

export const ACCOUNT_STRINGS = {
  // -- shell and shared --------------------------------------------------------
  "account.sign_in": { en: "Sign in", fr: "Se connecter" },
  "account.description": { en: "Your Award Watch account.", fr: "Votre compte Award Watch." },
  "account.unavailable_title": { en: "Accounts Unavailable", fr: "Comptes indisponibles" },
  "account.unavailable_text": {
    en: "The account service cannot be reached just now. Nothing was changed. Try again in a few minutes.",
    fr: "Le service des comptes est injoignable pour le moment. Rien n'a été modifié. Réessayez dans quelques minutes.",
  },

  // -- sign-in and the code ------------------------------------------------------
  "account.sign_in_title": { en: "Sign In", fr: "Connexion" },
  "account.sign_in_lead": {
    en: "Enter your email address. The site sends a 6-digit code and a link, and either one signs you in. There is no password.",
    fr: "Entrez votre adresse courriel. Le site envoie un code à 6 chiffres et un lien, et l'un ou l'autre vous connecte. Il n'y a pas de mot de passe.",
  },
  "account.email_panel": { en: "Email Address", fr: "Adresse courriel" },
  "account.send_code": { en: "Send the code", fr: "Envoyer le code" },
  "account.sign_in_privacy": {
    en: "Signing in is optional; every page works without it. The {privacy} page lists what an account keeps.",
    fr: "La connexion est facultative; toutes les pages fonctionnent sans elle. La page {privacy} énumère ce que conserve un compte.",
  },
  "account.err_not_sent": {
    en: "The message could not be sent. Sign-in by email is not available yet; try again later.",
    fr: "Le message n'a pas pu être envoyé. La connexion par courriel n'est pas encore offerte; réessayez plus tard.",
  },
  "account.err_send_failed": {
    en: "The message could not be sent. Try again in a few minutes.",
    fr: "Le message n'a pas pu être envoyé. Réessayez dans quelques minutes.",
  },
  "account.err_limited": {
    en: "This address has asked for {n} codes in the last hour. Wait an hour, then ask again.",
    fr: "Cette adresse a demandé {n} codes au cours de la dernière heure. Attendez une heure, puis redemandez.",
  },
  "account.check_title": { en: "Check Your Email", fr: "Vérifiez vos courriels" },
  "account.check_lead": {
    en: "If {email} can receive mail, a message with a 6-digit code and a sign-in link is on its way. Either one works once, within {minutes} minutes.",
    fr: "Si {email} peut recevoir des courriels, un message contenant un code à 6 chiffres et un lien de connexion est en route. L'un ou l'autre fonctionne une seule fois, dans les {minutes} minutes.",
  },
  "account.code_panel": { en: "Enter the Code", fr: "Entrer le code" },
  "account.code": { en: "6-digit code", fr: "Code à 6 chiffres" },
  "account.code_again": { en: "No message, or the wrong address? {again}.", fr: "Aucun message, ou la mauvaise adresse? {again}." },
  "account.code_again_link": { en: "Ask for a new code", fr: "Demander un nouveau code" },
  "account.enter_title": { en: "Enter Your Code", fr: "Entrez votre code" },
  "account.enter_lead": {
    en: "Enter the address the code was sent to and the 6-digit code from the message.",
    fr: "Entrez l'adresse à laquelle le code a été envoyé et le code à 6 chiffres du message.",
  },
  "account.link_title": { en: "Finish Signing In", fr: "Terminer la connexion" },
  "account.link_lead": {
    en: "Press the button to sign in on this browser. The link works once.",
    fr: "Appuyez sur le bouton pour vous connecter dans ce navigateur. Le lien ne fonctionne qu'une fois.",
  },
  "account.link_panel": { en: "Sign In on This Browser", fr: "Connexion dans ce navigateur" },
  "account.err_code": {
    en: "That code does not match. Check the message and try again.",
    fr: "Ce code ne correspond pas. Vérifiez le message et réessayez.",
  },
  "account.err_locked": { en: "Too many wrong codes. Ask for a new one.", fr: "Trop de codes erronés. Demandez-en un nouveau." },
  "account.err_stale": {
    en: "This code or link has expired or was already used. Ask for a new one.",
    fr: "Ce code ou ce lien a expiré ou a déjà servi. Demandez-en un nouveau.",
  },
  "account.msg_signed_out": { en: "You are signed out.", fr: "Vous êtes déconnecté." },
  "account.msg_signed_out_all": { en: "Every browser is signed out.", fr: "Tous les navigateurs sont déconnectés." },

  // -- the overview -------------------------------------------------------------------
  "account.title": { en: "Your Account", fr: "Votre compte" },
  "account.lead": { en: "Signed in as {email}.", fr: "Connecté en tant que {email}." },
  "account.panel_account": { en: "Account", fr: "Compte" },
  "account.field_email": { en: "Email", fr: "Courriel" },
  "account.field_plan": { en: "Plan", fr: "Forfait" },
  "account.field_since": { en: "Member since", fr: "Membre depuis" },
  "account.field_sessions": { en: "Signed-in browsers", fr: "Navigateurs connectés" },
  "account.plan_free": { en: "Free", fr: "Gratuit" },
  // The subscript after the wordmark for a signed-in reader.
  "account.plan_tag_free": { en: "free", fr: "gratuit" },
  "account.plan_tag_pro": { en: "pro", fr: "pro" },
  "account.plan_pro_open": { en: "Pro, no end date", fr: "Pro, sans date de fin" },
  "account.plan_pro_until": { en: "Pro, until {date}", fr: "Pro, jusqu'au {date}" },
  "account.searches": { en: "Saved searches", fr: "Recherches enregistrées" },
  "account.searches_n": { en: "{n} of {cap}", fr: "{n} sur {cap}" },
  "account.keys": { en: "API keys", fr: "Clés d'API" },
  "account.panel_sign_out": { en: "Sign Out", fr: "Déconnexion" },
  "account.sign_out_text": {
    en: "Signing out everywhere ends the session on every browser where this account is signed in, this one included.",
    fr: "La déconnexion partout met fin à la session dans chaque navigateur où ce compte est connecté, y compris celui-ci.",
  },
  "account.sign_out": { en: "Sign out", fr: "Se déconnecter" },
  "account.sign_out_all": { en: "Sign out everywhere", fr: "Se déconnecter partout" },
  "account.delete_text": {
    en: "Deleting the account removes its saved searches and API keys and signs out every browser.",
    fr: "La suppression du compte retire ses recherches enregistrées et ses clés d'API, et déconnecte chaque navigateur.",
  },

  // -- saved searches -------------------------------------------------------------------
  "account.searches_title": { en: "Saved Searches", fr: "Recherches enregistrées" },
  "account.panel_import": { en: "From Your Alert Requests", fr: "À partir de vos demandes d'alertes" },
  "account.import_text": {
    en: "Before it had an account, this address asked for alerts on these searches.",
    fr: "Avant d'avoir un compte, cette adresse a demandé des alertes pour ces recherches.",
  },
  "account.import_button": { en: "Add them to saved searches", fr: "Les ajouter aux recherches enregistrées" },
  "account.col_search": { en: "Search", fr: "Recherche" },
  "account.col_delivery": { en: "Email delivery", fr: "Envoi par courriel" },
  "account.col_remove": { en: "Remove", fr: "Retrait" },
  "account.deliver_daily": { en: "Daily", fr: "Quotidien" },
  "account.deliver_weekly": { en: "Weekly", fr: "Hebdomadaire" },
  "account.deliver_off": { en: "Off", fr: "Désactivé" },
  "account.deliver_save": { en: "Save", fr: "Enregistrer" },
  "account.deliver_pro": {
    en: "Email delivery comes with the Pro plan.",
    fr: "L'envoi par courriel est offert avec le forfait Pro.",
  },
  "account.delete": { en: "Delete", fr: "Supprimer" },
  "account.searches_none": { en: "No saved searches yet.", fr: "Aucune recherche enregistrée pour l'instant." },
  "account.panel_add": { en: "Add a Search", fr: "Ajouter une recherche" },
  "account.add_url": { en: "Page address", fr: "Adresse de la page" },
  "account.add_button": { en: "Save the search", fr: "Enregistrer la recherche" },
  "account.add_note": {
    en: "Paste the address of a tender list, a list of contracts ending, an organization, a buyer or a segment page. The filter is saved as the page shows it.",
    fr: "Collez l'adresse d'une liste d'appels d'offres, d'une liste de contrats prenant fin, d'une organisation, d'un acheteur ou d'une page de segment. Le filtre est enregistré tel que la page l'affiche.",
  },
  "account.cap_free": {
    en: "The Free plan keeps up to {cap} saved searches.",
    fr: "Le forfait Gratuit conserve jusqu'à {cap} recherches enregistrées.",
  },
  "account.cap_pro": { en: "An account keeps up to {cap} saved searches.", fr: "Un compte conserve jusqu'à {cap} recherches enregistrées." },
  "account.msg_added": { en: "The search is saved.", fr: "La recherche est enregistrée." },
  "account.msg_exists": { en: "That search is already saved.", fr: "Cette recherche est déjà enregistrée." },
  "account.msg_deleted": { en: "The search is deleted.", fr: "La recherche est supprimée." },
  "account.msg_changed": { en: "The delivery is saved.", fr: "La fréquence d'envoi est enregistrée." },
  "account.msg_imported": { en: "Your alert requests are added.", fr: "Vos demandes d'alertes sont ajoutées." },
  "account.msg_imported_some": {
    en: "Some alert requests did not fit within the plan's limit and were not added.",
    fr: "Certaines demandes d'alertes dépassaient la limite du forfait et n'ont pas été ajoutées.",
  },
  "account.err_url": {
    en: "That address is not a page with a filter to save.",
    fr: "Cette adresse ne mène pas à une page dont le filtre peut être enregistré.",
  },

  // -- API keys ------------------------------------------------------------------------
  "account.keys_title": { en: "API Keys", fr: "Clés d'API" },
  "account.keys_lead": {
    en: "A key identifies your requests to the site's API. No endpoint asks for one yet.",
    fr: "Une clé identifie vos requêtes à l'API du site. Aucun point d'accès n'en demande encore.",
  },
  "account.panel_new_key": { en: "New Key", fr: "Nouvelle clé" },
  "account.new_key_text": {
    en: "Copy the key now. It is shown once and cannot be shown again.",
    fr: "Copiez la clé maintenant. Elle n'est affichée qu'une fois et ne peut plus l'être ensuite.",
  },
  "account.panel_create_key": { en: "Create a Key", fr: "Créer une clé" },
  "account.key_name": { en: "Name", fr: "Nom" },
  "account.key_name_placeholder": { en: "Nightly sync", fr: "Synchronisation de nuit" },
  "account.create_key": { en: "Create the key", fr: "Créer la clé" },
  "account.keys_limit": {
    en: "An account holds up to {n} active keys. Revoke one to create another.",
    fr: "Un compte détient jusqu'à {n} clés actives. Révoquez-en une pour en créer une autre.",
  },
  "account.keys_pro": { en: "API keys come with the Pro plan.", fr: "Les clés d'API sont offertes avec le forfait Pro." },
  "account.panel_keys": { en: "Your Keys", fr: "Vos clés" },
  "account.col_prefix": { en: "Starts with", fr: "Commence par" },
  "account.col_created": { en: "Created", fr: "Créée" },
  "account.col_last_used": { en: "Last used", fr: "Dernière utilisation" },
  "account.col_status": { en: "Status", fr: "État" },
  "account.key_active": { en: "In use", fr: "En service" },
  "account.key_revoked": { en: "Revoked {date}", fr: "Révoquée le {date}" },
  "account.key_never": { en: "Never", fr: "Jamais" },
  "account.revoke": { en: "Revoke", fr: "Révoquer" },
  "account.keys_none": { en: "No keys yet.", fr: "Aucune clé pour l'instant." },
  "account.msg_key_revoked": { en: "The key is revoked.", fr: "La clé est révoquée." },
  "account.err_key_name": { en: "Give the key a name.", fr: "Donnez un nom à la clé." },
  "account.api_key_missing": { en: "This endpoint needs an API key.", fr: "Ce point d'accès exige une clé d'API." },
  "account.api_key_invalid": {
    en: "The API key is not valid or was revoked.",
    fr: "La clé d'API n'est pas valide ou a été révoquée.",
  },
  "account.api_key_plan": {
    en: "The plan of the key's account does not include the API.",
    fr: "Le forfait du compte de cette clé ne comprend pas l'API.",
  },

  // -- deletion ------------------------------------------------------------------------
  "account.delete_title": { en: "Delete the Account", fr: "Supprimer le compte" },
  "account.delete_lead": { en: "Deleting the account cannot be undone.", fr: "La suppression du compte est définitive." },
  "account.panel_delete_what": { en: "What Is Removed", fr: "Ce qui est retiré" },
  "account.delete_searches": {
    en: "Every saved search and every API key.",
    fr: "Toutes les recherches enregistrées et toutes les clés d'API.",
  },
  "account.delete_sessions": {
    en: "Every signed-in browser, which is signed out.",
    fr: "Tous les navigateurs connectés, qui sont déconnectés.",
  },
  "account.delete_interest": {
    en: "Requests for alerts made with this address through the alerts form.",
    fr: "Les demandes d'alertes faites avec cette adresse au moyen du formulaire d'alertes.",
  },
  "account.delete_email": {
    en: "The email address. The account's row keeps only a hash under a random value that is then thrown away, so the row cannot be matched to the address.",
    fr: "L'adresse courriel. La ligne du compte ne conserve qu'un hachage sous une valeur aléatoire ensuite détruite, de sorte que la ligne ne peut pas être rapprochée de l'adresse.",
  },
  "account.delete_kept": {
    en: "A record of the plans granted to the account stays, with no address.",
    fr: "Un relevé des forfaits accordés au compte est conservé, sans adresse.",
  },
  "account.delete_confirm": { en: "I want to delete this account.", fr: "Je veux supprimer ce compte." },
  "account.delete_button": { en: "Delete the account", fr: "Supprimer définitivement le compte" },
  "account.err_confirm": { en: "Tick the box to confirm.", fr: "Cochez la case pour confirmer." },
  "account.deleted_title": { en: "Account Deleted", fr: "Compte supprimé" },
  "account.deleted_lead": {
    en: "The account is deleted and this browser is signed out.",
    fr: "Le compte est supprimé et ce navigateur est déconnecté.",
  },
  "account.home": { en: "Back to the home page", fr: "Retour à l'accueil" },

  // -- the sign-in message (src/account/sender.ts; design/email shows it) -----------------
  // The subject and the preheader never carry the code. The footer's tagline
  // is the site's own (site.name and site.tagline).
  "account.mail_subject": { en: "Your Award Watch sign-in code", fr: "Votre code de connexion à Award Watch" },
  "account.mail_preheader": {
    en: "A sign-in was requested for this address on awardwatch.ca.",
    fr: "Une connexion a été demandée pour cette adresse sur awardwatch.ca.",
  },
  "account.mail_heading": { en: "Your sign-in code", fr: "Votre code de connexion" },
  "account.mail_lead": {
    en: "Enter this code on the page where you asked for it, or use the button. Either one works once, within {minutes} minutes.",
    fr: "Saisissez ce code sur la page où vous l'avez demandé, ou utilisez le bouton. L'un ou l'autre fonctionne une seule fois, pendant {minutes} minutes.",
  },
  "account.mail_button": { en: "Sign in to Award Watch", fr: "Se connecter à Award Watch" },
  "account.mail_not_asked": {
    en: "If you did not ask for this, ignore this message. Nothing happens without the code.",
    fr: "Si vous n'avez rien demandé, ignorez ce message. Rien ne se passe sans le code.",
  },
  "account.mail_why": {
    en: "This message was sent because this address was entered on awardwatch.ca.",
    fr: "Ce message a été envoyé parce que cette adresse a été saisie sur awardwatch.ca.",
  },
  // The plain-text part has no button, so its two lines name the link instead.
  "account.mail_text_link": {
    en: "Enter it on the page where you asked for it, or open this link:",
    fr: "Saisissez-le sur la page où vous l'avez demandé, ou ouvrez ce lien :",
  },
  "account.mail_text_expiry": {
    en: "Either one works once, within {minutes} minutes.",
    fr: "L'un ou l'autre fonctionne une seule fois, pendant {minutes} minutes.",
  },

  // -- the privacy page, while accounts are open ------------------------------------------
  "account.privacy_toc": { en: "Accounts", fr: "Comptes" },
  "account.privacy_kept": {
    en: "Signing in is optional; every page works without an account. An account keeps the email address, the language, when it was created and last used, its plan, its saved searches and the names of its API keys.",
    fr: "La connexion est facultative; toutes les pages fonctionnent sans compte. Un compte conserve l'adresse courriel, la langue, sa date de création et de dernière utilisation, son forfait, ses recherches enregistrées et les noms de ses clés d'API.",
  },
  "account.privacy_secrets": {
    en: "There are no passwords. Sign-in codes, sign-in links, the session and API keys are stored only as one-way hashes. A signed-in browser holds a second cookie, aw_session, which keeps the session for 30 days after its last use.",
    fr: "Il n'y a pas de mot de passe. Les codes et liens de connexion, la session et les clés d'API ne sont conservés que sous forme de hachages à sens unique. Un navigateur connecté détient un second témoin, aw_session, qui conserve la session pendant 30 jours après sa dernière utilisation.",
  },
  "account.privacy_not_kept": {
    en: "An account keeps no name, postal address, IP address or browser identification. A sign-in request keeps, for one day, a hash of the IP address under a key that changes every day.",
    fr: "Un compte ne conserve aucun nom, adresse postale, adresse IP ni identification de navigateur. Une demande de connexion conserve, pendant un jour, un hachage de l'adresse IP sous une clé qui change chaque jour.",
  },
  "account.privacy_delete": {
    en: "Deleting the account from its own page removes its saved searches, keys and sessions and replaces the email address with a hash that cannot be matched to it.",
    fr: "La suppression du compte, depuis sa propre page, retire ses recherches enregistrées, ses clés et ses sessions et remplace l'adresse courriel par un hachage qui ne peut pas lui être rapproché.",
  },

  // -- deliveries (phase 2: src/account/deliveries.ts, digests.ts, the stop page) --------
  "account.searches_lead_deliver": {
    en: "Filters you follow, saved from the site's lists and pages. On the Pro plan, tender lists and contracts ending can be delivered by email, each day or each week.",
    fr: "Les filtres que vous suivez, enregistrés à partir des listes et des pages du site. Avec le forfait Pro, les listes d'appels d'offres et de contrats prenant fin peuvent être envoyées par courriel, chaque jour ou chaque semaine.",
  },
  "account.deliver_not_yet": {
    en: "Email delivery is not offered for this kind of search yet.",
    fr: "L'envoi par courriel n'est pas encore offert pour ce type de recherche.",
  },
  "account.last_none": { en: "Not delivered yet.", fr: "Pas encore envoyée." },
  "account.last_sent_one": { en: "Last sent {time}, 1 item.", fr: "Dernier envoi le {time}, 1 élément." },
  "account.last_sent_many": { en: "Last sent {time}, {n} items.", fr: "Dernier envoi le {time}, {n} éléments." },
  "account.last_empty": { en: "Checked {time}, nothing new.", fr: "Vérifiée le {time}, rien de nouveau." },
  "account.last_failed": {
    en: "Not sent {time}. The next delivery includes what it missed.",
    fr: "Non envoyée le {time}. Le prochain envoi comprendra ce qui a manqué.",
  },
  "account.stop_title": { en: "Stop This Delivery", fr: "Arrêter cet envoi" },
  "account.stop_lead": {
    en: "The saved search below is delivered by email. Stopping turns its delivery off; the search stays in the account.",
    fr: "La recherche enregistrée ci-dessous est envoyée par courriel. L'arrêt désactive son envoi; la recherche reste dans le compte.",
  },
  "account.stop_panel": { en: "Saved Search", fr: "Recherche enregistrée" },
  "account.stop_button": { en: "Stop the delivery", fr: "Arrêter l'envoi" },
  "account.stop_already": { en: "This delivery is already off.", fr: "Cet envoi est déjà désactivé." },
  "account.stopped_title": { en: "Delivery Stopped", fr: "Envoi arrêté" },
  "account.stopped_lead": {
    en: "This search is no longer sent by email. It stays in the account, where its delivery can be turned back on.",
    fr: "Cette recherche n'est plus envoyée par courriel. Elle reste dans le compte, où son envoi peut être réactivé.",
  },
  "account.stopped_one_click": { en: "The delivery is off.", fr: "L'envoi est désactivé." },
  "account.privacy_mail": {
    en: "The email address is handed to Cloudflare's email service to deliver the site's messages: the sign-in code, and the saved searches whose delivery is on. It is used for nothing else.",
    fr: "L'adresse courriel est transmise au service de courriel de Cloudflare pour livrer les messages du site : le code de connexion et les recherches enregistrées dont l'envoi est activé. Elle ne sert à rien d'autre.",
  },
  "digest.tenders_title": { en: "New tender notices", fr: "Nouveaux avis d'appel d'offres" },
  "digest.tenders_subject_one": { en: "1 new tender notice: {scope}", fr: "1 nouvel avis d'appel d'offres : {scope}" },
  "digest.tenders_subject_many": { en: "{n} new tender notices: {scope}", fr: "{n} nouveaux avis d'appel d'offres : {scope}" },
  "digest.tenders_subject_all_one": { en: "1 new tender notice", fr: "1 nouvel avis d'appel d'offres" },
  "digest.tenders_subject_all_many": { en: "{n} new tender notices", fr: "{n} nouveaux avis d'appel d'offres" },
  "digest.tenders_intro_one": {
    en: "1 notice published since {since} matches your saved search {label}. Data date {date}.",
    fr: "1 avis publié depuis {since} correspond à votre recherche enregistrée {label}. Date des données : {date}.",
  },
  "digest.tenders_intro_many": {
    en: "{n} notices published since {since} match your saved search {label}. Data date {date}.",
    fr: "{n} avis publiés depuis {since} correspondent à votre recherche enregistrée {label}. Date des données : {date}.",
  },
  "digest.since_yesterday": { en: "yesterday's refresh", fr: "la mise à jour d'hier" },
  "digest.since_day": { en: "the refresh of {date}", fr: "la mise à jour du {date}" },
  "digest.closes": { en: "Closes {day} {time}", fr: "Ferme le {day} à {time}" },
  "digest.closes_day": { en: "Closes {day}", fr: "Ferme le {day}" },
  "digest.closes_today": { en: "closes today", fr: "ferme aujourd'hui" },
  "digest.tenders_button": { en: "See all open notices", fr: "Voir tous les avis ouverts" },
  "digest.tenders_note": {
    en: "Closing times are the buyer's, shown in Eastern time. Days left count from the data date.",
    fr: "Les heures de clôture sont celles de l'acheteur, en heure de l'Est. Les jours restants se comptent à partir de la date des données.",
  },
  "digest.scope_words": { en: "title words", fr: "mots du titre" },
  "digest.scope_code": { en: "UNSPSC code {code}", fr: "code UNSPSC {code}" },
  "digest.expiring_title": { en: "Contracts ending within {n} months", fr: "Contrats prenant fin d'ici {n} mois" },
  "digest.expiring_subject_one": {
    en: "1 contract entering the {months}-month window: {scope}",
    fr: "1 contrat entrant dans la fenêtre de {months} mois : {scope}",
  },
  "digest.expiring_subject_many": {
    en: "{n} contracts entering the {months}-month window: {scope}",
    fr: "{n} contrats entrant dans la fenêtre de {months} mois : {scope}",
  },
  "digest.expiring_subject_all_one": {
    en: "1 contract entering the {months}-month window",
    fr: "1 contrat entrant dans la fenêtre de {months} mois",
  },
  "digest.expiring_subject_all_many": {
    en: "{n} contracts entering the {months}-month window",
    fr: "{n} contrats entrant dans la fenêtre de {months} mois",
  },
  "digest.expiring_intro_one": {
    en: "1 contract whose end date now falls within {months} months of the data date, under your saved search {label}. {cadence} Data date {date}.",
    fr: "1 contrat dont la date de fin tombe désormais dans les {months} mois suivant la date des données, sous votre recherche enregistrée {label}. {cadence} Date des données : {date}.",
  },
  "digest.expiring_intro_many": {
    en: "{n} contracts whose end date now falls within {months} months of the data date, under your saved search {label}. {cadence} Data date {date}.",
    fr: "{n} contrats dont la date de fin tombe désormais dans les {months} mois suivant la date des données, sous votre recherche enregistrée {label}. {cadence} Date des données : {date}.",
  },
  "digest.cadence_daily": { en: "Daily.", fr: "Chaque jour." },
  "digest.cadence_weekly": { en: "Weekly.", fr: "Chaque semaine." },
  "digest.ends": { en: "Ends {date}", fr: "Prend fin le {date}" },
  "digest.expiring_button": { en: "Open the radar", fr: "Ouvrir le radar" },
  "digest.expiring_note": {
    en: "A contract's value is the one on its newest amendment. Nothing is summed across sources.",
    fr: "La valeur d'un contrat est celle de sa plus récente modification. Rien n'est additionné entre les sources.",
  },
  "digest.more_one": { en: "And 1 more on the site", fr: "Et 1 autre sur le site" },
  "digest.more_many": { en: "And {n} more on the site", fr: "Et {n} autres sur le site" },
  "digest.pre_more_one": { en: "{first}, and 1 more.", fr: "{first}, et 1 autre." },
  "digest.pre_more_many": { en: "{first}, and {n} more.", fr: "{first}, et {n} autres." },
  "digest.why_daily": {
    en: "You receive this each day for a saved search in your account.",
    fr: "Vous recevez ce message chaque jour pour une recherche enregistrée dans votre compte.",
  },
  "digest.why_weekly": {
    en: "You receive this each week for a saved search in your account.",
    fr: "Vous recevez ce message chaque semaine pour une recherche enregistrée dans votre compte.",
  },
  "digest.searches_link": { en: "Saved searches", fr: "Recherches enregistrées" },
  "digest.stop_link": { en: "Stop this delivery", fr: "Arrêter cet envoi" },
  "digest.text_searches": { en: "Saved searches and delivery", fr: "Recherches enregistrées et envoi" },
  "digest.text_link": { en: "{label}: {url}", fr: "{label} : {url}" },
} as const satisfies Record<string, { en: string; fr: string }>;
