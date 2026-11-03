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
  "account.searches_lead": {
    en: "Filters you follow, saved from the site's lists and pages. Nothing is sent by email yet.",
    fr: "Les filtres que vous suivez, enregistrés à partir des listes et des pages du site. Rien n'est encore envoyé par courriel.",
  },
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
} as const satisfies Record<string, { en: string; fr: string }>;
