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
  "account.err_code_two": {
    en: "That code does not match. Two tries remain this hour.",
    fr: "Ce code ne correspond pas. Il reste deux essais pour cette heure.",
  },
  "account.err_code_one": {
    en: "That code does not match. One try remains this hour.",
    fr: "Ce code ne correspond pas. Il reste un essai pour cette heure.",
  },
  "account.err_locked": {
    en: "Too many wrong codes for this address. Try again in an hour.",
    fr: "Trop de codes erronés pour cette adresse. Réessayez dans une heure.",
  },
  "account.err_stale": {
    en: "This code or link has expired or was already used. Ask for a new one.",
    fr: "Ce code ou ce lien a expiré ou a déjà servi. Demandez-en un nouveau.",
  },
  // The sign-in pages, when a public page's Follow form started the sign-in (routes.tsx, follow).
  "account.follow_pending": {
    en: "Signing in also follows the page where you pressed Follow.",
    fr: "En vous connectant, vous suivrez aussi la page où vous avez appuyé sur Suivre.",
  },
  // On the sign-in page that answers a Follow post which sent nothing (routes.tsx).
  "account.follow_after": {
    en: "To follow that page, sign in here, then press Follow on it.",
    fr: "Pour suivre cette page, connectez-vous ici, puis appuyez sur Suivre sur la page.",
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
  // The panel over the overview while the account follows no page or keeps no
  // saved search (pages.tsx StartPanel). Each step's line says what the step
  // leads to in the words the Follow control, the Save this search control and
  // the organization page use; the figures come from the plans, and a Free
  // account's lines are the watches and searches pages' own (watches.cap_free,
  // account.cap_note).
  "account.start_panel": { en: "Start Here", fr: "Pour commencer" },
  "account.start_follow": { en: "Follow an organization or a buyer", fr: "Suivre une organisation ou un acheteur" },
  "account.start_follow_text": {
    en: "On a result's profile, use the Follow button. Its events then show on your watches page: a new award, an amendment, an end date near, a new or closed notice.",
    fr: "Sur le profil d'un résultat, utilisez le bouton Suivre. Ses événements s'affichent ensuite sur votre page des suivis : une nouvelle attribution, une modification, une fin proche, un avis nouveau ou fermé.",
  },
  "account.start_follow_text_pro": {
    en: "On a result's profile, use the Follow button. Its events then show on your watches page and come by email: a new award, an amendment, an end date near, a new or closed notice.",
    fr: "Sur le profil d'un résultat, utilisez le bouton Suivre. Ses événements s'affichent ensuite sur votre page des suivis et arrivent par courriel : une nouvelle attribution, une modification, une fin proche, un avis nouveau ou fermé.",
  },
  "account.start_follow_cap": { en: "This account follows {n} of {cap} pages.", fr: "Pages suivies par ce compte : {n} sur {cap}." },
  "account.start_search": { en: "Save a search of tender notices", fr: "Enregistrer une recherche d'avis d'appel d'offres" },
  "account.start_search_button": { en: "Filter the tender notices", fr: "Filtrer les avis d'appel d'offres" },
  "account.start_search_text": {
    en: "Set the filters there, then press Save this search.",
    fr: "Choisissez-y les filtres, puis appuyez sur Enregistrer cette recherche.",
  },
  "account.start_search_cap": {
    en: "This account holds {n} of {cap} saved searches. Each can be sent by email, daily or weekly.",
    fr: "Recherches enregistrées de ce compte : {n} sur {cap}. Chacune peut être envoyée par courriel, chaque jour ou chaque semaine.",
  },
  "account.start_org": { en: "Choose your organization", fr: "Choisir votre organisation" },
  "account.start_org_button": { en: "Find your organization", fr: "Trouver votre organisation" },
  "account.start_org_text": {
    en: "Tell the site which organization is yours to see its records by fiscal year on one page. The choice is private to your account.",
    fr: "Indiquez au site quelle organisation est la vôtre pour voir ses dossiers par exercice sur une même page. Ce choix reste privé à votre compte.",
  },
  "account.start_org_text_pro": {
    en: "Tell the site which organization is yours to see, on one page, its records by fiscal year and segment, its contracts ending within 12 months and the buyers it has won from. The choice is private to your account.",
    fr: "Indiquez au site quelle organisation est la vôtre pour voir au même endroit ses dossiers par exercice et par segment, ses contrats prenant fin d'ici 12 mois et les acheteurs auprès desquels elle a obtenu des contrats. Ce choix reste privé à votre compte.",
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
    en: "Paste the address of a tender list, a list of contracts ending, an organization, a buyer or a segment page. The filter is saved as the page shows it. On a tender list, a list of contracts ending or a segment page, Save this search does the same without the address.",
    fr: "Collez l'adresse d'une liste d'appels d'offres, d'une liste de contrats prenant fin, d'une organisation, d'un acheteur ou d'une page de segment. Le filtre est enregistré tel que la page l'affiche. Sur une liste d'appels d'offres, une liste de contrats prenant fin ou une page de segment, Enregistrer cette recherche fait de même sans l'adresse.",
  },
  "account.cap_free": {
    en: "The Free plan keeps up to {cap} saved searches.",
    fr: "Le forfait Gratuit conserve jusqu'à {cap} recherches enregistrées.",
  },
  "account.cap_pro": { en: "An account keeps up to {cap} saved searches.", fr: "Un compte conserve jusqu'à {cap} recherches enregistrées." },
  // A Free account's gate notes on the searches page, each with the Pro chip (src/pro.tsx).
  "account.cap_note": {
    en: "This account holds {n} of {cap} saved searches. Pro holds up to {max} and sends them by email, daily or weekly.",
    fr: "Recherches enregistrées de ce compte : {n} sur {cap}. Pro en conserve jusqu'à {max} et les envoie par courriel, chaque jour ou chaque semaine.",
  },
  "account.deliver_gate": { en: "Off. Email delivery is part of Pro.", fr: "Désactivé. L'envoi par courriel fait partie de Pro." },
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
  // The Save this search control on a page whose filter can be saved (search_control.tsx): the
  // button, the state once the page's filter is saved, and Pro's line at the cap. A Free account's
  // line at the cap is the searches page's own (account.cap_note).
  "account.save_button": { en: "Save this search", fr: "Enregistrer cette recherche" },
  "account.save_saved": { en: "Search saved", fr: "Recherche enregistrée" },
  "account.save_manage": { en: "Manage your saved searches", fr: "Gérer vos recherches enregistrées" },
  "account.save_cap_pro": {
    en: "This account holds {cap} saved searches, the most an account keeps.",
    fr: "Ce compte a {cap} recherches enregistrées, le maximum qu'un compte conserve.",
  },

  // -- calendar feeds (src/account/feeds.ts, the searches and watches pages) -----------
  "calfeed.panel": { en: "Calendar Feeds", fr: "Flux de calendrier" },
  "calfeed.lead": {
    en: "A calendar feed is an address a calendar app subscribes to. It lists the closing date of each open notice a saved tender search matches, and an amendment that moves a closing moves its event.",
    fr: "Un flux de calendrier est une adresse à laquelle une application de calendrier s'abonne. Il présente la date de clôture de chaque avis ouvert que vise une recherche d'appels d'offres enregistrée, et une modification qui déplace une clôture déplace son événement.",
  },
  "calfeed.gate": {
    en: "A calendar feed of each saved tender search is part of Pro.",
    fr: "Un flux de calendrier pour chaque recherche d'appels d'offres enregistrée fait partie de Pro.",
  },
  "calfeed.col_feed": { en: "Feed", fr: "Flux" },
  "calfeed.col_address": { en: "Calendar feed", fr: "Flux de calendrier" },
  // The "all" feed holds the watches too; "Suivis", as the watches page is
  // named, since "liste de suivi" is the browser's own list.
  "calfeed.kind_all": {
    en: "All saved tender searches and watches", fr: "Toutes les recherches d'appels d'offres enregistrées et les suivis",
  },
  "calfeed.kind_watchlist": { en: "Watches", fr: "Suivis" },
  // The watches page's panel (src/account/watch_pages.tsx).
  "calfeed.panel_watch": { en: "Calendar Feed", fr: "Flux de calendrier" },
  "calfeed.watch_lead": {
    en: "A calendar feed of your watches lists the end date of each followed contract, of each contract a followed organization or buyer holds that ends within 12 months, and the closing of each followed open notice. Each end date's title starts with the holder, and an amendment that moves a date moves its event.",
    fr: "Un flux de calendrier de vos suivis présente la date de fin de chaque contrat suivi, celle de chaque contrat d'une organisation ou d'un acheteur suivi qui prend fin d'ici 12 mois, et la clôture de chaque appel d'offres ouvert suivi. Le titre de chaque date de fin commence par le titulaire, et une modification qui déplace une date déplace son événement.",
  },
  "calfeed.watch_horizon": {
    en: "An organization or buyer watch reaches 12 months ahead when it follows Ends within 12 months, 6 months when it follows Ends within 6 months alone, and adds no end dates when it follows neither.",
    fr: "Un suivi d'organisation ou d'acheteur couvre les 12 mois à venir lorsqu'il suit Prend fin d'ici 12 mois, 6 mois lorsqu'il suit seulement Prend fin d'ici 6 mois, et n'ajoute aucune date de fin lorsqu'il ne suit ni l'un ni l'autre.",
  },
  "calfeed.watch_gate": {
    en: "A calendar feed of your watches, with their end and closing dates, is part of Pro.",
    fr: "Un flux de calendrier de vos suivis, avec leurs dates de fin et de clôture, fait partie de Pro.",
  },
  "calfeed.make": { en: "Make a calendar feed", fr: "Créer un flux de calendrier" },
  "calfeed.address": { en: "Feed address", fr: "Adresse du flux" },
  "calfeed.copy": { en: "Copy", fr: "Copier" },
  "calfeed.copied": { en: "Copied", fr: "Copiée" },
  "calfeed.rotate": { en: "Rotate the address", fr: "Changer l'adresse" },
  "calfeed.remove": { en: "Remove", fr: "Retirer" },
  "calfeed.last_read": { en: "Last read by a calendar on {date}", fr: "Lu par un calendrier pour la dernière fois le {date}" },
  "calfeed.not_read": { en: "Not read yet", fr: "Pas encore lu" },
  "calfeed.events_one": { en: "{n} event today", fr: "{n} événement aujourd'hui" },
  "calfeed.events_many": { en: "{n} events today", fr: "{n} événements aujourd'hui" },
  "calfeed.none": {
    en: "Save a tender list to make a calendar feed of it.",
    fr: "Enregistrez une liste d'appels d'offres pour en créer un flux de calendrier.",
  },
  "calfeed.count": { en: "{n} of {max}", fr: "{n} sur {max}" },
  "calfeed.cap": { en: "An account keeps up to {n} calendar feeds.", fr: "Un compte conserve jusqu'à {n} flux de calendrier." },
  "calfeed.privacy": {
    en: "Anyone who holds a feed's address can read what it lists. Rotate the address if it was shared by mistake.",
    fr: "Quiconque détient l'adresse d'un flux peut lire ce qu'il présente. Changez l'adresse si elle a été communiquée par erreur.",
  },
  "calfeed.route_google": {
    en: "Google Calendar: Other calendars, then From URL, then paste the address.",
    fr: "Google Agenda : Autres agendas, puis À partir de l'URL, puis collez l'adresse.",
  },
  "calfeed.route_outlook": {
    en: "Outlook: Add calendar, then Subscribe from web, then paste the address.",
    fr: "Outlook : Ajouter un calendrier, puis S'abonner à partir du web, puis collez l'adresse.",
  },
  "calfeed.route_apple": {
    en: "Apple Calendar: File, then New Calendar Subscription, then paste the address.",
    fr: "Calendrier d'Apple : Fichier, puis Nouvel abonnement à un calendrier, puis collez l'adresse.",
  },
  "calfeed.refresh": {
    en: "Calendar apps read a subscribed feed again on their own schedule, from every few hours to once a day. The feed is read from the site's data, refreshed nightly.",
    fr: "Les applications de calendrier relisent un flux auquel elles sont abonnées selon leur propre horaire, de quelques heures à une fois par jour. Le flux est tiré des données du site, actualisées chaque nuit.",
  },
  "calfeed.msg_added": {
    en: "The calendar feed is made. Copy its address into a calendar app.",
    fr: "Le flux de calendrier est créé. Copiez son adresse dans une application de calendrier.",
  },
  "calfeed.msg_exists": { en: "That calendar feed already exists.", fr: "Ce flux de calendrier existe déjà." },
  "calfeed.msg_rotated": {
    en: "The feed has a new address. The old one no longer answers; give the new one to the calendar app.",
    fr: "Le flux a une nouvelle adresse. L'ancienne ne répond plus; donnez la nouvelle à l'application de calendrier.",
  },
  "calfeed.msg_removed": {
    en: "The calendar feed is removed. Its address no longer answers.",
    fr: "Le flux de calendrier est retiré. Son adresse ne répond plus.",
  },
  "calfeed.msg_cap": {
    en: "This account holds the most calendar feeds it can keep. Remove one to make another.",
    fr: "Ce compte détient le nombre maximal de flux de calendrier. Retirez-en un pour en créer un autre.",
  },
  "calfeed.msg_missing": { en: "That saved search cannot have a calendar feed.", fr: "Cette recherche enregistrée ne peut pas avoir de flux de calendrier." },
  "calfeed.msg_pro": { en: "Calendar feeds come with the Pro plan.", fr: "Les flux de calendrier sont offerts avec le forfait Pro." },
  "calfeed.unavailable": {
    en: "The calendar feed cannot be read just now. The calendar app tries again later.",
    fr: "Le flux de calendrier ne peut pas être lu pour le moment. L'application de calendrier réessaiera plus tard.",
  },
  "calfeed.delete": {
    en: "Every calendar feed, whose address stops answering.",
    fr: "Tous les flux de calendrier, dont l'adresse cesse de répondre.",
  },
  "calfeed.privacy_page": {
    en: "A calendar feed keeps the day a calendar app last read it, with no time, IP address or app name. Its address carries a secret: anyone who holds it can read what the feed lists, and the account rotates or removes it at any time.",
    fr: "Un flux de calendrier conserve le jour où une application de calendrier l'a lu pour la dernière fois, sans heure, adresse IP ni nom d'application. Son adresse comporte un secret : quiconque la détient peut lire ce que présente le flux, et le compte peut la changer ou la retirer en tout temps.",
  },
  "admin.count_feeds": { en: "Calendar feeds by kind", fr: "Flux de calendrier par type" },
  "admin.count_feeds_read": { en: "Calendar feeds read, last {n} days", fr: "Flux de calendrier lus, {n} derniers jours" },
  "admin.panel_feeds": { en: "Calendar Feeds", fr: "Flux de calendrier" },
  "admin.col_last_read": { en: "Last read", fr: "Dernière lecture" },
  "admin.feeds_none": { en: "No calendar feeds.", fr: "Aucun flux de calendrier." },

  // -- API keys ------------------------------------------------------------------------
  "account.keys_title": { en: "API Keys", fr: "Clés d'API" },
  "account.keys_lead": {
    en: "A key opens the keyed API under /api/v1 while the account is on Pro. Send it in an Authorization header as a Bearer token, or in an X-Api-Key header.",
    fr: "Une clé ouvre l'API avec clé sous /api/v1 tant que le compte est au forfait Pro. Envoyez-la dans un en-tête Authorization comme jeton Bearer, ou dans un en-tête X-Api-Key.",
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
  // The keys page's endpoint list and each key's count (src/account/api_usage.ts).
  "account.panel_endpoints": { en: "Endpoints", fr: "Points d'accès" },
  "account.endpoints_more": {
    en: "The parameters, the limits and an example are on the {data} page.",
    fr: "Les paramètres, les limites et un exemple sont sur la page {data}.",
  },
  "account.col_today": { en: "Today", fr: "Aujourd'hui" },
  "account.col_30_days": { en: "Last 30 days", fr: "30 derniers jours" },
  "account.keys_usage_note": {
    en: "Requests are counted by UTC day. Each key may make {day} a day and {minute} a minute.",
    fr: "Les requêtes sont comptées par jour UTC. Chaque clé peut en faire {day} par jour et {minute} par minute.",
  },
  "account.keys_usage_unread": {
    en: "The counts cannot be read just now.",
    fr: "Les comptes ne peuvent pas être lus pour le moment.",
  },

  // -- API usage (src/account/api_usage_page.tsx) ---------------------------------------
  "apiusage.title": { en: "API Usage", fr: "Utilisation de l'API" },
  // The link to the page, on the keys page and the account's overview.
  "apiusage.link": { en: "API usage", fr: "Utilisation de l'API" },
  "apiusage.lead": {
    en: "Requests made with this account's API keys, counted by UTC day, over the {days} days ending today.",
    fr: "Les requêtes faites avec les clés d'API de ce compte, comptées par jour UTC, au cours des {days} jours qui se terminent aujourd'hui.",
  },
  "apiusage.tiles_label": { en: "Limits and requests", fr: "Limites et requêtes" },
  "apiusage.tile_day": { en: "Requests a day, per key", fr: "Requêtes par jour, par clé" },
  "apiusage.tile_day_note": { en: "The plan's daily cap, by UTC day", fr: "Le plafond quotidien du forfait, par jour UTC" },
  "apiusage.tile_minute": { en: "Requests a minute, per key", fr: "Requêtes par minute, par clé" },
  "apiusage.tile_minute_note": { en: "Every address: at most {n} a minute", fr: "Chaque adresse : au plus {n} par minute" },
  "apiusage.tile_today": { en: "Requests today", fr: "Requêtes aujourd'hui" },
  "apiusage.tile_today_note": { en: "All keys, {date} UTC", fr: "Toutes les clés, {date} UTC" },
  "apiusage.tile_window": { en: "Requests in {days} days", fr: "Requêtes en {days} jours" },
  "apiusage.tile_window_note": { en: "All keys, {first} to {last}", fr: "Toutes les clés, du {first} au {last}" },
  "apiusage.panel_today": { en: "Today Against the Cap", fr: "Aujourd'hui par rapport au plafond" },
  "apiusage.today_aria": {
    en: "Requests today by key, against the daily cap",
    fr: "Requêtes d'aujourd'hui par clé, par rapport au plafond quotidien",
  },
  "apiusage.none_live": {
    en: "No key is in use. Keys are made on the {keys} page.",
    fr: "Aucune clé n'est en service. Les clés se créent sur la page {keys}.",
  },
  "apiusage.form_nav": { en: "Chart form", fr: "Forme du graphique" },
  "apiusage.form_bars": { en: "Bars", fr: "Barres" },
  "apiusage.form_lines": { en: "Lines", fr: "Lignes" },
  "apiusage.today_pale": { en: "The pale bar is today, a day still under way.", fr: "La barre pâle est aujourd'hui, une journée en cours." },
  "apiusage.panel_chart": { en: "Requests a Day", fr: "Requêtes par jour" },
  "apiusage.period": { en: "{first} to {last}", fr: "du {first} au {last}" },
  "apiusage.chart_aria": {
    en: "Requests a day from {first} to {last}; the figures are in the table under the chart.",
    fr: "Requêtes par jour du {first} au {last}; les chiffres sont dans le tableau sous le graphique.",
  },
  // A series of the chart and a column of its table: every key together, or one revoked key.
  "apiusage.series_all": { en: "All keys", fr: "Toutes les clés" },
  "apiusage.series_revoked": { en: "{name} (revoked)", fr: "{name} (révoquée)" },
  "apiusage.requests_one": { en: "{n} request", fr: "{n} requête" },
  "apiusage.requests_many": { en: "{n} requests", fr: "{n} requêtes" },
  "apiusage.cap_rule": {
    en: "The dashed line marks the cap of {cap} requests a key a day.",
    fr: "La ligne pointillée marque le plafond de {cap} requêtes par clé par jour.",
  },
  // With several keys each panel has its own scale; the total's has no cap.
  "apiusage.cap_rule_keys": {
    en: "The dashed line marks the cap of {cap} requests a key a day, on each key's chart whose scale reaches it.",
    fr: "La ligne pointillée marque le plafond de {cap} requêtes par clé par jour, sur le graphique de chaque clé dont l'échelle l'atteint.",
  },
  "apiusage.cap_off": {
    en: "The cap, {cap} requests a key a day, is above the top of this scale.",
    fr: "Le plafond, {cap} requêtes par clé par jour, dépasse le haut de cette échelle.",
  },
  "apiusage.cap_off_keys": {
    en: "The cap, {cap} requests a key a day, is above the top of each key's scale.",
    fr: "Le plafond, {cap} requêtes par clé par jour, dépasse le haut de l'échelle de chaque clé.",
  },
  "apiusage.left_out": {
    en: "The chart and the totals count at most {n} keys with requests in these days, the keys in use first, then the ones revoked most recently.",
    fr: "Le graphique et les totaux comptent au plus {n} clés ayant des requêtes au cours de ces jours, d'abord les clés en service, puis les plus récemment révoquées.",
  },
  "apiusage.counted": {
    en: "Requests are counted by UTC day, and one refused at the cap is not counted. Each day's count is kept for {days} days.",
    fr: "Les requêtes sont comptées par jour UTC, et une requête refusée au plafond n'est pas comptée. Le compte de chaque jour est conservé {days} jours.",
  },
  "apiusage.col_day": { en: "Day (UTC)", fr: "Jour (UTC)" },
  "apiusage.keys_page": {
    en: "The keys, their names and the endpoints are on the {keys} page.",
    fr: "Les clés, leurs noms et les points d'accès sont sur la page {keys}.",
  },

  // -- deletion ------------------------------------------------------------------------
  "account.delete_title": { en: "Delete the Account", fr: "Supprimer le compte" },
  "account.delete_lead": { en: "Deleting the account cannot be undone.", fr: "La suppression du compte est définitive." },
  "account.panel_delete_what": { en: "What Is Removed", fr: "Ce qui est retiré" },
  "account.delete_subscription": {
    en: "A Pro subscription, if there is one, is cancelled first, at once: it is not charged again, and the period already paid is not refunded.",
    fr: "Un abonnement Pro, s'il y en a un, est d'abord annulé, immédiatement : il n'est plus facturé, et la période déjà payée n'est pas remboursée.",
  },
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
    en: "Signing in is optional; every page works without an account. An account keeps the email address, the language, when it was created and last used, its plan, its saved searches, the names of its API keys and, for 60 days, how many requests each key made each day.",
    fr: "La connexion est facultative; toutes les pages fonctionnent sans compte. Un compte conserve l'adresse courriel, la langue, sa date de création et de dernière utilisation, son forfait, ses recherches enregistrées, les noms de ses clés d'API et, pendant 60 jours, le nombre de requêtes faites chaque jour par chaque clé.",
  },
  "account.privacy_secrets": {
    en: "There are no passwords. Sign-in codes, sign-in links, the session and API keys are stored only as one-way hashes. A signed-in browser holds a second cookie, __Host-aw_session, which keeps the session for 30 days after its last use.",
    fr: "Il n'y a pas de mot de passe. Les codes et liens de connexion, la session et les clés d'API ne sont conservés que sous forme de hachages à sens unique. Un navigateur connecté détient un second témoin, __Host-aw_session, qui conserve la session pendant 30 jours après sa dernière utilisation.",
  },
  "account.privacy_not_kept": {
    en: "An account keeps no name, postal address, IP address or browser identification. A sign-in request, made on the sign-in page or with the Follow field of a page, keeps for one day the email address it was made for and a hash of the IP address under a key that changes every day, whether or not the sign-in is completed.",
    fr: "Un compte ne conserve aucun nom, adresse postale, adresse IP ni identification de navigateur. Une demande de connexion, faite à la page de connexion ou dans le champ Suivre d'une page, conserve pendant un jour l'adresse courriel pour laquelle elle a été faite et un hachage de l'adresse IP sous une clé qui change chaque jour, que la connexion soit menée à terme ou non.",
  },
  "account.privacy_delete": {
    en: "Deleting the account from its own page removes its saved searches, keys and sessions and replaces the email address with a hash that cannot be matched to it.",
    fr: "La suppression du compte, depuis sa propre page, retire ses recherches enregistrées, ses clés et ses sessions et remplace l'adresse courriel par un hachage qui ne peut pas lui être rapproché.",
  },

  // -- deliveries (phase 2: src/account/deliveries.ts, digests.ts, the stop page) --------
  "account.searches_lead_deliver": {
    en: "Filters you follow, saved from the site's lists and pages. On the Pro plan, each one can be delivered by email, each day or each week.",
    fr: "Les filtres que vous suivez, enregistrés à partir des listes et des pages du site. Avec le forfait Pro, chacun peut être envoyé par courriel, chaque jour ou chaque semaine.",
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
    en: "The email address is handed to Cloudflare's email service to deliver the site's messages: the sign-in code, the saved searches whose delivery is on, and the events of the pages followed while their mail is on. Apart from the checkout described under Payments, it is used for nothing else.",
    fr: "L'adresse courriel est transmise au service de courriel de Cloudflare pour livrer les messages du site : le code de connexion, les recherches enregistrées dont l'envoi est activé et les événements des pages suivies lorsque leur envoi est activé. Hormis le paiement décrit à la section Paiements, elle ne sert à rien d'autre.",
  },
  // The privacy page's accounts section (privacy.tsx): what following keeps.
  "watches.privacy": {
    en: "The pages an account follows are kept with it: the organization, buyer, contract or tender notice, the events to show for it and, for its mail, the daily or weekly setting and, for {days} days, when each message went and how many events it held. A message names public records only.",
    fr: "Les pages qu'un compte suit sont conservées avec lui : l'organisation, l'acheteur, le contrat ou l'avis d'appel d'offres, les événements à afficher et, pour l'envoi, le réglage quotidien ou hebdomadaire ainsi que, pendant {days} jours, le moment de chaque message et le nombre d'événements qu'il contenait. Un message ne nomme que des documents publics.",
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
    en: "1 contract now within {months} months of its end: {scope}",
    fr: "1 contrat désormais à moins de {months} mois de sa fin : {scope}",
  },
  "digest.expiring_subject_many": {
    en: "{n} contracts now within {months} months of their end: {scope}",
    fr: "{n} contrats désormais à moins de {months} mois de leur fin : {scope}",
  },
  "digest.expiring_subject_all_one": {
    en: "1 contract now within {months} months of its end",
    fr: "1 contrat désormais à moins de {months} mois de sa fin",
  },
  "digest.expiring_subject_all_many": {
    en: "{n} contracts now within {months} months of their end",
    fr: "{n} contrats désormais à moins de {months} mois de leur fin",
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
  "digest.expiring_button": { en: "See the contracts ending", fr: "Voir les contrats prenant fin" },
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
  // The organization, buyer and segment deliveries (records_deliveries.ts,
  // digests.ts recordsDigest): counts by source and fiscal year that rose,
  // and a segment's new tender notices. "Records" as the alerts page says it.
  "digest.records_title_organization": { en: "New records naming {name}", fr: "Nouveaux dossiers qui nomment {name}" },
  "digest.records_title_buyer": { en: "New records from {name}", fr: "Nouveaux dossiers de {name}" },
  "digest.records_title_segment": { en: "New in segment {name}", fr: "Nouveautés du segment {name}" },
  "digest.records_subject": { en: "{what}: {scope}", fr: "{what} : {scope}" },
  "digest.records_subject_one": { en: "1 new record", fr: "1 nouveau dossier" },
  "digest.records_subject_many": { en: "{n} new records", fr: "{n} nouveaux dossiers" },
  "digest.records_lead": {
    en: "Your saved search {label}. Data date {date}.",
    fr: "Votre recherche enregistrée {label}. Date des données : {date}.",
  },
  "digest.records_tenders_one": { en: "1 notice published since {since}.", fr: "1 avis publié depuis {since}." },
  "digest.records_tenders_many": { en: "{n} notices published since {since}.", fr: "{n} avis publiés depuis {since}." },
  "digest.records_counted": { en: "Records counted", fr: "Dossiers comptés" },
  "digest.records_more_one": {
    en: "1 more record than at {since}, by source and federal fiscal year.",
    fr: "1 dossier de plus qu'à {since}, par source et par exercice financier fédéral.",
  },
  "digest.records_more_many": {
    en: "{n} more records than at {since}, by source and federal fiscal year.",
    fr: "{n} dossiers de plus qu'à {since}, par source et par exercice financier fédéral.",
  },
  "digest.records_row": { en: "{more} more, {n} in all", fr: "{more} de plus, {n} au total" },
  "digest.records_value": { en: "Counted value {value}", fr: "Valeur comptée : {value}" },
  "digest.records_no_value": { en: "No counted value", fr: "Aucune valeur comptée" },
  "digest.records_button_organization": { en: "Open the profile", fr: "Ouvrir le profil" },
  "digest.records_button_buyer": { en: "Open the buyer page", fr: "Ouvrir la page de l'acheteur" },
  "digest.records_button_segment": { en: "Open the segment page", fr: "Ouvrir la page du segment" },
  "digest.records_note": {
    en: "The records database counts each source by federal fiscal year, as the analytics views do. A count rises when a record is added to it, or when a correction moves one into it. The page lists each record.",
    fr: "La base des dossiers compte chaque source par exercice financier fédéral, comme les vues analytiques. Un compte augmente quand un dossier s'y ajoute, ou quand une correction l'y déplace. La page énumère chaque dossier.",
  },
  // -- billing (src/account/billing.tsx) ----------------------------------------------
  // The prices are never written here: {price} is the operator's figure from
  // wrangler.jsonc (PRICE_MONTHLY_CAD, PRICE_YEARLY_CAD).
  "billing.title": { en: "Plan and Billing", fr: "Forfait et facturation" },
  "billing.lead": { en: "Your plan today: {plan}.", fr: "Votre forfait actuel : {plan}." },
  "billing.unavailable": {
    en: "Paying for Pro is not available yet. Every page of the site stays free to read, with or without an account.",
    fr: "Le paiement du forfait Pro n'est pas encore offert. Toutes les pages du site restent gratuites, avec ou sans compte.",
  },
  "billing.panel_pro": { en: "What Pro Includes", fr: "Ce que comprend Pro" },
  "billing.pro_searches": {
    en: "Up to {n} saved searches; the Free plan keeps {free}.",
    fr: "Jusqu'à {n} recherches enregistrées; le forfait Gratuit en conserve {free}.",
  },
  "billing.pro_delivery": {
    en: "Saved searches sent by email, daily or weekly.",
    fr: "L'envoi des recherches enregistrées par courriel, chaque jour ou chaque semaine.",
  },
  "billing.pro_intraday": {
    en: "Same-day tender notices on the tender lists, refreshed every two hours through the business day.",
    fr: "Les avis d'appel d'offres du jour dans les listes d'appels d'offres, actualisés toutes les deux heures pendant la journée de travail.",
  },
  // The radar's deeper windows (pages/expiring.tsx, plan.ts allowsRadarDepth).
  "billing.pro_radar": {
    en: "The 6-month and 12-month lists of contracts ending, with their CSV file; the Free plan keeps the 3-month list.",
    fr: "Les listes des contrats prenant fin d'ici 6 et 12 mois, avec leur fichier CSV; le forfait Gratuit conserve la liste à 3 mois.",
  },
  // The analytics views (pages/analytics.tsx, plan.ts allowsAnalytics).
  "billing.pro_analytics": {
    en: "Analytics of each buyer, organization and segment over up to ten fiscal years, with a CSV file of each table; the Free plan sees each view's first chart for three fiscal years.",
    fr: "Les analyses de chaque acheteur, organisation et segment sur jusqu'à dix exercices, avec un fichier CSV de chaque tableau; le forfait Gratuit voit le premier graphique de chaque vue pour trois exercices.",
  },
  // The bug report form (bugs.tsx); the line keeps the page's no-reply promise.
  "billing.pro_bugs": {
    en: "A form under the account to report a bug. No reply is promised; fixes show up on the site.",
    fr: "Un formulaire dans le compte pour signaler un bogue. Aucune réponse n'est promise; les correctifs apparaissent sur le site.",
  },
  "billing.panel_subscribe": { en: "Subscribe to Pro", fr: "S'abonner à Pro" },
  "billing.monthly": { en: "Monthly, CA${price} a month", fr: "Mensuel, {price} $ CA par mois" },
  "billing.yearly": { en: "Yearly, CA${price} a year (CA${per_month} a month)", fr: "Annuel, {price} $ CA par année ({per_month} $ CA par mois)" },
  "billing.taxes": {
    en: "Prices in Canadian dollars. Taxes added at checkout.",
    fr: "Prix en dollars canadiens. Taxes ajoutées au paiement.",
  },
  "billing.processor": {
    en: "Payment is taken on Stripe's page. Card details go to Stripe and never reach this site. Pro is sold through Link, the merchant of record run by Stripe, on behalf of Allwater Software Inc., which publishes Award Watch. The card statement reads LINK.COM followed by Allwater's name; Link sends the receipts and handles refunds and the applicable sales taxes.",
    fr: "Le paiement se fait sur la page de Stripe. Les données de carte vont à Stripe et n'atteignent jamais ce site. Pro est vendu par l'intermédiaire de Link, le marchand officiel exploité par Stripe, pour le compte d'Allwater Software Inc., qui publie Award Watch. Le relevé de carte indique LINK.COM suivi du nom d'Allwater; Link envoie les reçus et s'occupe des remboursements et des taxes de vente applicables.",
  },
  "billing.renewal": {
    en: "The subscription renews at the end of each period until it is cancelled. A cancellation takes effect at the end of the period already paid, which is not refunded.",
    fr: "L'abonnement se renouvelle à la fin de chaque période jusqu'à son annulation. Une annulation prend effet à la fin de la période déjà payée, qui n'est pas remboursée.",
  },
  "billing.terms": { en: "Subscribing accepts the {terms}.", fr: "S'abonner vaut acceptation des {terms}." },
  // The privacy page's Payments section while accounts are open (privacy.tsx):
  // what Stripe gets, and what payment_customers, payment_reversals and the
  // entitlements keep (accounts_schema.sql).
  "billing.privacy_toc": { en: "Payments", fr: "Paiements" },
  "billing.privacy_processor": {
    en: "Pro is paid for on Stripe's own pages: the checkout, and the portal where a subscription is changed or cancelled. Card details go to Stripe and never reach this site. Pro is sold through Link, the merchant of record operated by Stripe, on behalf of Allwater Software Inc., and Link sends the receipts.",
    fr: "Pro se paie sur les pages de Stripe : la page de paiement et le portail où un abonnement est modifié ou annulé. Les données de carte vont à Stripe et n'atteignent jamais ce site. Pro est vendu par l'intermédiaire de Link, le marchand officiel exploité par Stripe, pour le compte d'Allwater Software Inc., et Link envoie les reçus.",
  },
  "billing.privacy_sent": {
    en: "When a checkout starts, the site gives Stripe the account's id and, the first time, its email address, so that the payment is tied to the account.",
    fr: "Au début d'un paiement, le site transmet à Stripe l'identifiant du compte et, la première fois, son adresse courriel, pour que le paiement soit rattaché au compte.",
  },
  "billing.privacy_kept": {
    en: "For a paid plan, the site keeps the plan with its start and end dates, Stripe's customer and subscription identifiers, and the subscription's status. For a payment refunded in full or disputed, it keeps Stripe's identifier for the charge for {days} days. It keeps no card details, billing address, tax number or amount.",
    fr: "Pour un forfait payant, le site conserve le forfait avec ses dates de début et de fin, les identifiants de client et d'abonnement de Stripe et l'état de l'abonnement. Pour un paiement remboursé en entier ou contesté, il conserve l'identifiant de Stripe pour ce débit pendant {days} jours. Il ne conserve aucune donnée de carte, adresse de facturation, numéro de taxe ni montant.",
  },
  "billing.privacy_delete": {
    en: "Deleting the account cancels the subscription at Stripe first, without refund. What the site keeps for the plan and its payments stays as the record of what was paid, under the account's id and Stripe's identifiers, without the email address.",
    fr: "La suppression du compte annule d'abord l'abonnement chez Stripe, sans remboursement. Ce que le site conserve du forfait et de ses paiements reste comme trace de ce qui a été payé, sous l'identifiant du compte et les identifiants de Stripe, sans l'adresse courriel.",
  },
  "billing.panel_subscription": { en: "Your Subscription", fr: "Votre abonnement" },
  "billing.field_status": { en: "Status", fr: "État" },
  "billing.field_period": { en: "Current period ends", fr: "Fin de la période en cours" },
  "billing.status_active": { en: "Active", fr: "Actif" },
  "billing.status_trialing": { en: "Trial", fr: "Essai" },
  "billing.status_past_due": { en: "Renewal payment overdue", fr: "Paiement de renouvellement en retard" },
  "billing.status_unpaid": { en: "Unpaid", fr: "Impayé" },
  "billing.status_incomplete": { en: "Waiting for the first payment", fr: "En attente du premier paiement" },
  "billing.status_paused": { en: "Paused", fr: "En pause" },
  "billing.status_other": { en: "Being confirmed", fr: "En cours de confirmation" },
  "billing.past_due_note": {
    en: "The last renewal payment did not go through. Update the card on Stripe's page to keep Pro.",
    fr: "Le dernier paiement de renouvellement n'est pas passé. Mettez la carte à jour sur la page de Stripe pour conserver Pro.",
  },
  "billing.manage_text": {
    en: "Stripe's page switches between monthly and yearly, updates the card, lists the receipts and cancels the subscription.",
    fr: "La page de Stripe permet de passer du mensuel à l'annuel, de mettre la carte à jour, de consulter les reçus et d'annuler l'abonnement.",
  },
  "billing.manage": { en: "Manage the subscription", fr: "Gérer l'abonnement" },
  "billing.panel_receipts": { en: "Earlier Receipts", fr: "Reçus antérieurs" },
  "billing.receipts_text": {
    en: "The receipts of an earlier subscription are on Stripe's page.",
    fr: "Les reçus d'un abonnement antérieur se trouvent sur la page de Stripe.",
  },
  "billing.receipts": { en: "See the receipts", fr: "Voir les reçus" },
  "billing.err_service": {
    en: "The payment service could not be reached. Nothing was charged. Try again in a few minutes.",
    fr: "Le service de paiement est injoignable. Rien n'a été facturé. Réessayez dans quelques minutes.",
  },
  "billing.err_busy": {
    en: "A checkout with other choices was started from this account a moment ago, in another page or tab. Finish it there, or start again in ten minutes.",
    fr: "Un paiement avec d'autres choix a été commencé depuis ce compte il y a un instant, dans une autre page ou un autre onglet. Terminez-le là, ou recommencez dans dix minutes.",
  },
  "billing.err_delete": {
    en: "The Pro subscription could not be cancelled, so the account was not deleted. Try again in a few minutes.",
    fr: "L'abonnement Pro n'a pas pu être annulé, donc le compte n'a pas été supprimé. Réessayez dans quelques minutes.",
  },
  "billing.msg_done": {
    en: "Thank you. Pro starts once Stripe confirms the payment, usually within a minute. Reload this page to see it.",
    fr: "Merci. Pro commence dès que Stripe confirme le paiement, en général en moins d'une minute. Rechargez cette page pour le voir.",
  },
  "billing.field": { en: "Billing", fr: "Facturation" },
  "billing.link_plans": { en: "Plans and prices", fr: "Forfaits et prix" },
  "billing.plan_stripe": { en: "Pro, paid until {date}", fr: "Pro, payé jusqu'au {date}" },
  // -- bug reports (src/account/bugs.tsx) ---------------------------------------------
  // A Pro feature. The site offers self-service and no support line, so the
  // page promises no reply; the corrections page stays the place for data.
  "bugs.link": { en: "Report a bug", fr: "Signaler un bogue" },
  "bugs.title": { en: "Report a Bug", fr: "Signaler un bogue" },
  "bugs.field": { en: "Bug reports", fr: "Rapports de bogue" },
  "bugs.lead": {
    en: "Describe something on the site that did not work as it should.",
    fr: "Décrivez ce qui, sur le site, n'a pas fonctionné comme il le devrait.",
  },
  "bugs.no_reply": {
    en: "No reply is promised. Fixes show up on the site.",
    fr: "Aucune réponse n'est promise. Les correctifs apparaissent sur le site.",
  },
  "bugs.corrections": {
    en: "For a record or a figure that looks wrong, use the {form}.",
    fr: "Pour un dossier ou un chiffre qui semble erroné, utilisez la {form}.",
  },
  "bugs.corrections_link": { en: "corrections page", fr: "page des corrections" },
  "bugs.panel": { en: "The Report", fr: "Le rapport" },
  "bugs.page": { en: "Page address", fr: "Adresse de la page" },
  "bugs.page_note": {
    en: "The page on this site where it happened, as a path or a full address.",
    fr: "La page de ce site où c'est arrivé, sous forme de chemin ou d'adresse complète.",
  },
  "bugs.text": { en: "What happened", fr: "Ce qui s'est passé" },
  "bugs.expected": { en: "What you expected (optional)", fr: "Ce que vous attendiez (facultatif)" },
  "bugs.send": { en: "Send the report", fr: "Envoyer le rapport" },
  "bugs.kept": {
    en: "The report is kept for {days} days with the account and sent to the site's inbox without your email address.",
    fr: "Le rapport est conservé {days} jours avec le compte et transmis à la boîte de réception du site sans votre adresse courriel.",
  },
  "bugs.pro_title": { en: "Part of Pro", fr: "Offert avec le forfait Pro" },
  "bugs.pro_text": {
    en: "Bug reports are part of Pro, the site's paid plan.",
    fr: "Les rapports de bogue font partie de Pro, le forfait payant du site.",
  },
  "bugs.err_page": {
    en: "The page address must be a page on this site, at most {max} characters.",
    fr: "L'adresse de la page doit désigner une page de ce site et compter au plus {max} caractères.",
  },
  "bugs.err_text": { en: "Describe what happened.", fr: "Décrivez ce qui s'est passé." },
  "bugs.err_limited": {
    en: "This account has sent {n} bug reports in the last 24 hours, the most a day allows. Try again later.",
    fr: "Ce compte a envoyé {n} rapports de bogue au cours des dernières 24 heures, le maximum permis par jour. Réessayez plus tard.",
  },
  "bugs.sent_title": { en: "Report Received", fr: "Rapport reçu" },
  "bugs.sent_lead": { en: "Thank you. The report was received.", fr: "Merci. Le rapport a été reçu." },
  // The privacy page's accounts section and the delete page's list (privacy.tsx, pages.tsx).
  "bugs.privacy": {
    en: "A bug report sent from a Pro account keeps the page address and what was typed into the form for {days} days, and is sent by email to the site's inbox without the account's email address.",
    fr: "Un rapport de bogue envoyé d'un compte Pro conserve l'adresse de la page et ce qui a été saisi dans le formulaire pendant {days} jours; il est transmis par courriel à la boîte de réception du site sans l'adresse courriel du compte.",
  },
  "bugs.delete": {
    en: "Every bug report sent from the account.",
    fr: "Tous les rapports de bogue envoyés à partir du compte.",
  },

  // -- operator console (src/account/admin.tsx) ---------------------------------------
  // Seen by the operator alone; the identifiers, times and event names in its
  // tables are shown as stored, untranslated.
  "admin.title": { en: "Operator Console", fr: "Console de l'exploitant" },
  "admin.description": { en: "The operator's console for accounts and payments.", fr: "La console de l'exploitant pour les comptes et les paiements." },
  "admin.lead": {
    en: "Accounts, plans and payments. Every action taken here is recorded in the audit trail under your user id.",
    fr: "Comptes, forfaits et paiements. Chaque action prise ici est inscrite au journal d'audit sous votre identifiant.",
  },
  "admin.panel_find": { en: "Find an Account", fr: "Trouver un compte" },
  "admin.find_label": { en: "Address (in full or its start) or user id", fr: "Adresse (complète ou son début) ou identifiant" },
  "admin.find": { en: "Find", fr: "Chercher" },
  "admin.panel_hits": { en: "Accounts Found", fr: "Comptes trouvés" },
  "admin.find_none": { en: "No account matches.", fr: "Aucun compte ne correspond." },
  "admin.panel_counts": { en: "Counts", fr: "Chiffres" },
  "admin.count_accounts": { en: "Active accounts", fr: "Comptes actifs" },
  "admin.count_deleted": { en: "Deleted accounts", fr: "Comptes supprimés" },
  "admin.count_blocked": { en: "Blocked accounts", fr: "Comptes bloqués" },
  "admin.count_sessions": { en: "Signed-in browsers", fr: "Navigateurs connectés" },
  "admin.count_pro_manual": { en: "On Pro now, granted by hand", fr: "En Pro maintenant, accordé à la main" },
  "admin.count_pro_stripe": { en: "On Pro now, paid through Stripe", fr: "En Pro maintenant, payé par Stripe" },
  "admin.count_subscriptions": { en: "Subscriptions by status", fr: "Abonnements par état" },
  "admin.count_sent": { en: "Deliveries sent, last {n} days", fr: "Envois effectués, {n} derniers jours" },
  "admin.count_failed": { en: "Deliveries not sent, last {n} days", fr: "Envois échoués, {n} derniers jours" },
  "admin.count_bugs_week": { en: "Bug reports, last {n} days", fr: "Signalements de bogues, {n} derniers jours" },
  "admin.count_bugs_all": { en: "Bug reports, all", fr: "Signalements de bogues, en tout" },
  "admin.count_codes": { en: "Sign-in codes issued today (UTC)", fr: "Codes de connexion émis aujourd'hui (UTC)" },
  "admin.none": { en: "None", fr: "Aucun" },
  "admin.never": { en: "Never", fr: "Jamais" },
  "admin.yes": { en: "Yes", fr: "Oui" },
  "admin.no": { en: "No", fr: "Non" },
  "admin.panel_audit": { en: "Latest Audit Events", fr: "Derniers événements du journal" },
  "admin.audit_none": { en: "No audit rows.", fr: "Aucune ligne au journal." },
  "admin.panel_bugs": { en: "Bug Reports", fr: "Signalements de bogues" },
  "admin.bugs_none": { en: "No bug reports.", fr: "Aucun signalement de bogue." },
  "admin.col_time": { en: "Time", fr: "Moment" },
  "admin.col_event": { en: "Event", fr: "Événement" },
  "admin.col_account": { en: "Account", fr: "Compte" },
  "admin.col_detail": { en: "Detail", fr: "Détail" },
  "admin.col_page": { en: "Page address", fr: "Adresse de la page" },
  "admin.col_report": { en: "Report", fr: "Signalement" },
  "admin.col_address": { en: "Address", fr: "Adresse" },
  "admin.col_user": { en: "User id", fr: "Identifiant" },
  "admin.col_status": { en: "Status", fr: "État" },
  "admin.col_plan": { en: "Plan", fr: "Forfait" },
  "admin.col_created": { en: "Created", fr: "Créé" },
  "admin.col_source": { en: "Source", fr: "Provenance" },
  "admin.col_starts": { en: "Starts", fr: "Début" },
  "admin.col_ends": { en: "Ends", fr: "Fin" },
  "admin.col_reference": { en: "Reference", fr: "Référence" },
  "admin.col_recorded": { en: "Recorded", fr: "Inscrit" },
  "admin.col_state": { en: "State", fr: "Situation" },
  "admin.col_search": { en: "Search", fr: "Recherche" },
  "admin.col_kind": { en: "Kind", fr: "Type" },
  "admin.col_delivery": { en: "Delivery", fr: "Envoi" },
  "admin.col_last": { en: "Last delivery", fr: "Dernier envoi" },
  "admin.col_prefix": { en: "Prefix", fr: "Préfixe" },
  "admin.col_last_used": { en: "Last used", fr: "Dernière utilisation" },
  "admin.col_revoked": { en: "Revoked", fr: "Révoquée" },
  "admin.status_active": { en: "Active", fr: "Actif" },
  "admin.status_deleted": { en: "Deleted", fr: "Supprimé" },
  "admin.user_eyebrow": { en: "Account", fr: "Compte" },
  "admin.deleted_title": { en: "Deleted Account", fr: "Compte supprimé" },
  "admin.back_user": { en: "Back to the account", fr: "Retour au compte" },
  "admin.panel_account": { en: "Account", fr: "Compte" },
  "admin.field_address": { en: "Address", fr: "Adresse" },
  "admin.field_user": { en: "User id", fr: "Identifiant" },
  "admin.field_created": { en: "Created", fr: "Créé" },
  "admin.field_seen": { en: "Last seen", fr: "Dernière visite" },
  "admin.field_lang": { en: "Language", fr: "Langue" },
  "admin.lang_en": { en: "English", fr: "Anglais" },
  "admin.lang_fr": { en: "French", fr: "Français" },
  "admin.field_status": { en: "Status", fr: "État" },
  "admin.field_cached": { en: "Plan as cached", fr: "Forfait en cache" },
  "admin.field_plan": { en: "Plan now, from the rows", fr: "Forfait actuel, selon les lignes" },
  "admin.field_blocked": { en: "Blocked", fr: "Bloqué" },
  "admin.blocked_since": { en: "Since {date}, by {by}: {reason}", fr: "Depuis le {date}, par {by} : {reason}" },
  "admin.panel_entitlements": { en: "Entitlements", fr: "Droits d'accès" },
  "admin.ent_none": { en: "No entitlement rows, so the plan is Free.", fr: "Aucune ligne de droit, donc le forfait est Gratuit." },
  "admin.ent_live": { en: "Live", fr: "En vigueur" },
  "admin.ent_future": { en: "Starts later", fr: "Commence plus tard" },
  "admin.ent_ended": { en: "Ended", fr: "Terminé" },
  "admin.ent_revoked": { en: "Revoked {date}", fr: "Révoqué le {date}" },
  "admin.source_manual": { en: "By hand", fr: "À la main" },
  "admin.source_stripe": { en: "Through Stripe", fr: "Par Stripe" },
  "admin.revoke": { en: "Revoke", fr: "Révoquer" },
  "admin.grant_until": {
    en: "End date (UTC, optional). Pro ends at the start of that day; leave it empty for no end.",
    fr: "Date de fin (UTC, facultative). Pro prend fin au début de ce jour; laissez vide pour aucune fin.",
  },
  "admin.grant_reference": {
    en: "Reference, a note or a payment reference (never an address)",
    fr: "Référence, une note ou une référence de paiement (jamais une adresse)",
  },
  "admin.grant_button": { en: "Grant Pro", fr: "Accorder Pro" },
  "admin.panel_subscription": { en: "Subscription", fr: "Abonnement" },
  "admin.sub_none": { en: "No Stripe customer is bound to this account.", fr: "Aucun client Stripe n'est lié à ce compte." },
  "admin.sub_no_keys": {
    en: "The Stripe keys are not set, so this is the stored row alone, and no cancellation or refund can be made from here.",
    fr: "Les clés Stripe ne sont pas définies, donc ceci est la seule ligne conservée, et aucune annulation ni aucun remboursement ne peut se faire d'ici.",
  },
  "admin.sub_unread": {
    en: "Stripe could not be read just now; the rows above are as last notified.",
    fr: "Stripe n'a pas pu être consulté pour le moment; les lignes ci-dessus sont celles du dernier avis.",
  },
  "admin.sub_missing": { en: "Stripe has no such subscription.", fr: "Stripe ne connaît pas cet abonnement." },
  "admin.field_customer": { en: "Stripe customer", fr: "Client Stripe" },
  "admin.field_subscription": { en: "Subscription", fr: "Abonnement" },
  "admin.field_stored_status": { en: "Status, last notified", fr: "État, au dernier avis" },
  "admin.field_stored_end": { en: "Period end, last notified", fr: "Fin de période, au dernier avis" },
  "admin.field_updated": { en: "Row updated", fr: "Ligne mise à jour" },
  "admin.field_live_status": { en: "Status at Stripe now", fr: "État chez Stripe maintenant" },
  "admin.field_live_end": { en: "Period end at Stripe", fr: "Fin de période chez Stripe" },
  "admin.field_cancel_end": { en: "Ends at the period end", fr: "Prend fin à la fin de la période" },
  "admin.cancel_link": { en: "Cancel the subscription", fr: "Annuler l'abonnement" },
  "admin.refund_link": { en: "Refund the latest payment", fr: "Rembourser le dernier paiement" },
  "admin.card_note": {
    en: "Card details stay with Stripe; this console never shows them.",
    fr: "Les données de carte restent chez Stripe; cette console ne les affiche jamais.",
  },
  "admin.panel_sessions": { en: "Sessions", fr: "Connexions" },
  "admin.field_newest": { en: "Newest use", fr: "Utilisation la plus récente" },
  "admin.field_devices": { en: "Devices signed in now", fr: "Appareils connectés maintenant" },
  "admin.device_desktop": { en: "desktop", fr: "ordinateur" },
  "admin.device_mobile": { en: "mobile", fr: "téléphone" },
  "admin.device_tablet": { en: "tablet", fr: "tablette" },
  "admin.device_unknown": { en: "unknown", fr: "inconnu" },
  "admin.sign_out_all": { en: "Sign out everywhere", fr: "Déconnecter partout" },
  "admin.panel_searches": { en: "Saved Searches", fr: "Recherches enregistrées" },
  "admin.searches_none": { en: "No saved searches.", fr: "Aucune recherche enregistrée." },
  "admin.d_sent": { en: "sent ({n} records)", fr: "envoyé ({n} fiches)" },
  "admin.d_empty": { en: "nothing new", fr: "rien de nouveau" },
  "admin.d_failed": { en: "not sent", fr: "non envoyé" },
  "admin.panel_keys": { en: "API Keys", fr: "Clés d'API" },
  "admin.keys_none": { en: "No API keys.", fr: "Aucune clé d'API." },
  "admin.panel_deliveries": { en: "Deliveries, Latest {n}", fr: "Envois, les {n} derniers" },
  "admin.deliveries_none": { en: "No deliveries.", fr: "Aucun envoi." },
  "admin.panel_audit_user": { en: "Audit Trail", fr: "Journal d'audit" },
  "admin.panel_actions": { en: "Actions", fr: "Interventions" },
  "admin.block_link": { en: "Block the account", fr: "Bloquer le compte" },
  "admin.unblock_button": { en: "Lift the block", fr: "Lever le blocage" },
  "admin.email_link": { en: "Change the address", fr: "Changer l'adresse" },
  "admin.delete_link": { en: "Delete the account", fr: "Supprimer le compte" },
  "admin.self_note": {
    en: "This is your own account. The console does not block it, change its address or delete it.",
    fr: "Ce compte est le vôtre. La console ne le bloque pas, ne change pas son adresse et ne le supprime pas.",
  },
  "admin.deleted_note": {
    en: "The account is deleted. Its rows stay as the record; only the subscription's cancellation and refund still apply.",
    fr: "Le compte est supprimé. Ses lignes restent comme registre; seuls l'annulation et le remboursement de l'abonnement s'appliquent encore.",
  },
  "admin.panel_what": { en: "What This Does", fr: "Ce que cela fait" },
  "admin.confirm_box": { en: "I have read what this does.", fr: "J'ai lu ce que cela fait." },
  "admin.block_title": { en: "Block the Account", fr: "Bloquer le compte" },
  "admin.block_lead": {
    en: "A block stands until it is lifted from the account's page.",
    fr: "Un blocage reste en place jusqu'à ce qu'il soit levé depuis la page du compte.",
  },
  "admin.block_sessions": {
    en: "Every session ends, and signing in is refused with the message an expired code gets.",
    fr: "Toutes les sessions prennent fin, et la connexion est refusée avec le message que reçoit un code expiré.",
  },
  "admin.block_delivery": {
    en: "Email delivery of its saved searches is turned off, and turned back on when the block is lifted.",
    fr: "L'envoi par courriel de ses recherches enregistrées est désactivé, puis réactivé à la levée du blocage.",
  },
  "admin.block_keys": { en: "Its API keys are refused while the block stands.", fr: "Ses clés d'API sont refusées tant que le blocage reste en place." },
  "admin.block_plan": {
    en: "The site serves it as signed out, so every page shows the free view. Its entitlements and its subscription stay as they are; cancel the subscription separately.",
    fr: "Le site le traite comme déconnecté, donc chaque page montre la version gratuite. Ses droits d'accès et son abonnement restent tels quels; annulez l'abonnement séparément.",
  },
  "admin.block_reason": { en: "Reason, kept with the block (never an address)", fr: "Motif, conservé avec le blocage (jamais une adresse)" },
  "admin.block_button": { en: "Block the account", fr: "Bloquer le compte" },
  "admin.email_title": { en: "Change the Address", fr: "Changer l'adresse" },
  "admin.email_lead": { en: "The account's address is {email} today.", fr: "L'adresse du compte est {email} aujourd'hui." },
  "admin.email_unique": { en: "No other account may hold the new address.", fr: "Aucun autre compte ne peut détenir la nouvelle adresse." },
  "admin.email_sessions": {
    en: "Every session of the account ends; the reader signs in again with the new address.",
    fr: "Toutes les sessions du compte prennent fin; la personne se reconnecte avec la nouvelle adresse.",
  },
  "admin.email_notice": {
    en: "The new address receives a message saying the site's operator changed the account's address.",
    fr: "La nouvelle adresse reçoit un message indiquant que l'exploitant du site a changé l'adresse du compte.",
  },
  "admin.email_no_mail": {
    en: "Mail is not set up here, so no message goes to the new address.",
    fr: "Le courriel n'est pas configuré ici, donc aucun message ne part vers la nouvelle adresse.",
  },
  "admin.email_old": {
    en: "The old address can then sign up again as a new account.",
    fr: "L'ancienne adresse peut ensuite s'inscrire de nouveau comme un nouveau compte.",
  },
  "admin.email_new": { en: "New address", fr: "Nouvelle adresse" },
  "admin.email_button": { en: "Change the address", fr: "Changer l'adresse" },
  "admin.cancel_title": { en: "Cancel the Subscription", fr: "Annuler l'abonnement" },
  "admin.cancel_lead": { en: "Two ways to end it; neither refunds anything.", fr: "Deux façons d'y mettre fin; aucune ne rembourse quoi que ce soit." },
  "admin.cancel_end_text": {
    en: "At the period end: Pro runs to {date}, the end of the period paid. Stripe then ends the subscription, and its notice ends Pro.",
    fr: "À la fin de la période : Pro se poursuit jusqu'au {date}, la fin de la période payée. Stripe met ensuite fin à l'abonnement, et son avis met fin à Pro.",
  },
  "admin.cancel_end_button": { en: "Cancel at the period end", fr: "Annuler à la fin de la période" },
  "admin.cancel_now_text": {
    en: "At once: Stripe ends the subscription now and charges nothing more. Pro ends when Stripe's notice arrives, usually within a minute. Refund the latest payment separately if it should be refunded.",
    fr: "Immédiatement : Stripe met fin à l'abonnement maintenant et ne facture plus rien. Pro prend fin à l'arrivée de l'avis de Stripe, en général en moins d'une minute. Remboursez le dernier paiement séparément s'il doit l'être.",
  },
  "admin.cancel_now_button": { en: "Cancel at once", fr: "Annuler immédiatement" },
  "admin.cancel_already_end": { en: "Stripe will already end it at the period end.", fr: "Stripe y mettra déjà fin à la fin de la période." },
  "admin.refund_title": { en: "Refund the Latest Payment", fr: "Rembourser le dernier paiement" },
  "admin.refund_lead": {
    en: "The charge behind the subscription's latest paid invoice, as Stripe reports it.",
    fr: "Le paiement lié à la dernière facture payée de l'abonnement, tel que Stripe le présente.",
  },
  "admin.refund_full": {
    en: "Stripe refunds whatever part of this charge has not been refunded yet.",
    fr: "Stripe rembourse toute la partie de ce paiement qui n'a pas encore été remboursée.",
  },
  "admin.refund_pro": {
    en: "Stripe's refund notice then ends the account's Stripe Pro at once.",
    fr: "L'avis de remboursement de Stripe met ensuite fin immédiatement au Pro payé par Stripe du compte.",
  },
  "admin.refund_subscription": {
    en: "The subscription is not cancelled. Cancel it as well if it should not bill again.",
    fr: "L'abonnement n'est pas annulé. Annulez-le aussi s'il ne doit plus facturer.",
  },
  "admin.refund_button": { en: "Refund in full", fr: "Rembourser en entier" },
  "admin.field_invoice": { en: "Invoice", fr: "Facture" },
  "admin.field_charge": { en: "Charge", fr: "Paiement" },
  "admin.field_amount": { en: "Amount", fr: "Montant" },
  "admin.field_refunded": { en: "Refunded already", fr: "Déjà remboursé" },
  "admin.field_paid": { en: "Paid on", fr: "Payé le" },
  "admin.delete_title": { en: "Delete the Account", fr: "Supprimer le compte" },
  "admin.delete_lead": {
    en: "The same deletion a reader makes from their own account page.",
    fr: "La même suppression que celle qu'une personne fait depuis sa propre page de compte.",
  },
  "admin.delete_subscription": {
    en: "A subscription that can still bill is cancelled at Stripe first, at once and without a refund. If Stripe cannot confirm it, nothing is deleted.",
    fr: "Un abonnement qui peut encore facturer est d'abord annulé chez Stripe, immédiatement et sans remboursement. Si Stripe ne peut pas le confirmer, rien n'est supprimé.",
  },
  "admin.delete_rows": {
    en: "Sessions are revoked; saved searches with their delivery records, API keys, sign-in requests and email alert requests are deleted.",
    fr: "Les sessions sont révoquées; les recherches enregistrées avec leurs registres d'envoi, les clés d'API, les demandes de connexion et les demandes d'alertes par courriel sont supprimées.",
  },
  "admin.delete_email": {
    en: "The address is replaced by a hash that cannot be reversed, so the address can sign up again as a new account.",
    fr: "L'adresse est remplacée par un hachage irréversible, donc l'adresse peut s'inscrire de nouveau comme un nouveau compte.",
  },
  "admin.delete_kept": {
    en: "The entitlement rows, the payment rows and the audit trail stay, tied to the user id alone.",
    fr: "Les lignes de droits, les lignes de paiement et le journal d'audit restent, liés au seul identifiant.",
  },
  "admin.delete_blocked": {
    en: "The block ends with the account, and the address can sign up again.",
    fr: "Le blocage prend fin avec le compte, et l'adresse peut s'inscrire de nouveau.",
  },
  "admin.delete_button": { en: "Delete the account", fr: "Supprimer le compte" },
  "admin.msg_granted": { en: "Pro granted.", fr: "Pro accordé." },
  "admin.msg_revoked": { en: "The row was revoked.", fr: "La ligne a été révoquée." },
  "admin.msg_nothing": {
    en: "Nothing was revoked; the row was revoked or had ended already.",
    fr: "Rien n'a été révoqué; la ligne était déjà révoquée ou terminée.",
  },
  "admin.msg_cancel_end": { en: "Stripe will end the subscription at the period end.", fr: "Stripe mettra fin à l'abonnement à la fin de la période." },
  "admin.msg_cancel_now": {
    en: "Stripe ended the subscription. Pro ends when its notice arrives.",
    fr: "Stripe a mis fin à l'abonnement. Pro prend fin à l'arrivée de son avis.",
  },
  "admin.msg_refunded": {
    en: "Stripe took the refund. Its notice ends the account's Stripe Pro; the subscription bills again unless it is cancelled.",
    fr: "Stripe a accepté le remboursement. Son avis met fin au Pro payé par Stripe du compte; l'abonnement facture de nouveau s'il n'est pas annulé.",
  },
  "admin.msg_blocked": { en: "The account is blocked.", fr: "Le compte est bloqué." },
  "admin.msg_already_blocked": { en: "The account was blocked already.", fr: "Le compte était déjà bloqué." },
  "admin.msg_unblocked": {
    en: "The block is lifted. Delivery was turned back on for {n} saved searches.",
    fr: "Le blocage est levé. L'envoi a été réactivé pour {n} recherches enregistrées.",
  },
  "admin.msg_not_blocked": { en: "The account was not blocked.", fr: "Le compte n'était pas bloqué." },
  "admin.msg_email": {
    en: "The address was changed, every session ended, and the new address was told.",
    fr: "L'adresse a été changée, toutes les sessions ont pris fin, et la nouvelle adresse a été avisée.",
  },
  "admin.msg_email_unsent": {
    en: "The address was changed and every session ended. No message reached the new address, since mail is not set up or the message was refused.",
    fr: "L'adresse a été changée et toutes les sessions ont pris fin. Aucun message n'a atteint la nouvelle adresse, car le courriel n'est pas configuré ou le message a été refusé.",
  },
  "admin.msg_signed_out": { en: "Every session of the account ended.", fr: "Toutes les sessions du compte ont pris fin." },
  "admin.msg_deleted": { en: "The account was deleted.", fr: "Le compte a été supprimé." },
  "admin.err_reference": {
    en: "Write a reference of at most {n} characters, without an address.",
    fr: "Écrivez une référence d'au plus {n} caractères, sans adresse.",
  },
  "admin.err_reason": {
    en: "Write a reason of at most {n} characters, without an address.",
    fr: "Écrivez un motif d'au plus {n} caractères, sans adresse.",
  },
  "admin.err_date": {
    en: "Give the end date as a day after today (YYYY-MM-DD).",
    fr: "Indiquez comme date de fin un jour après aujourd'hui (AAAA-MM-JJ).",
  },
  "admin.err_email": { en: "Give a complete address.", fr: "Indiquez une adresse complète." },
  "admin.err_email_same": { en: "That is the account's address already.", fr: "C'est déjà l'adresse du compte." },
  "admin.err_email_taken": { en: "Another account holds that address.", fr: "Un autre compte détient cette adresse." },
  "admin.err_confirm": { en: "Tick the box to confirm.", fr: "Cochez la case pour confirmer." },
  "admin.err_stripe": {
    en: "Stripe could not be reached, or refused the request. Nothing was changed.",
    fr: "Stripe est injoignable, ou a refusé la demande. Rien n'a été modifié.",
  },
  "admin.err_no_keys": {
    en: "Payments are not set up here; the Stripe keys are missing.",
    fr: "Les paiements ne sont pas configurés ici; les clés Stripe manquent.",
  },
  "admin.err_no_subscription": {
    en: "The account has no subscription that can still bill.",
    fr: "Le compte n'a aucun abonnement qui peut encore facturer.",
  },
  "admin.err_no_charge": {
    en: "No paid invoice of the account's subscription took money through a charge.",
    fr: "Aucune facture payée de l'abonnement du compte n'a été réglée par un paiement.",
  },
  "admin.err_charge_moved": {
    en: "The latest payment is not the one shown before. Review it again below.",
    fr: "Le dernier paiement n'est pas celui affiché auparavant. Vérifiez-le de nouveau ci-dessous.",
  },
  "admin.err_refunded": { en: "That charge is refunded in full already.", fr: "Ce paiement est déjà remboursé en entier." },
  "admin.err_self": {
    en: "This is your own account; the console does not do this to it.",
    fr: "Ce compte est le vôtre; la console ne lui fait pas cela.",
  },
  "admin.err_deleted": { en: "The account is deleted; this does not apply to it.", fr: "Le compte est supprimé; cela ne s'y applique pas." },
  "admin.mail_subject": { en: "Your Award Watch address was changed", fr: "Votre adresse Award Watch a été changée" },
  "admin.mail_body": {
    en: "The site's operator changed the address of your Award Watch account to this one. Sign in with this address from now on.",
    fr: "L'exploitant du site a remplacé l'adresse de votre compte Award Watch par celle-ci. Connectez-vous désormais avec cette adresse.",
  },
  "admin.mail_sign_in": { en: "Sign in at {link}", fr: "Connexion à {link}" },
  "admin.mail_contact": {
    en: "If you did not ask for this change, write to {contact}.",
    fr: "Si vous n'avez pas demandé ce changement, écrivez à {contact}.",
  },
  // The accounts table (/admin/accounts). Stripe's subscription statuses in
  // its filter and column are shown as stored, like the user page's.
  "admin.accounts_link": { en: "All accounts", fr: "Tous les comptes" },
  "admin.accounts_title": { en: "Accounts", fr: "Comptes" },
  "admin.accounts_lead": {
    en: "Every account, newest sign-up first. A column heading sorts by that column, and a second click reverses the order. The CSV holds the current filters and order, at most {n} rows.",
    fr: "Tous les comptes, l'inscription la plus récente en premier. Un en-tête de colonne trie selon cette colonne, et un second clic inverse l'ordre. Le CSV reprend les filtres et l'ordre actuels, au plus {n} lignes.",
  },
  "admin.accounts_csv": { en: "Download CSV", fr: "Télécharger le CSV" },
  "admin.accounts_filters": { en: "Filters", fr: "Filtres" },
  "admin.filter_address": { en: "Address starts with", fr: "L'adresse commence par" },
  "admin.any": { en: "Any", fr: "Indifférent" },
  "admin.plan_free_now": { en: "Free now", fr: "Gratuit maintenant" },
  "admin.plan_pro_now": { en: "Pro now", fr: "Pro maintenant" },
  "admin.delivery_some": { en: "On for at least one search", fr: "Activé pour au moins une recherche" },
  "admin.delivery_none": { en: "Off for every search", fr: "Désactivé pour toutes les recherches" },
  "admin.sub_filter_none": { en: "No subscription", fr: "Aucun abonnement" },
  "admin.col_signed_up": { en: "Signed up", fr: "Inscription" },
  "admin.col_sign_in": { en: "Last sign-in", fr: "Dernière connexion" },
  "admin.col_searches": { en: "Saved searches", fr: "Recherches enregistrées" },
  "admin.col_delivery_on": { en: "Delivery on", fr: "Envoi activé" },
  "admin.col_keys": { en: "API keys", fr: "Clés d'API" },
  "admin.col_subscription": { en: "Subscription", fr: "Abonnement" },
  "admin.blocked_on": { en: "Yes, since {date}", fr: "Oui, depuis le {date}" },
  "admin.accounts_count_one": { en: "{n} account, showing {from} to {to}", fr: "{n} compte, affichage de {from} à {to}" },
  "admin.accounts_count_many": { en: "{n} accounts, showing {from} to {to}", fr: "{n} comptes, affichage de {from} à {to}" },
  "admin.accounts_cap": {
    en: "Only the first {n} can be paged through; filter to see the rest.",
    fr: "Seuls les {n} premiers peuvent être parcourus; filtrez pour voir les autres.",
  },
  // The accounts-open message (/admin/announce; src/account/announce.tsx).
  "admin.announce_link": { en: "Accounts-open message", fr: "Message d'ouverture des comptes" },
  "admin.announce_title": { en: "Accounts-Open Message", fr: "Message d'ouverture des comptes" },
  "admin.announce_lead": {
    en: "One plain message to each address on the email lists that holds no account and has not had it, in the language of its first sign-up: accounts are open, and its lists become saved searches when it signs in. At most {n} a run; run it again to go on.",
    fr: "Un message simple à chaque adresse des listes de diffusion qui n'a pas de compte et ne l'a pas encore reçu, dans la langue de sa première inscription : les comptes sont ouverts, et ses listes deviennent des recherches enregistrées à la connexion. Au plus {n} par passage; relancez-le pour continuer.",
  },
  "admin.announce_waiting": {
    en: "Addresses that have not had it: {n}. Those holding an account are passed over when the run meets them.",
    fr: "Adresses qui ne l'ont pas reçu : {n}. Celles qui ont un compte sont écartées quand le passage les rencontre.",
  },
  "admin.announce_sent": { en: "Addresses it went to so far: {n}.", fr: "Adresses auxquelles il est parti jusqu'ici : {n}." },
  "admin.announce_mark": {
    en: "Each address is marked when its message goes, so no run sends it twice. An address the mail service refuses stays unmarked for the next run.",
    fr: "Chaque adresse est marquée quand son message part, de sorte qu'aucun passage ne l'envoie deux fois. Une adresse que le service de courriel refuse reste non marquée pour le passage suivant.",
  },
  "admin.announce_limit": {
    en: "A daily or rate limit of the mail service ends the run; the next run goes on from there.",
    fr: "Une limite quotidienne ou de débit du service de courriel arrête le passage; le suivant reprend à partir de là.",
  },
  "admin.announce_preview": { en: "The message, with one list: {lang}", fr: "Le message, avec une liste : {lang}" },
  "admin.announce_button": { en: "Send up to {n} messages", fr: "Envoyer jusqu'à {n} messages" },
  "admin.announce_done": {
    en: "Messages sent: {sent}. Not sent: {failed}. Passed over, holding an account: {accounts}. Addresses that have not had it: {left}.",
    fr: "Messages envoyés : {sent}. Non envoyés : {failed}. Adresses écartées, qui ont un compte : {accounts}. Adresses qui ne l'ont pas reçu : {left}.",
  },
  "admin.announce_stopped": {
    en: "The run stopped at the mail service's limit ({code}); run it again later.",
    fr: "Le passage s'est arrêté à la limite du service de courriel ({code}); relancez-le plus tard.",
  },
  "admin.announce_no_mail": {
    en: "Mail cannot be sent from here: the MAIL binding or MAIL_FROM is missing.",
    fr: "Aucun courriel ne peut partir d'ici : la liaison MAIL ou MAIL_FROM manque.",
  },
  "admin.announce_no_column": {
    en: "The interest table has no notice_at column yet. Add it first, as docs/accounts.md says under The accounts-open message.",
    fr: "La table interest n'a pas encore de colonne notice_at. Ajoutez-la d'abord, comme l'indique docs/accounts.md sous The accounts-open message.",
  },
  // The message itself, in the language of the address's first sign-up, and
  // the page its link opens (/interest/stop?t=), which takes the address off
  // the lists. No price, and nothing promised without the plan.
  "announce.subject": { en: "Award Watch accounts are open", fr: "Les comptes Award Watch sont ouverts" },
  "announce.lead": { en: "Accounts are open on Award Watch.", fr: "Les comptes sont ouverts sur Award Watch." },
  "announce.lists": { en: "This address is signed up for these email lists:", fr: "Cette adresse est inscrite à ces listes de diffusion :" },
  "announce.lists_more_one": { en: "And 1 more.", fr: "Et 1 autre." },
  "announce.lists_more_many": { en: "And {n} more.", fr: "Et {n} autres." },
  "announce.saved": {
    en: "Sign in with this address and each list is offered to the account as a saved search. Email delivery of a saved search is part of the Pro plan.",
    fr: "Connectez-vous avec cette adresse et chaque liste est proposée au compte comme recherche enregistrée. L'envoi par courriel d'une recherche enregistrée fait partie du forfait Pro.",
  },
  "announce.only": { en: "This is the only message about these lists.", fr: "C'est le seul message au sujet de ces listes." },
  "announce.stop_link": { en: "Take this address off the lists", fr: "Retirer cette adresse des listes" },
  "announce.why": {
    en: "You receive this because the address was entered on the site's email lists form.",
    fr: "Vous recevez ce message parce que l'adresse a été inscrite au formulaire des listes de diffusion du site.",
  },
  "announce.stop_title": { en: "Leave the Email Lists", fr: "Quitter les listes de diffusion" },
  "announce.stop_lead": {
    en: "The address this link was sent to is on the lists below. Taking it off removes the address from them: nothing more is sent to it, and the lists are not offered to an account.",
    fr: "L'adresse à laquelle ce lien a été envoyé figure sur les listes ci-dessous. La retirer l'efface de ces listes : rien de plus ne lui est envoyé, et les listes ne sont pas proposées à un compte.",
  },
  "announce.stop_panel": { en: "Lists", fr: "Listes" },
  "announce.stop_button": { en: "Take the address off", fr: "Retirer l'adresse" },
  "announce.stopped_title": { en: "Address Removed", fr: "Adresse retirée" },
  "announce.stopped_lead": {
    en: "The address is off the email lists and no longer kept with them. Nothing more is sent to it.",
    fr: "L'adresse a été retirée des listes de diffusion et n'est plus conservée avec elles. Rien de plus ne lui est envoyé.",
  },
  "announce.stopped_one_click": { en: "The address is off the email lists.", fr: "L'adresse a été retirée des listes de diffusion." },

  // -- watches (src/account/watches.ts, watch_pages.tsx, watch_mail.ts) --------------
  // A watch follows one organization, buyer, published contract or open
  // tender notice; its events are listed on the watches page for every plan,
  // and mailed on Pro. "Suivi" in French, apart from the browser watchlist
  // ("liste de suivi"), which stays in the browser.
  "watches.title": { en: "Watches", fr: "Suivis" },
  "watches.lead": {
    en: "The organizations, buyers, published contracts and tender notices you follow, with what happened to each over the last 30 data dates.",
    fr: "Les organisations, acheteurs, contrats publiés et appels d'offres que vous suivez, avec ce qui est arrivé à chacun au cours des 30 dernières dates des données.",
  },
  "watches.description": {
    en: "The pages your account follows and their events.",
    fr: "Les pages que suit votre compte et leurs événements.",
  },
  "watches.n": { en: "{n} of {cap}", fr: "{n} sur {cap}" },
  "watches.kind_organization": { en: "Organization", fr: "Organisation" },
  "watches.kind_buyer": { en: "Buyer", fr: "Acheteur" },
  "watches.kind_contract": { en: "Contract", fr: "Contrat" },
  "watches.kind_tender": { en: "Tender notice", fr: "Appel d'offres" },
  "watches.ev_award": { en: "New award or contract", fr: "Nouvelle attribution ou nouveau contrat" },
  "watches.ev_grant": { en: "New grant or contribution", fr: "Nouvelle subvention ou contribution" },
  "watches.ev_cancelled": { en: "Contract cancelled", fr: "Contrat annulé" },
  "watches.ev_ended": { en: "Contract ended", fr: "Contrat terminé" },
  "watches.ev_notice_cancelled": { en: "Tender notice cancelled", fr: "Appel d'offres annulé" },
  "watches.ev_notice_awarded": { en: "Tender notice awarded", fr: "Appel d'offres attribué" },
  "watches.line_end_moved": { en: "end moved from {from} to {to}", fr: "fin reportée du {from} au {to}" },
  "watches.line_closing_moved": { en: "Closing moved from {from} to {to}", fr: "Clôture reportée du {from} au {to}" },
  "watches.line_title_changed": { en: "Title changed", fr: "Titre modifié" },
  "watches.line_amendment": { en: "amendment {n}", fr: "modification {n}" },
  "watches.line_value_before": { en: "Value before {value}", fr: "Valeur auparavant : {value}" },
  "watches.line_ended": { en: "Ended {date}", fr: "A pris fin le {date}" },
  "watches.line_awarded": { en: "Awarded to {name}", fr: "Attribué à {name}" },
  "watches.line_withheld": { en: "Supplier withheld", fr: "Fournisseur non divulgué" },
  "watches.also": { en: "Also on your watch of {labels}", fr: "Aussi dans votre suivi de {labels}" },
  "watches.segment_label": { en: "Follow", fr: "Suivre" },
  "watches.segment_all": { en: "The whole buyer", fr: "L'acheteur en entier" },
  "watches.segment_note": {
    en: "A watch narrowed to a segment reports the award notices, contract history and notices in it; published contracts and grants carry no segment.",
    fr: "Un suivi restreint à un segment signale les avis d'attribution, l'historique des contrats et les avis de ce segment; les contrats publiés et les subventions n'ont pas de segment.",
  },
  "watches.moved_note": {
    en: "Watches now following the organization or buyer theirs was merged into: {n}.",
    fr: "Suivis qui suivent maintenant l'organisation ou l'acheteur dans lequel le leur a été fusionné : {n}.",
  },
  "watches.merged_note": {
    en: "Watches removed because the account already followed the record theirs was merged into: {n}.",
    fr: "Suivis retirés parce que le compte suivait déjà le dossier dans lequel le leur a été fusionné : {n}.",
  },
  "watches.admin_panel": { en: "Watches", fr: "Suivis" },
  "watches.admin_mail_on": { en: "Accounts with watch mail on", fr: "Comptes dont le courriel des suivis est activé" },
  "watches.admin_runs": { en: "Watch mail runs, last {n} days", fr: "Envois du courriel des suivis, {n} derniers jours" },
  "watches.admin_runs_value": { en: "sent {sent}, nothing new {empty}, failed {failed}", fr: "envoyés {sent}, rien de nouveau {empty}, échecs {failed}" },
  "watches.admin_events": { en: "Events on the data date {date}", fr: "Événements à la date des données {date}" },
  "watches.admin_events_none": { en: "The events cannot be read.", fr: "Les événements ne peuvent pas être lus." },
  "watches.admin_col_subject": { en: "Subject", fr: "Sujet" },
  "watches.admin_col_segment": { en: "UNSPSC segment", fr: "Segment UNSPSC" },
  "watches.admin_col_cadence": { en: "Cadence", fr: "Fréquence" },
  "watches.admin_col_covered": { en: "Covered to", fr: "Couvert jusqu'au" },
  "watches.admin_col_since": { en: "Added", fr: "Ajouté" },
  "watches.admin_runs_title": { en: "Watch Mail Runs", fr: "Envois du courriel des suivis" },
  "watches.admin_none": { en: "No watch.", fr: "Aucun suivi." },
  "watches.ev_amended": { en: "Contract amended", fr: "Contrat modifié" },
  "watches.ev_ends_12m": { en: "Ends within 12 months", fr: "Prend fin d'ici 12 mois" },
  "watches.ev_ends_6m": { en: "Ends within 6 months", fr: "Prend fin d'ici 6 mois" },
  "watches.ev_notice": { en: "New tender notice", fr: "Nouvel appel d'offres" },
  "watches.ev_notice_amended": { en: "Tender notice amended", fr: "Appel d'offres modifié" },
  "watches.ev_notice_closed": { en: "Tender notice closed", fr: "Appel d'offres fermé" },
  "watches.line_value": { en: "Value {value}", fr: "Valeur : {value}" },
  "watches.line_was": { en: "{was} to {value} ({change})", fr: "de {was} à {value} ({change})" },
  "watches.line_ends": { en: "Ends {date}", fr: "Prend fin le {date}" },
  "watches.line_closes": { en: "Closes {date}", fr: "Ferme le {date}" },
  "watches.line_closed": { en: "Closing date {date}", fr: "Date de clôture : {date}" },
  "watches.line_dated": { en: "Dated {date}", fr: "Daté du {date}" },
  "watches.line_found": { en: "First seen {date}", fr: "Vu pour la première fois le {date}" },
  "watches.more_one": { en: "{kind}: 1 more on the page", fr: "{kind} : 1 autre sur la page" },
  "watches.more_many": { en: "{kind}: {n} more on the page", fr: "{kind} : {n} autres sur la page" },
  "watches.count_one": { en: "1 event", fr: "1 événement" },
  "watches.count_many": { en: "{n} events", fr: "{n} événements" },

  // The page.
  "watches.panel_mail": { en: "Watch Mail", fr: "Courriel des suivis" },
  "watches.mail_text": {
    en: "One message per data date, grouped by watch, with each watch's events since its last message. Each watch is sent daily or weekly, as set below.",
    fr: "Un message par date des données, regroupé par suivi, avec les événements de chaque suivi depuis son dernier message. Chaque suivi est envoyé chaque jour ou chaque semaine, selon le réglage ci-dessous.",
  },
  "watches.mail_label": { en: "Watch mail", fr: "Courriel des suivis" },
  "watches.mail_on": { en: "On", fr: "Activé" },
  "watches.mail_off": { en: "Off", fr: "Désactivé" },
  "watches.save": { en: "Save", fr: "Enregistrer" },
  "watches.last_none": { en: "No message yet.", fr: "Aucun message pour l'instant." },
  "watches.last_sent_one": { en: "Last message {time}, 1 event.", fr: "Dernier message le {time}, 1 événement." },
  "watches.last_sent_many": { en: "Last message {time}, {n} events.", fr: "Dernier message le {time}, {n} événements." },
  "watches.last_empty": { en: "Checked {time}, nothing new.", fr: "Vérifié le {time}, rien de nouveau." },
  "watches.last_failed": {
    en: "Not sent {time}. The next message includes what it missed.",
    fr: "Non envoyé le {time}. Le prochain message comprend ce qu'il a manqué.",
  },
  "watches.mail_gate": {
    en: "Email of these events is part of Pro: one message per data date, grouped by watch, daily or weekly for each.",
    fr: "Le courriel de ces événements fait partie de Pro : un message par date des données, regroupé par suivi, chaque jour ou chaque semaine pour chacun.",
  },
  "watches.panel": { en: "Watches", fr: "Suivis" },
  "watches.col_watch": { en: "Watch", fr: "Suivi" },
  "watches.col_events": { en: "Last 30 data dates", fr: "30 dernières dates des données" },
  "watches.col_settings": { en: "Follows", fr: "Suit" },
  "watches.col_remove": { en: "Remove", fr: "Retirer" },
  "watches.remove": { en: "Remove", fr: "Retirer" },
  "watches.none": {
    en: "No watch yet. Use the Follow button on an organization, a buyer, a published contract or an open tender notice.",
    fr: "Aucun suivi pour l'instant. Utilisez le bouton Suivre d'une organisation, d'un acheteur, d'un contrat publié ou d'un appel d'offres ouvert.",
  },
  "watches.events_none": { en: "Nothing in the last 30 data dates.", fr: "Rien au cours des 30 dernières dates des données." },
  "watches.events_unread": {
    en: "The events cannot be read just now. Try again in a few minutes.",
    fr: "Les événements ne peuvent pas être lus pour le moment. Réessayez dans quelques minutes.",
  },
  "watches.last_event": { en: "Last event {date}", fr: "Dernier événement le {date}" },
  "watches.closed_note": {
    en: "This notice is closed; its watch ends after this event.",
    fr: "Cet appel d'offres est fermé; son suivi prend fin après cet événement.",
  },
  "watches.cadence_label": { en: "Email", fr: "Courriel" },
  "watches.cadence_daily": { en: "Daily", fr: "Chaque jour" },
  "watches.cadence_weekly": { en: "Weekly", fr: "Chaque semaine" },
  "watches.cap_free": {
    en: "This account follows {n} of {cap} pages. Pro follows up to {max} and sends their events by email.",
    fr: "Pages suivies par ce compte : {n} sur {cap}. Pro en suit jusqu'à {max} et envoie leurs événements par courriel.",
  },
  "watches.cap_pro": { en: "Up to {cap} pages.", fr: "Jusqu'à {cap} pages." },
  "watches.add_note": {
    en: "To add one, use the Follow button on an organization, a buyer, a published contract or an open tender notice.",
    fr: "Pour en ajouter un, utilisez le bouton Suivre d'une organisation, d'un acheteur, d'un contrat publié ou d'un appel d'offres ouvert.",
  },
  "watches.msg_added": { en: "Watch added.", fr: "Suivi ajouté." },
  "watches.msg_exists": { en: "This page is watched already.", fr: "Cette page est déjà suivie." },
  "watches.msg_removed": { en: "Watch removed.", fr: "Suivi retiré." },
  "watches.msg_changed": { en: "Watch saved.", fr: "Suivi enregistré." },
  "watches.msg_unchanged": { en: "Nothing saved: choose at least one event.", fr: "Rien d'enregistré : choisissez au moins un événement." },
  "watches.msg_mail": { en: "Watch mail saved.", fr: "Courriel des suivis enregistré." },
  "watches.msg_pro": { en: "Email of watches is part of Pro.", fr: "Le courriel des suivis fait partie de Pro." },
  "watches.msg_gone": { en: "That page is no longer in the data.", fr: "Cette page ne figure plus dans les données." },

  // The Watch control on the pages.
  "watches.button": { en: "Follow", fr: "Suivre" },
  "watches.watching": { en: "Following", fr: "Suivi" },
  "watches.control_free": {
    en: "Its events show on your watches page.",
    fr: "Ses événements s'affichent sur votre page des suivis.",
  },
  "watches.control_pro": {
    en: "Its events show on your watches page and come by email.",
    fr: "Ses événements s'affichent sur votre page des suivis et arrivent par courriel.",
  },
  // A reader not signed in: the address field and Follow on the page itself (watch_pages.tsx).
  "watches.control_out": {
    en: "Free, with no password. The site sends a sign-in link to that address; once you sign in, this page's events show on your watches page: a new award, an amendment, an end date near, a new or closed notice.",
    fr: "Gratuit, sans mot de passe. Le site envoie un lien de connexion à cette adresse; après la connexion, les événements de cette page s'affichent sur votre page des suivis : une nouvelle attribution, une modification, une fin proche, un avis nouveau ou fermé.",
  },
  "watches.signin_placeholder": { en: "Your email address", fr: "Votre adresse courriel" },
  "watches.control_cap_pro": {
    en: "This account follows {cap} pages, the most an account keeps.",
    fr: "Ce compte suit {cap} pages, le maximum qu'un compte conserve.",
  },
  "watches.manage": { en: "Manage your watches", fr: "Gérer vos suivis" },

  // The message.
  "watches.digest_subject_one": { en: "1 update on what you follow: {labels}", fr: "1 nouveauté sur ce que vous suivez : {labels}" },
  "watches.digest_subject_many": { en: "{n} updates on what you follow: {labels}", fr: "{n} nouveautés sur ce que vous suivez : {labels}" },
  "watches.digest_title": { en: "Your Watches", fr: "Vos suivis" },
  "watches.digest_lead_one": {
    en: "1 update on 1 of the {all} pages you follow. Data date {date}.",
    fr: "1 nouveauté sur 1 des {all} pages que vous suivez. Date des données : {date}.",
  },
  "watches.digest_lead_many": {
    en: "{n} updates on {w} of the {all} pages you follow. Data date {date}.",
    fr: "{n} nouveautés sur {w} des {all} pages que vous suivez. Date des données : {date}.",
  },
  "watches.digest_button": { en: "Open your watches", fr: "Ouvrir vos suivis" },
  "watches.digest_note": {
    en: "A contract's value is its newest amendment's. \"Ends\" is the date the record states. First seen is the refresh that first carried the record; a record can be published weeks after its date.",
    fr: "La valeur d'un contrat est celle de sa plus récente modification. « Prend fin » est la date que le dossier indique. « Vu pour la première fois » est la mise à jour qui a porté le dossier en premier; un dossier peut être publié des semaines après sa date.",
  },
  "watches.digest_why": {
    en: "You receive this because your account watches these pages by email.",
    fr: "Vous recevez ce message parce que votre compte suit ces pages par courriel.",
  },
  "watches.digest_link": { en: "Your watches", fr: "Vos suivis" },
  "watches.digest_stop": { en: "Stop watch mail", fr: "Arrêter le courriel des suivis" },

  // The stop link of a message (/account/stop?w=...&t=...).
  "watches.stop_title": { en: "Stop Watch Mail", fr: "Arrêter le courriel des suivis" },
  "watches.stop_lead": {
    en: "This turns off the email of your watches. The watches stay on your account, with their events on the watches page.",
    fr: "Ceci désactive le courriel de vos suivis. Les suivis restent dans votre compte, avec leurs événements sur la page des suivis.",
  },
  "watches.stop_button": { en: "Turn watch mail off", fr: "Désactiver le courriel des suivis" },
  "watches.stop_already": { en: "Watch mail is already off.", fr: "Le courriel des suivis est déjà désactivé." },
  "watches.stopped_title": { en: "Watch Mail Off", fr: "Courriel des suivis désactivé" },
  "watches.stopped_lead": {
    en: "The email of your watches is off. Turn it back on from the watches page.",
    fr: "Le courriel de vos suivis est désactivé. Réactivez-le à partir de la page des suivis.",
  },
  "watches.stopped_one_click": { en: "Watch mail is off.", fr: "Le courriel des suivis est désactivé." },

  // The account's other pages and the console.
  "watches.delete": {
    en: "Your watches and their email setting.",
    fr: "Vos suivis et leur réglage de courriel.",
  },
  "watches.admin_field": { en: "Watches", fr: "Suivis" },
  "watches.admin_value": { en: "{n}, mail {mail}", fr: "{n}, courriel {mail}" },
  "watches.pro_include": {
    en: "watches on organizations, buyers, contracts and tender notices, with their events by email",
    fr: "des suivis d'organisations, d'acheteurs, de contrats et d'appels d'offres, avec leurs événements par courriel",
  },
  "watches.pro_page": {
    en: "Watches on up to {n} organizations, buyers, published contracts and tender notices, each event sent by email daily or weekly; the Free plan follows {free} without email.",
    fr: "Des suivis de jusqu'à {n} organisations, acheteurs, contrats publiés et appels d'offres, chaque événement envoyé par courriel chaque jour ou chaque semaine; le forfait Gratuit en suit {free} sans courriel.",
  },

  // -- your organization (org_claim.ts, org_pages.tsx) ------------------------------
  "orgclaim.title": { en: "Your Organization", fr: "Votre organisation" },
  "orgclaim.title_short": { en: "Your organization", fr: "Votre organisation" },
  "orgclaim.overview_none": { en: "None chosen yet", fr: "Aucune organisation choisie pour le moment" },
  "orgclaim.lead": {
    en: "Tell the site which organization is yours to see, in one place, its records by fiscal year and segment, its share of a segment beside up to five organizations you choose, its contracts ending within 12 months and the buyers it has won from.",
    fr: "Indiquez au site quelle organisation est la vôtre pour voir au même endroit ses dossiers par exercice et par segment, sa part d'un segment à côté de jusqu'à cinq organisations de votre choix, ses contrats prenant fin d'ici 12 mois et les acheteurs auprès desquels elle a obtenu des contrats.",
  },
  "orgclaim.lead_claimed": {
    en: "The figures of {name}, the organization you told the site is yours, from the same records as its profile.",
    fr: "Les chiffres de {name}, l'organisation que vous avez indiquée comme la vôtre, tirés des mêmes dossiers que son profil.",
  },
  "orgclaim.panel_find": { en: "Find Your Organization", fr: "Trouver votre organisation" },
  "orgclaim.search_label": { en: "Organization name, or the address of its profile", fr: "Nom de l'organisation, ou adresse de son profil" },
  "orgclaim.compare_label": {
    en: "Add an organization: its name, or the address of its profile",
    fr: "Ajouter une organisation : son nom, ou l'adresse de son profil",
  },
  "orgclaim.search_note": {
    en: "The search reads the names the site holds, as the site search does; the address of a profile finds that profile.",
    fr: "La recherche porte sur les noms que le site connaît, comme la recherche du site; l'adresse d'un profil trouve ce profil.",
  },
  "orgclaim.search_button": { en: "Search", fr: "Chercher" },
  "orgclaim.private": {
    en: "Your choice is private to your account and changes nothing public: no page, feed or file shows it, and the organization's profile reads the same for every reader.",
    fr: "Votre choix reste privé à votre compte et ne change rien de public : aucune page, aucun fil ni aucun fichier ne le montre, et le profil de l'organisation reste le même pour tous les lecteurs.",
  },
  "orgclaim.private_claimed": {
    en: "You have told the site this is your organization. The site does not check this and shows it to no one else.",
    fr: "Vous avez indiqué au site que c'est votre organisation. Le site ne le vérifie pas et ne le montre à personne d'autre.",
  },
  "orgclaim.panel_results": { en: "Results", fr: "Résultats" },
  "orgclaim.search_unavailable": {
    en: "The search is not available right now. Paste the address of the organization's profile instead.",
    fr: "La recherche n'est pas disponible pour le moment. Collez plutôt l'adresse du profil de l'organisation.",
  },
  "orgclaim.search_none": {
    en: "No organization matches. Try fewer words, or paste the address of its profile.",
    fr: "Aucune organisation ne correspond. Essayez moins de mots, ou collez l'adresse de son profil.",
  },
  "orgclaim.search_first": { en: "The first {n} of {total} organizations that match.", fr: "Les {n} premières des {total} organisations qui correspondent." },
  "orgclaim.search_count_one": { en: "{n} organization matches.", fr: "{n} organisation correspond." },
  "orgclaim.search_count_many": { en: "{n} organizations match.", fr: "{n} organisations correspondent." },
  "orgclaim.col_claim": { en: "Choose", fr: "Choisir" },
  "orgclaim.col_compare": { en: "Compare", fr: "Comparer" },
  "orgclaim.this_is_us": { en: "This is us", fr: "C'est nous" },
  "orgclaim.compare": { en: "Compare", fr: "Comparer" },
  "orgclaim.is_yours": { en: "Your organization", fr: "Votre organisation" },
  "orgclaim.in_set": { en: "Already compared", fr: "Déjà comparée" },
  "orgclaim.set_full_short": { en: "The comparison is full", fr: "La comparaison est complète" },
  "orgclaim.changing": {
    en: "You told the site {name} is yours. Choosing another replaces it.",
    fr: "Vous avez indiqué {name} comme la vôtre. En choisir une autre la remplace.",
  },
  "orgclaim.keep": { en: "Keep it", fr: "La garder" },
  "orgclaim.records_one": { en: "{n} record", fr: "{n} dossier" },
  "orgclaim.records_many": { en: "{n} records", fr: "{n} dossiers" },

  // The blocks.
  "orgclaim.panel_years": { en: "Records by Fiscal Year", fr: "Dossiers par exercice" },
  "orgclaim.years_lead": {
    en: "Each source apart, {first} to {last}: the records naming the organization and their counted value.",
    fr: "Chaque source à part, de {first} à {last} : les dossiers qui nomment l'organisation et leur valeur comptée.",
  },
  "orgclaim.foot_years": {
    en: "A figure never adds two sources: one contract can appear in several.",
    fr: "Un chiffre n'additionne jamais deux sources : un même contrat peut figurer dans plusieurs.",
  },
  "orgclaim.free_years": {
    en: "The Free plan shows the latest {n} fiscal years; Pro shows {max} and the blocks below.",
    fr: "Le forfait Gratuit montre les {n} derniers exercices; Pro en montre {max}, avec les blocs ci-dessous.",
  },
  "orgclaim.none_years": {
    en: "No record naming this organization in the last {n} fiscal years.",
    fr: "Aucun dossier ne nomme cette organisation au cours des {n} derniers exercices.",
  },
  "orgclaim.panel_segments": { en: "Records by Segment", fr: "Dossiers par segment" },
  "orgclaim.foot_segments": {
    en: "Each record counts once, in its first UNSPSC segment. Published contracts and grants carry no segment and are not in this table (published contracts: {contracts}; grants: {grants}).",
    fr: "Chaque dossier compte une fois, dans son premier segment UNSPSC. Les contrats publiés et les subventions ne portent aucun segment et ne figurent pas dans ce tableau (contrats publiés : {contracts}; subventions : {grants}).",
  },
  "orgclaim.none_segments": {
    en: "No award notice or PSPC contract history record names this organization in the last {n} fiscal years.",
    fr: "Aucun avis d'attribution ni dossier de l'historique des contrats de SPAC ne nomme cette organisation au cours des {n} derniers exercices.",
  },
  "orgclaim.panel_share": { en: "Share of a Segment", fr: "Part d'un segment" },
  "orgclaim.share_lead": {
    en: "Each organization's share of the counted value of segment {segment}, {source}, by fiscal year; the segment's whole value is the denominator.",
    fr: "La part de chaque organisation dans la valeur comptée du segment {segment}, {source}, par exercice; la valeur totale du segment est le dénominateur.",
  },
  "orgclaim.share_caveat": {
    en: "Records whose supplier is withheld count in the segment's value and in no organization's share; an organization with no record in a year shows 0%.",
    fr: "Les dossiers dont le fournisseur est caché comptent dans la valeur du segment et dans la part d'aucune organisation; une organisation sans dossier pour un exercice affiche 0 %.",
  },
  "orgclaim.share_alone": {
    en: "Add up to {n} organizations to compare in the panel above; until then the block shows yours alone.",
    fr: "Ajoutez jusqu'à {n} organisations à comparer dans le panneau ci-dessus; d'ici là, le bloc montre la vôtre seule.",
  },
  "orgclaim.col_segment_value": { en: "Segment value", fr: "Valeur du segment" },
  "orgclaim.share_period": { en: "{n} fiscal years", fr: "{n} exercices" },
  "orgclaim.none_share": {
    en: "No record of this source ({source}) names this organization in a segment in the last {n} fiscal years.",
    fr: "Aucun dossier de cette source ({source}) ne nomme cette organisation dans un segment au cours des {n} derniers exercices.",
  },
  "orgclaim.none_share_value": { en: "The segment has no counted value in these fiscal years.", fr: "Le segment n'a aucune valeur comptée pour ces exercices." },
  "orgclaim.segment_largest": { en: "The largest: {segment}", fr: "Le plus important : {segment}" },
  "orgclaim.foot_share": {
    en: "The organizations compared are the ones you chose, in the order you added them.",
    fr: "Les organisations comparées sont celles que vous avez choisies, dans l'ordre où vous les avez ajoutées.",
  },
  "orgclaim.panel_ending": { en: "Contracts Ending Within 12 Months", fr: "Contrats prenant fin d'ici 12 mois" },
  "orgclaim.ending_lead_one": {
    en: "{n} contract of this organization ends within 12 months of the data date, on {date}; its counted value is {total}.",
    fr: "{n} contrat de cette organisation prend fin d'ici 12 mois après la date des données, le {date}; sa valeur comptée est de {total}.",
  },
  "orgclaim.ending_lead_many": {
    en: "{n} contracts of this organization end within 12 months of the data date, the soonest on {date}; their counted value is {total}.",
    fr: "{n} contrats de cette organisation prennent fin d'ici 12 mois après la date des données, le plus proche le {date}; leur valeur comptée est de {total}.",
  },
  "orgclaim.ending_all": { en: "All {n} on the 12-month list", fr: "Les {n} dans la liste sur 12 mois" },
  "orgclaim.ending_list": { en: "On the 12-month list", fr: "Dans la liste sur 12 mois" },
  "orgclaim.none_ending": {
    en: "No contract of this organization ends within 12 months of the data date.",
    fr: "Aucun contrat de cette organisation ne prend fin d'ici 12 mois après la date des données.",
  },
  "orgclaim.panel_buyers": { en: "Buyers It Has Won From", fr: "Acheteurs auprès desquels elle a obtenu des contrats" },
  "orgclaim.col_its_records": { en: "Its records with the buyer", fr: "Ses dossiers avec l'acheteur" },
  "orgclaim.col_open": { en: "Open notices", fr: "Avis ouverts" },
  "orgclaim.col_ending": { en: "Ending within 12 months", fr: "Fin d'ici 12 mois" },
  "orgclaim.foot_buyers": {
    en: "Up to {n} buyers, those with the most records naming the organization over the last ten fiscal years: the first {shown} here, all of them in the CSV file, and every record in {records}. Open notices are the buyer's now; contracts ending are the buyer's within 12 months, whoever holds them.",
    fr: "Jusqu'à {n} acheteurs, ceux qui ont le plus de dossiers nommant l'organisation au cours des dix derniers exercices : les {shown} premiers ici, tous dans le fichier CSV, et chaque dossier dans {records}. Les avis ouverts sont ceux de l'acheteur en ce moment; les contrats prenant fin sont ceux de l'acheteur d'ici 12 mois, quel qu'en soit le titulaire.",
  },
  "orgclaim.records_link": { en: "its record table", fr: "son tableau de dossiers" },
  "orgclaim.none_buyers": {
    en: "No record names this organization and a buyer in the last {n} fiscal years.",
    fr: "Aucun dossier ne nomme cette organisation et un acheteur au cours des {n} derniers exercices.",
  },
  "orgclaim.panel_registry": { en: "Registry Match", fr: "Correspondance au registre" },
  "orgclaim.tease_segments": {
    en: "Its award notices and PSPC contract history by UNSPSC segment over ten fiscal years, with the CSV file.",
    fr: "Ses avis d'attribution et son historique des contrats de SPAC par segment UNSPSC sur dix exercices, avec le fichier CSV.",
  },
  "orgclaim.tease_share": {
    en: "Its share of a segment's counted value by fiscal year beside up to {n} organizations you choose, with the segment's whole value as the denominator.",
    fr: "Sa part de la valeur comptée d'un segment par exercice à côté de jusqu'à {n} organisations de votre choix, avec la valeur totale du segment comme dénominateur.",
  },
  "orgclaim.tease_ending": {
    en: "Its own contracts ending within 12 months, soonest first, with their amendments and value growth.",
    fr: "Ses propres contrats prenant fin d'ici 12 mois, les plus proches d'abord, avec leurs modifications et la croissance de leur valeur.",
  },
  "orgclaim.tease_buyers": {
    en: "The buyers it has won from, each with its notices open now and its contracts ending within 12 months.",
    fr: "Les acheteurs auprès desquels elle a obtenu des contrats, chacun avec ses avis ouverts et ses contrats prenant fin d'ici 12 mois.",
  },
  "orgclaim.tease_registry": {
    en: "The corporate registry entries matched to it, with the grade of each match.",
    fr: "Les inscriptions au registre des sociétés qui lui sont associées, avec le degré de chaque correspondance.",
  },

  // The claim and the comparison.
  "orgclaim.panel_claim": { en: "Your Choice", fr: "Votre choix" },
  "orgclaim.field_since": { en: "Chosen on", fr: "Choisie le" },
  "orgclaim.change": { en: "Change", fr: "Changer" },
  "orgclaim.remove_claim": { en: "Remove your choice", fr: "Retirer votre choix" },
  "orgclaim.panel_compare": { en: "Organizations to Compare", fr: "Organisations à comparer" },
  "orgclaim.compare_n": { en: "{n} of {max}", fr: "{n} sur {max}" },
  "orgclaim.foot_compare": {
    en: "Up to {n}, any organization with a profile; the share block shows them in this order.",
    fr: "Jusqu'à {n}, toute organisation qui a un profil; le bloc des parts les montre dans cet ordre.",
  },
  "orgclaim.compare_remove": { en: "Remove", fr: "Retirer" },
  "orgclaim.compare_none": { en: "None yet. Add up to {n} with the search below.", fr: "Aucune pour le moment. Ajoutez-en jusqu'à {n} avec la recherche ci-dessous." },
  "orgclaim.set_full": {
    en: "The comparison holds {n}, the most it takes. Remove one to add another.",
    fr: "La comparaison en compte {n}, le maximum. Retirez-en une pour en ajouter une autre.",
  },
  "orgclaim.gone_title": { en: "Profile No Longer in the Data", fr: "Profil absent des données" },
  "orgclaim.gone_text": {
    en: "The files no longer hold this organization's profile, and no other profile took its records. Change your choice to pick the organization again.",
    fr: "Les fichiers ne contiennent plus le profil de cette organisation, et aucun autre profil n'a repris ses dossiers. Changez votre choix pour désigner de nouveau l'organisation.",
  },
  "orgclaim.unavailable_title": { en: "Figures Not Available Right Now", fr: "Chiffres non disponibles pour le moment" },
  "orgclaim.unavailable_text": {
    en: "The records database could not be read. Your choice and the organizations you compare are kept; try again later.",
    fr: "La base des dossiers n'a pas pu être lue. Votre choix et les organisations comparées sont conservés; réessayez plus tard.",
  },
  "orgclaim.msg_claimed": { en: "Saved. Only your account sees which organization you chose.", fr: "Enregistré. Seul votre compte voit l'organisation choisie." },
  "orgclaim.msg_unclaimed": { en: "Your choice is removed.", fr: "Votre choix est retiré." },
  "orgclaim.msg_added": { en: "Added to the comparison.", fr: "Ajoutée à la comparaison." },
  "orgclaim.msg_compare_removed": { en: "Removed from the comparison.", fr: "Retirée de la comparaison." },
  "orgclaim.msg_exists": { en: "That organization is already in the comparison.", fr: "Cette organisation figure déjà dans la comparaison." },
  "orgclaim.msg_self": {
    en: "That is your own organization; it is always in the comparison.",
    fr: "C'est votre propre organisation; elle figure toujours dans la comparaison.",
  },
  "orgclaim.msg_full": {
    en: "The comparison holds five organizations already, the most it takes. Remove one first.",
    fr: "La comparaison compte déjà cinq organisations, le maximum. Retirez-en une d'abord.",
  },
  "orgclaim.msg_busy": {
    en: "The comparison changed in another window; nothing was saved. Try again.",
    fr: "La comparaison a changé dans une autre fenêtre; rien n'a été enregistré. Réessayez.",
  },
  "orgclaim.msg_segment": { en: "The share block's segment is saved.", fr: "Le segment du bloc des parts est enregistré." },
  "orgclaim.msg_moved": {
    en: "The organization you chose was merged into another profile; your choice now follows that profile.",
    fr: "L'organisation choisie a été fusionnée avec un autre profil; votre choix suit maintenant ce profil.",
  },
  "orgclaim.msg_repointed_one": {
    en: "{n} organization in the comparison was merged into another profile, which it now follows.",
    fr: "{n} organisation de la comparaison a été fusionnée avec un autre profil, qu'elle suit maintenant.",
  },
  "orgclaim.msg_repointed_many": {
    en: "{n} organizations in the comparison were merged into other profiles, which they now follow.",
    fr: "{n} organisations de la comparaison ont été fusionnées avec d'autres profils, qu'elles suivent maintenant.",
  },
  "orgclaim.msg_dropped_one": {
    en: "{n} organization is no longer in the data and was taken out of the comparison.",
    fr: "{n} organisation n'est plus dans les données et a été retirée de la comparaison.",
  },
  "orgclaim.msg_dropped_many": {
    en: "{n} organizations are no longer in the data and were taken out of the comparison.",
    fr: "{n} organisations ne sont plus dans les données et ont été retirées de la comparaison.",
  },
  "orgclaim.err_org": {
    en: "No organization profile has that address. Use a result's button, or paste the address of its profile.",
    fr: "Aucun profil d'organisation n'a cette adresse. Utilisez le bouton d'un résultat, ou collez l'adresse de son profil.",
  },

  // The account's other pages, the privacy page, the console and the Pro page.
  "orgclaim.delete": {
    en: "The organization you told the site is yours, and the organizations you compare it with.",
    fr: "L'organisation que vous avez indiquée comme la vôtre, et celles avec lesquelles vous la comparez.",
  },
  "orgclaim.privacy": {
    en: "If you tell the site which organization is yours, the account keeps that organization's id, up to five others you compare it with and the share block's segment. No public page, feed or file shows them; they go with the account.",
    fr: "Si vous indiquez au site quelle organisation est la vôtre, le compte conserve l'identifiant de cette organisation, jusqu'à cinq autres avec lesquelles vous la comparez et le segment du bloc des parts. Aucune page, aucun fil ni aucun fichier public ne les montre; ils disparaissent avec le compte.",
  },
  "orgclaim.admin_panel": { en: "Organizations Chosen", fr: "Organisations choisies" },
  "orgclaim.admin_all": { en: "Accounts with a choice", fr: "Comptes ayant fait un choix" },
  "orgclaim.admin_week": { en: "Chosen in the last {n} days", fr: "Choisies au cours des {n} derniers jours" },
  "orgclaim.admin_top": { en: "Most chosen ({n} at most)", fr: "Les plus choisies ({n} au plus)" },
  "orgclaim.admin_competitors": { en: "Compared with", fr: "Comparée avec" },
  "orgclaim.admin_largest": { en: "largest (default)", fr: "le plus important (par défaut)" },
  "orgclaim.admin_none": { en: "No organization chosen.", fr: "Aucune organisation choisie." },
  "orgclaim.pro_include": {
    en: "your own organization's page: its records by segment, its share of a segment beside organizations you choose, its contracts ending and the buyers it has won from",
    fr: "la page de votre organisation : ses dossiers par segment, sa part d'un segment à côté d'organisations de votre choix, ses contrats prenant fin et les acheteurs auprès desquels elle a obtenu des contrats",
  },
  "orgclaim.pro_page": {
    en: "Your organization: tell the site privately which organization is yours and see its records by segment, its share of a segment beside up to {n} organizations you choose, its contracts ending within 12 months and the buyers it has won from, each with a CSV file; the Free plan shows its records for the latest {free} fiscal years.",
    fr: "Votre organisation : indiquez au site, en privé, quelle organisation est la vôtre et voyez ses dossiers par segment, sa part d'un segment à côté de jusqu'à {n} organisations de votre choix, ses contrats prenant fin d'ici 12 mois et les acheteurs auprès desquels elle a obtenu des contrats, chacun avec un fichier CSV; le forfait Gratuit montre ses dossiers des {free} derniers exercices.",
  },

  // The weekly block of the watch mail (org_claim.ts weekOpening).
  "orgclaim.week_subject": { en: "Your organization this week: {name}", fr: "Votre organisation cette semaine : {name}" },
  "orgclaim.week_heading": { en: "Your organization: {name}", fr: "Votre organisation : {name}" },
  "orgclaim.week_nothing": { en: "Your organization: nothing new this week.", fr: "Votre organisation : rien de nouveau cette semaine." },
  "orgclaim.week_records": { en: "New records naming you this week: {n} ({parts})", fr: "Nouveaux dossiers vous nommant cette semaine : {n} ({parts})" },
  "orgclaim.week_awards_one": { en: "{n} award notice", fr: "{n} avis d'attribution" },
  "orgclaim.week_awards_many": { en: "{n} award notices", fr: "{n} avis d'attribution" },
  "orgclaim.week_history_one": { en: "{n} PSPC contract history record", fr: "{n} dossier de l'historique des contrats de SPAC" },
  "orgclaim.week_history_many": { en: "{n} PSPC contract history records", fr: "{n} dossiers de l'historique des contrats de SPAC" },
  "orgclaim.week_contracts_one": { en: "{n} published contract", fr: "{n} contrat publié" },
  "orgclaim.week_contracts_many": { en: "{n} published contracts", fr: "{n} contrats publiés" },
  "orgclaim.week_grants_one": { en: "{n} grant", fr: "{n} subvention" },
  "orgclaim.week_grants_many": { en: "{n} grants", fr: "{n} subventions" },
  "orgclaim.week_ending": {
    en: "Your contracts ending within 12 months: {n}, soonest {date} ({total} in all)",
    fr: "Vos contrats prenant fin d'ici 12 mois : {n}, le plus proche le {date} ({total} en tout)",
  },
  "orgclaim.week_ending_no_total": {
    en: "Your contracts ending within 12 months: {n}, soonest {date}",
    fr: "Vos contrats prenant fin d'ici 12 mois : {n}, le plus proche le {date}",
  },
  "orgclaim.week_buyers": {
    en: "Buyers you have won from with new notices this week: {names}",
    fr: "Acheteurs dont vous avez déjà obtenu des contrats et qui ont publié de nouveaux avis cette semaine : {names}",
  },
  "orgclaim.week_buyers_more": { en: "{names} and {n} more", fr: "{names} et {n} de plus" },

  // -- weekly briefings (briefings.ts, briefing_pages.tsx, digests.ts briefingDigest) -----------
  // The message.
  "briefing.subject": { en: "{name} this week: {what}", fr: "{name} cette semaine : {what}" },
  "briefing.subj_notices_one": { en: "1 new notice", fr: "1 nouvel avis" },
  "briefing.subj_notices_many": { en: "{n} new notices", fr: "{n} nouveaux avis" },
  "briefing.subj_awards_one": { en: "1 award", fr: "1 attribution" },
  "briefing.subj_awards_many": { en: "{n} awards", fr: "{n} attributions" },
  "briefing.subj_amended_one": { en: "1 notable amendment", fr: "1 modification notable" },
  "briefing.subj_amended_many": { en: "{n} notable amendments", fr: "{n} modifications notables" },
  "briefing.subj_ending_one": { en: "1 contract ending next quarter", fr: "1 contrat prenant fin le trimestre prochain" },
  "briefing.subj_ending_many": { en: "{n} contracts ending next quarter", fr: "{n} contrats prenant fin le trimestre prochain" },
  "briefing.pre_awards": { en: "Awards this week: {n}.", fr: "Attributions cette semaine : {n}." },
  "briefing.pre_quarter_one": {
    en: "Next quarter, {quarter}: 1 contract ending, {total}; new to the list: {fresh}.",
    fr: "Trimestre prochain, {quarter} : 1 contrat prenant fin, {total}; nouveaux dans la liste : {fresh}.",
  },
  "briefing.pre_quarter_many": {
    en: "Next quarter, {quarter}: {n} contracts ending, {total}; new to the list: {fresh}.",
    fr: "Trimestre prochain, {quarter} : {n} contrats prenant fin, {total}; nouveaux dans la liste : {fresh}.",
  },
  "briefing.pre_quarter_none": { en: "Next quarter, {quarter}: no contract ending.", fr: "Trimestre prochain, {quarter} : aucun contrat ne prend fin." },
  "briefing.no_total": { en: "no counted value", fr: "aucune valeur comptée" },
  "briefing.title": { en: "{name}, week to {date}", fr: "{name}, semaine se terminant le {date}" },
  "briefing.span": { en: "Data dates {first} to {last}.", fr: "Dates des données : du {first} au {last}." },
  "briefing.quarter": { en: "Q{q} {fy}", fr: "T{q} {fy}" },
  "briefing.months_1": { en: "April to June {year}", fr: "avril à juin {year}" },
  "briefing.months_2": { en: "July to September {year}", fr: "juillet à septembre {year}" },
  "briefing.months_3": { en: "October to December {year}", fr: "octobre à décembre {year}" },
  "briefing.months_4": { en: "January to March {year}", fr: "janvier à mars {year}" },
  "briefing.notices_head": { en: "New notices this week: {n}", fr: "Nouveaux avis cette semaine : {n}" },
  "briefing.notices_none": { en: "New notices this week: none", fr: "Nouveaux avis cette semaine : aucun" },
  "briefing.notices_link": { en: "The open notices", fr: "Les avis ouverts" },
  "briefing.more_one": { en: "And 1 more this week", fr: "Et 1 autre cette semaine" },
  "briefing.more_many": { en: "And {n} more this week", fr: "Et {n} autres cette semaine" },
  "briefing.awards_head": { en: "Awards this week: {n}", fr: "Attributions cette semaine : {n}" },
  "briefing.awards_none": { en: "Awards this week: none", fr: "Attributions cette semaine : aucune" },
  "briefing.source_line": { en: "{source}: {figures}", fr: "{source} : {figures}" },
  "briefing.nv": { en: "{n} without a value", fr: "{n} sans valeur" },
  "briefing.uncounted": {
    en: "On days past the 100 awards kept for one buyer: {n} more, not listed and not in these totals",
    fr: "Les jours au-delà des 100 attributions conservées pour un acheteur : {n} de plus, ni listées ni comprises dans ces totaux",
  },
  "briefing.no_value": { en: "No counted value", fr: "Aucune valeur comptée" },
  "briefing.withheld": { en: "Supplier not named", fr: "Fournisseur non nommé" },
  "briefing.ending_head": {
    en: "Contracts ending next quarter, {quarter} ({months}): {figures}",
    fr: "Contrats prenant fin le trimestre prochain, {quarter} ({months}) : {figures}",
  },
  "briefing.ending_none": {
    en: "No contract ends next quarter, {quarter} ({months}).",
    fr: "Aucun contrat ne prend fin le trimestre prochain, {quarter} ({months}).",
  },
  "briefing.ending_fresh": { en: "New to the list this week: {n}.", fr: "Nouveaux dans la liste cette semaine : {n}." },
  "briefing.ends": { en: "ends {date}", fr: "prend fin le {date}" },
  "briefing.fresh": { en: "new this week", fr: "nouveau cette semaine" },
  "briefing.radar_link": { en: "In the 6-month list of contracts ending", fr: "Dans la liste de 6 mois des contrats prenant fin" },
  "briefing.turn": {
    en: "The fiscal quarter turns on {date}; next week's briefing lists {quarter} ({months}).",
    fr: "Le trimestre financier change le {date}; le bulletin de la semaine prochaine présente le {quarter} ({months}).",
  },
  "briefing.amended_head": { en: "Notable amendments this week: {n}", fr: "Modifications notables cette semaine : {n}" },
  "briefing.amended_none": { en: "Notable amendments this week: none", fr: "Modifications notables cette semaine : aucune" },
  "briefing.largest_head": {
    en: "Largest records this fiscal year ({fy} to date): {n}",
    fr: "Dossiers les plus importants de l'exercice ({fy} à ce jour) : {n}",
  },
  "briefing.largest_none": {
    en: "Largest records this fiscal year ({fy} to date): none",
    fr: "Dossiers les plus importants de l'exercice ({fy} à ce jour) : aucun",
  },
  "briefing.analytics_segment": { en: "Analytics for this segment", fr: "Analyse de ce segment" },
  "briefing.analytics_buyer": { en: "Analytics for this buyer", fr: "Analyse de cet acheteur" },
  "briefing.records_link": { en: "The buyer's records", fr: "Les dossiers de l'acheteur" },
  "briefing.segment_link": { en: "The segment's page", fr: "La page du segment" },
  "briefing.note": {
    en: "A contract's value is its newest amendment's. Nothing is added across sources. \"Ends\" is the date the record states.",
    fr: "La valeur d'un contrat est celle de sa plus récente modification. Rien n'est additionné entre les sources. « Prend fin » est la date que le dossier indique.",
  },
  "briefing.note_segment": {
    en: "Segment coding is the buyer's; a record can carry several segments, and the week's lines list it under the lowest of them.",
    fr: "Le codage par segment est celui de l'acheteur; un dossier peut porter plusieurs segments, et les lignes de la semaine le placent sous le plus bas.",
  },
  "briefing.note_narrowed": {
    en: "Published contracts and grants carry no segment, so a briefing narrowed to one leaves them out.",
    fr: "Les contrats publiés et les subventions ne portent aucun segment; un bulletin limité à un segment les laisse de côté.",
  },
  "briefing.why": {
    en: "You receive this each week for a briefing in your account.",
    fr: "Vous recevez ce message chaque semaine pour un bulletin de votre compte.",
  },
  "briefing.searches_link": { en: "Briefings and delivery", fr: "Bulletins et envoi" },
  "briefing.stop_link": { en: "Stop this briefing", fr: "Arrêter ce bulletin" },

  // The control on a segment page and a buyer page.
  "briefing.panel": { en: "Weekly Briefing", fr: "Bulletin hebdomadaire" },
  "briefing.lead_segment": {
    en: "One email each Monday about this segment: the week's new notices, the awards with their winners and values, the contracts ending next fiscal quarter with their holders, the notable amendments, the fiscal year's largest records and the standing offers and supply arrangements ending within 6 months.",
    fr: "Un courriel chaque lundi sur ce segment : les nouveaux avis de la semaine, les attributions avec leurs gagnants et leurs valeurs, les contrats prenant fin au prochain trimestre financier avec leurs titulaires, les modifications notables, les dossiers les plus importants de l'exercice et les offres à commandes et arrangements en matière d'approvisionnement prenant fin d'ici 6 mois.",
  },
  "briefing.lead_buyer": {
    en: "One email each Monday about this buyer, or one of its segments: the week's new notices, the awards with their winners and values, the contracts ending next fiscal quarter with their holders, the notable amendments, the fiscal year's largest records and the standing offers and supply arrangements ending within 6 months.",
    fr: "Un courriel chaque lundi sur cet acheteur, ou l'un de ses segments : les nouveaux avis de la semaine, les attributions avec leurs gagnants et leurs valeurs, les contrats prenant fin au prochain trimestre financier avec leurs titulaires, les modifications notables, les dossiers les plus importants de l'exercice et les offres à commandes et arrangements en matière d'approvisionnement prenant fin d'ici 6 mois.",
  },
  "briefing.subscribe": { en: "Save this briefing", fr: "Enregistrer ce bulletin" },
  "briefing.subscribed": { en: "Briefing saved", fr: "Bulletin enregistré" },
  "briefing.control_out": {
    en: "Saved to your account on sign-in; signing in makes an account if there is none.",
    fr: "Enregistré dans votre compte à la connexion; la connexion crée un compte s'il n'y en a pas.",
  },
  "briefing.control_pro": { en: "Sent each Monday by email.", fr: "Envoyé chaque lundi par courriel." },
  "briefing.control_free": {
    en: "A Free account keeps the briefing on its searches page; the weekly email is part of Pro.",
    fr: "Un compte gratuit conserve le bulletin sur sa page de recherches; le courriel hebdomadaire fait partie de Pro.",
  },
  "briefing.control_cap": {
    en: "Your account holds {n} saved searches and briefings, its cap of {cap}.",
    fr: "Votre compte détient {n} recherches enregistrées et bulletins, son maximum de {cap}.",
  },
  "briefing.segment_label": { en: "Briefing segment", fr: "Segment du bulletin" },
  "briefing.segment_all": { en: "The whole buyer", fr: "L'acheteur entier" },
  "briefing.sample_link": { en: "This week's sample", fr: "L'exemple de cette semaine" },
  "briefing.manage": { en: "Manage your briefings", fr: "Gérer vos bulletins" },

  // The searches page.
  "briefing.list_title": { en: "Weekly Briefings", fr: "Bulletins hebdomadaires" },
  "briefing.list_lead": {
    en: "A briefing counts toward the account's cap of saved searches. Each one is sent on Mondays, in the language of the page it was added from.",
    fr: "Un bulletin compte dans le maximum de recherches enregistrées du compte. Chacun est envoyé le lundi, dans la langue de la page où il a été ajouté.",
  },
  "briefing.col": { en: "Briefing", fr: "Bulletin" },
  "briefing.none": {
    en: "No briefing yet. Each segment page and buyer page offers one.",
    fr: "Aucun bulletin pour l'instant. Chaque page de segment et d'acheteur en offre un.",
  },
  "briefing.last_none": { en: "Not sent yet.", fr: "Pas encore envoyé." },
  "briefing.last_sent_one": { en: "Last sent {time}, 1 row.", fr: "Dernier envoi le {time}, 1 ligne." },
  "briefing.last_sent_many": { en: "Last sent {time}, {n} rows.", fr: "Dernier envoi le {time}, {n} lignes." },
  "briefing.last_empty": { en: "Checked {time}, nothing in the week.", fr: "Vérifié le {time}, rien dans la semaine." },
  "briefing.last_failed": {
    en: "Could not be sent {time}; next week's message covers both weeks.",
    fr: "N'a pas pu être envoyé le {time}; le message de la semaine prochaine couvre les deux semaines.",
  },
  "briefing.msg_added": { en: "Briefing added.", fr: "Bulletin ajouté." },
  "briefing.msg_exists": { en: "That briefing is on your account already.", fr: "Ce bulletin est déjà dans votre compte." },
  "briefing.msg_removed": { en: "Briefing removed.", fr: "Bulletin retiré." },
  "briefing.msg_changed": { en: "Briefing delivery saved.", fr: "Envoi du bulletin enregistré." },
  "briefing.msg_pro": { en: "The weekly email of a briefing is part of Pro.", fr: "Le courriel hebdomadaire d'un bulletin fait partie de Pro." },
  "briefing.msg_gone": {
    en: "That page is no longer in the data, so no briefing was added.",
    fr: "Cette page ne figure plus dans les données; aucun bulletin n'a été ajouté.",
  },
  "briefing.msg_cap": {
    en: "Your account is at its cap of saved searches and briefings, so no briefing was added.",
    fr: "Votre compte a atteint son maximum de recherches enregistrées et de bulletins; aucun bulletin n'a été ajouté.",
  },

  // The stop link of a message (/account/stop?b=...&t=...).
  "briefing.stop_title": { en: "Stop a Briefing", fr: "Arrêter un bulletin" },
  "briefing.stop_lead": {
    en: "This turns the briefing's email off. The briefing stays on your searches page.",
    fr: "Ceci désactive le courriel du bulletin. Le bulletin reste sur votre page de recherches.",
  },
  "briefing.stop_button": { en: "Turn this briefing off", fr: "Désactiver ce bulletin" },
  "briefing.stop_already": { en: "This briefing's email is already off.", fr: "Le courriel de ce bulletin est déjà désactivé." },
  "briefing.stopped_title": { en: "Briefing Off", fr: "Bulletin désactivé" },
  "briefing.stopped_lead": {
    en: "The briefing's email is off. Turn it back on from your searches page.",
    fr: "Le courriel du bulletin est désactivé. Réactivez-le à partir de votre page de recherches.",
  },
  "briefing.stopped_one_click": { en: "The briefing is off.", fr: "Le bulletin est désactivé." },

  // The public sample (/pro/briefing-sample).
  "briefing.sample_title": { en: "A Sample of the Weekly Briefing", fr: "Un exemple du bulletin hebdomadaire" },
  "briefing.sample_lead": {
    en: "A sample of the weekly briefing, built from this week's data for segment {name}. Every figure in it is on the free pages; with Pro, a briefing like it comes each Monday for a segment or a buyer you choose.",
    fr: "Un exemple du bulletin hebdomadaire, construit à partir des données de cette semaine pour le segment {name}. Chaque chiffre qu'il contient figure sur les pages gratuites; avec Pro, un bulletin semblable arrive chaque lundi pour un segment ou un acheteur de votre choix.",
  },
  "briefing.sample_description": {
    en: "This week's briefing for one segment, built live from the data: new notices, awards, the contracts ending next fiscal quarter, notable amendments, the year's largest records and the standing offers ending within 6 months.",
    fr: "Le bulletin de cette semaine pour un segment, construit en direct à partir des données : nouveaux avis, attributions, contrats prenant fin au prochain trimestre financier, modifications notables, dossiers les plus importants de l'exercice et offres à commandes prenant fin d'ici 6 mois.",
  },
  "briefing.sample_subject": { en: "Subject", fr: "Objet" },
  "briefing.sample_preheader": { en: "Preview line", fr: "Ligne d'aperçu" },
  "briefing.sample_message": { en: "The Message", fr: "Le message" },
  "briefing.sample_unavailable": {
    en: "The sample is not available right now: the records database cannot answer. Try again in a few minutes.",
    fr: "L'exemple n'est pas disponible pour le moment : la base des dossiers ne répond pas. Réessayez dans quelques minutes.",
  },

  // The Pro page, the tease panels, the email lists page, the privacy page, deletion and the console.
  "briefing.pro_include": {
    en: "a weekly briefing by email for a segment or a buyer",
    fr: "un bulletin hebdomadaire par courriel pour un segment ou un acheteur",
  },
  "briefing.pro_page": {
    en: "A weekly briefing by email for a segment or a buyer: the week's new notices, the awards with their winners, the contracts ending next fiscal quarter with their holders, the notable amendments, the fiscal year's largest records and the standing offers and supply arrangements ending within 6 months.",
    fr: "Un bulletin hebdomadaire par courriel pour un segment ou un acheteur : les nouveaux avis de la semaine, les attributions avec leurs gagnants, les contrats prenant fin au prochain trimestre financier avec leurs titulaires, les modifications notables, les dossiers les plus importants de l'exercice et les offres à commandes et arrangements en matière d'approvisionnement prenant fin d'ici 6 mois.",
  },
  "briefing.pro_sample": { en: "Read {link}, built from this week's data for one segment.", fr: "Lisez {link}, construit avec les données de cette semaine pour un segment." },
  "briefing.sample_link_text": { en: "a sample of the weekly briefing", fr: "un exemple du bulletin hebdomadaire" },
  "briefing.alerts_line": {
    en: "A weekly briefing of one segment or one buyer, with its notices, awards, contracts ending next quarter and amendments in one message: {link}.",
    fr: "Un bulletin hebdomadaire d'un segment ou d'un acheteur, avec ses avis, attributions, contrats prenant fin le trimestre prochain et modifications en un message : {link}.",
  },
  "briefing.alerts_link": { en: "this week's sample", fr: "l'exemple de cette semaine" },
  "briefing.privacy": {
    en: "A weekly briefing keeps the segment or buyer it follows, its language, its delivery setting and, for 90 days, when each message went; the message names public records and totals only.",
    fr: "Un bulletin hebdomadaire conserve le segment ou l'acheteur qu'il suit, sa langue, son réglage d'envoi et, pendant 90 jours, la date de chaque message; le message ne nomme que des dossiers et des totaux publics.",
  },
  "briefing.delete": { en: "Your weekly briefings and their runs.", fr: "Vos bulletins hebdomadaires et leurs envois." },
  "briefing.admin_panel": { en: "Weekly Briefings", fr: "Bulletins hebdomadaires" },
  "briefing.admin_kind": { en: "{kind}, delivery {deliver}", fr: "{kind}, envoi {deliver}" },
  "briefing.admin_runs": { en: "Runs, last {n} days", fr: "Envois, {n} derniers jours" },
  "briefing.admin_runs_value": {
    en: "{sent} sent, {empty} with nothing in the week, {failed} failed",
    fr: "{sent} envoyés, {empty} sans rien dans la semaine, {failed} en échec",
  },
  "briefing.admin_none": { en: "No briefing.", fr: "Aucun bulletin." },
  "briefing.admin_runs_title": { en: "Briefing Runs", fr: "Envois des bulletins" },
  "briefing.kind_segment": { en: "Segment", fr: "Segment UNSPSC" },
  "briefing.kind_buyer": { en: "Buyer", fr: "Acheteur" },
  // The message's sixth section (digests.ts briefingParts): the standing
  // offers and supply arrangements ending within 6 months. Its rows reuse the
  // watch mail's "expires {date}" and "{n} holders".
  "briefing.instruments_head": {
    en: "Standing offers and supply arrangements ending within 6 months: {n}",
    fr: "Offres à commandes et arrangements en matière d'approvisionnement prenant fin d'ici 6 mois : {n}",
  },
  "briefing.instruments_none": {
    en: "Standing offers and supply arrangements ending within 6 months: none",
    fr: "Offres à commandes et arrangements en matière d'approvisionnement prenant fin d'ici 6 mois : aucun",
  },
  "briefing.instruments_all_one": { en: "See the list", fr: "Voir la liste" },
  "briefing.instruments_all_many": { en: "See all {n}", fr: "Voir les {n}" },

  // The standing offers and supply arrangements an organization watch
  // follows (watch_events.ts INSTRUMENT_KINDS, digests.ts watchEventLines;
  // docs/sosa.md, The events): the kinds, a row's expiry and holders, and
  // what they add to the watches' calendar feed (feeds.ts watchEnds).
  "watches.ev_instrument_gained": {
    en: "Gained a standing offer or supply arrangement",
    fr: "A obtenu une offre à commandes ou un arrangement en matière d'approvisionnement",
  },
  "watches.ev_instrument_lost": {
    en: "No longer holds a standing offer or supply arrangement",
    fr: "Ne détient plus d'offre à commandes ou d'arrangement en matière d'approvisionnement",
  },
  "watches.ev_instrument_expires_6m": { en: "Instrument expires within 6 months", fr: "Instrument expirant d'ici 6 mois" },
  "watches.line_expires": { en: "expires {date}", fr: "expire le {date}" },
  "watches.line_holders_one": { en: "{n} holder", fr: "{n} titulaire" },
  "watches.line_holders_many": { en: "{n} holders", fr: "{n} titulaires" },
  "calfeed.watch_instruments": {
    en: "An organization watch that follows Instrument expires within 6 months also adds the expiry of each standing offer or supply arrangement the organization holds that expires within 6 months.",
    fr: "Un suivi d'organisation qui suit Instrument expirant d'ici 6 mois ajoute aussi l'expiration de chaque offre à commandes ou arrangement en matière d'approvisionnement que détient l'organisation et qui expire d'ici 6 mois.",
  },

  // The claimed organization's watch, outside the plan's cap (watches.ts, watch_pages.tsx).
  "watches.n_own": { en: "{n} of {cap}, plus your organization", fr: "{n} sur {cap}, plus votre organisation" },
  "watches.own_note": { en: "Your organization, outside the limit", fr: "Votre organisation, hors de la limite" },
  "orgclaim.msg_claimed_cap": {
    en: "Saved. Only your account sees which organization you chose. The account already follows more pages than its plan allows, so the organization's watch was not added; remove a watch, then use Follow on its profile.",
    fr: "Enregistré. Seul votre compte voit l'organisation choisie. Le compte suit déjà plus de pages que son forfait ne le permet, donc le suivi de l'organisation n'a pas été ajouté; retirez un suivi, puis utilisez Suivre sur son profil.",
  },

  // The standing offers and supply arrangements block of "Your organization" (org_pages.tsx).
  "orgclaim.panel_instruments": { en: "Standing Offers and Supply Arrangements", fr: "Offres à commandes et arrangements en matière d'approvisionnement" },
  "orgclaim.foot_instruments": {
    en: "The instruments PSPC's latest weekly file lists the organization as holding, the soonest expiry first: the first {shown} here, all of them in the CSV file and in {section}.",
    fr: "Les instruments dont le dernier fichier hebdomadaire de SPAC indique l'organisation comme titulaire, l'expiration la plus proche d'abord : les {shown} premiers ici, tous dans le fichier CSV et dans {section}.",
  },
  "orgclaim.instruments_section": { en: "its profile's section", fr: "la section de son profil" },
  "orgclaim.instruments_all": { en: "All {n} on its profile", fr: "Les {n} sur son profil" },
  "orgclaim.none_instruments": {
    en: "This organization holds no active standing offer or supply arrangement.",
    fr: "Cette organisation ne détient aucune offre à commandes ni aucun arrangement en matière d'approvisionnement actif.",
  },
  "orgclaim.tease_instruments": {
    en: "The standing offers and supply arrangements it holds now, soonest expiry first, with the type, regions and end user of each and the CSV file.",
    fr: "Les offres à commandes et arrangements en matière d'approvisionnement qu'elle détient maintenant, l'expiration la plus proche d'abord, avec le type, les régions et l'utilisateur final de chacun et le fichier CSV.",
  },

  // A new notice's closing date in the watch mail, which follows it with the
  // time left (digests.ts watchEventLines with the send clock).
  "watches.line_closing_date": { en: "Closing date {date}", fr: "Date de clôture : {date}" },

  // The Ultra message (/admin/announce?kind=ultra; src/account/announce.tsx): one message to each
  // address the landing page's Ultra card kept, sent by the operator once Ultra can be bought.
  "admin.announce_ultra_link": { en: "Ultra message", fr: "Message Ultra" },
  "admin.announce_ultra_title": { en: "Ultra Message", fr: "Message Ultra" },
  "admin.announce_ultra_lead": {
    en: "One plain message to each address the Ultra card on the home page kept that has not had it, in the language it was entered in: Ultra is open, with a link to the plans. Send it only once Ultra can be bought. At most {n} a run; run it again to go on.",
    fr: "Un message simple à chaque adresse conservée par la carte Ultra de la page d'accueil qui ne l'a pas encore reçu, dans la langue où elle a été saisie : Ultra est ouvert, avec un lien vers les forfaits. Envoyez-le seulement quand Ultra peut être acheté. Au plus {n} par passage; relancez-le pour continuer.",
  },
  "admin.announce_ultra_waiting": {
    en: "Addresses that have not had it: {n}. An address holding an account gets it too, since it asked on the card.",
    fr: "Adresses qui ne l'ont pas reçu : {n}. Une adresse qui a un compte le reçoit aussi, puisqu'elle l'a demandé sur la carte.",
  },
  "admin.announce_ultra_preview": { en: "The message: {lang}", fr: "Le message : {lang}" },
  "admin.announce_ultra_done": {
    en: "Messages sent: {sent}. Not sent: {failed}. Addresses that have not had it: {left}.",
    fr: "Messages envoyés : {sent}. Non envoyés : {failed}. Adresses qui ne l'ont pas reçu : {left}.",
  },
  // The message itself, in the language the address was entered in. No price: the link leads to the plans.
  "announce.ultra_subject": { en: "Ultra is open on Award Watch", fr: "Ultra est ouvert sur Award Watch" },
  "announce.ultra_lead": { en: "Ultra, the plan above Pro, is open on Award Watch.", fr: "Ultra, le forfait au-dessus de Pro, est ouvert sur Award Watch." },
  "announce.ultra_asked": { en: "This address asked to be told when it opened.", fr: "Cette adresse a demandé à être avertie de son ouverture." },
  "announce.ultra_plans": { en: "Plans and prices", fr: "Forfaits et prix" },
  "announce.ultra_only": { en: "This is the only message about Ultra.", fr: "C'est le seul message au sujet d'Ultra." },
  "announce.ultra_why": {
    en: "You receive this because the address was entered on the Ultra card of the site's home page.",
    fr: "Vous recevez ce message parce que l'adresse a été saisie sur la carte Ultra de la page d'accueil du site.",
  },

  // The live mail check (/admin/mail-check; src/account/mail_check.ts, docs/mail.md): one message of
  // each template to the operator's test inbox, MAIL_TEST_TO, and to no other address.
  "admin.mail_check_link": { en: "Mail check", fr: "Vérification du courriel" },
  "admin.mail_check_title": { en: "Mail Check", fr: "Vérification du courriel" },
  "admin.mail_check_lead": {
    en: "Sends one real message of each template the site sends, {n} in all, to the test address set in MAIL_TEST_TO and to no other address, through the sender a reader's message goes through. Each subject starts with [mail check]. The stop links in them lead nowhere.",
    fr: "Envoie un vrai message de chaque modèle que le site envoie, {n} en tout, à l'adresse d'essai définie dans MAIL_TEST_TO et à aucune autre adresse, par l'expéditeur qu'emprunte le message d'un lecteur. Chaque objet commence par [mail check]. Les liens d'arrêt qu'ils contiennent ne mènent nulle part.",
  },
  "admin.mail_check_address_set": { en: "The test address is set.", fr: "L'adresse d'essai est définie." },
  "admin.mail_check_address_unset": {
    en: "The test address is not set, so nothing can be sent. Set MAIL_TEST_TO as docs/mail.md describes.",
    fr: "L'adresse d'essai n'est pas définie, donc rien ne peut être envoyé. Définissez MAIL_TEST_TO comme l'explique docs/mail.md.",
  },
  "admin.mail_check_sender": { en: "Sender: {kind}.", fr: "Expéditeur : {kind}." },
  "admin.mail_check_answer": {
    en: "The answer lists each message's result as JSON: sent, refused with the mail service's reason, or stubbed.",
    fr: "La réponse donne le résultat de chaque message en JSON : envoyé (sent), refusé avec le motif du service de courriel (refused) ou simulé (stubbed).",
  },
  "admin.mail_check_language": { en: "Language of the messages", fr: "Langue des messages" },
  "admin.mail_check_button": { en: "Send the {n} messages", fr: "Envoyer les {n} messages" },
  "admin.mail_check_no_address": {
    en: "MAIL_TEST_TO is not set, so nothing was sent.",
    fr: "MAIL_TEST_TO n'est pas défini, donc rien n'a été envoyé.",
  },
  "admin.mail_check_t_sign_in": { en: "The sign-in code", fr: "Le code de connexion" },
  "admin.mail_check_t_tenders": { en: "A saved search's tender notices, daily", fr: "Les avis d'appel d'offres d'une recherche enregistrée, chaque jour" },
  "admin.mail_check_t_expiring": { en: "A saved search's contracts ending, weekly", fr: "Les contrats qui prennent fin d'une recherche enregistrée, chaque semaine" },
  "admin.mail_check_t_records": { en: "A segment's new records", fr: "Les nouveaux dossiers d'un segment" },
  "admin.mail_check_t_watch": { en: "The watch mail", fr: "Le courriel des suivis" },
  "admin.mail_check_t_briefing": { en: "The weekly briefing", fr: "Le bulletin hebdomadaire" },
  "admin.mail_check_t_accounts_open": { en: "The accounts-open message", fr: "Le message d'ouverture des comptes" },
  "admin.mail_check_t_ultra_open": { en: "The Ultra message", fr: "Le message Ultra" },
  "admin.mail_check_t_address": { en: "The address-change notice", fr: "L'avis de changement d'adresse" },
} as const satisfies Record<string, { en: string; fr: string }>;
