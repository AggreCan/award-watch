// The seats' strings (docs/accounts.md, Seats; seats_pages.tsx, sender.ts
// inviteMessage), in English and French, spread into the site's dictionary
// (src/i18n.ts) as the accounts module's are. French follows the dictionary's
// rules: plain spaces and straight apostrophes here, the Canadian French forms
// added when read. None of these reach a page while the seats' switch is off
// (seats.ts seatsOn). A line names a plan's own figure, read from
// entitlements.ts PLAN_SEATS and the constants of seats.ts, never a comparison.

export const SEATS_STRINGS = {
  // -- the holder's Seats page (seats_pages.tsx seatsView) ---------------------------------
  "seats.title": { en: "Seats", fr: "Sièges" },
  "seats.lead": {
    en: "A seat is one person with an account and a sign-in of their own. The plan's figures are the subscription's, shared by everyone in its seats, and no one sees what another keeps.",
    fr: "Un siège est une personne qui a son propre compte et sa propre connexion. Les chiffres du forfait sont ceux de l'abonnement, partagés entre toutes les personnes de ses sièges, et personne ne voit ce qu'une autre conserve.",
  },
  // {n} seats in use, the subscriber's own included, of the plan's {cap}; the _one form is chosen by i18n.ts tn for {n}.
  "seats.count": { en: "{n} of {cap} seats", fr: "{n} sièges sur {cap}" },
  "seats.count_one": { en: "{n} of {cap} seats", fr: "{n} siège sur {cap}" },
  // A plan's own figure of seats ({n} one or more), in the line on the plans (seats.pro_text, seats.fewer).
  "seats.seat_one": { en: "{n} seat", fr: "{n} siège" },
  "seats.seat_many": { en: "{n} seats", fr: "{n} sièges" },
  "seats.panel_seats": { en: "People in the Seats", fr: "Personnes des sièges" },
  "seats.col_person": { en: "Person", fr: "Personne" },
  "seats.col_seat": { en: "Seat", fr: "Siège" },
  "seats.col_since": { en: "Since", fr: "Depuis" },
  "seats.col_action": { en: "Change", fr: "Modifier" },
  "seats.you": { en: "{email} (you)", fr: "{email} (vous)" },
  "seats.state_yours": { en: "Yours, the subscriber's", fr: "Le vôtre, celui de l'abonné" },
  "seats.state_taken": { en: "Taken", fr: "Occupé" },
  "seats.state_uncovered": { en: "Taken, without the plan for now", fr: "Occupé, sans le forfait pour le moment" },
  "seats.state_invited": { en: "Invited, link works until {date}", fr: "Invitation, lien valable jusqu'au {date}" },
  "seats.remove": { en: "Remove", fr: "Retirer" },
  "seats.cancel": { en: "Cancel the invitation", fr: "Annuler l'invitation" },
  "seats.pool_title": { en: "What the Subscription Holds", fr: "Ce que détient l'abonnement" },
  "seats.pool_lead": {
    en: "Each figure is the subscription's, shared by you and the people in your seats. You see how many each person holds, never what. Yours are served first, then each seat's in the order it joined.",
    fr: "Chaque chiffre est celui de l'abonnement, partagé entre vous et les personnes de vos sièges. Vous voyez combien chaque personne en détient, jamais quoi. Les vôtres passent en premier, puis ceux de chaque siège dans l'ordre d'arrivée.",
  },
  "seats.pool_col_figure": { en: "Figure", fr: "Chiffre" },
  "seats.pool_col_total": { en: "In use", fr: "En usage" },
  "seats.pool_total": { en: "{n} of {cap}", fr: "{n} sur {cap}" },
  "seats.pool_over": {
    en: "The seats hold more than the subscription's figures, so {n} of their items are saved and unavailable until there is room. Yours come first.",
    fr: "Les sièges détiennent plus que les chiffres de l'abonnement; {n} de leurs éléments sont donc conservés et indisponibles jusqu'à ce qu'il y ait de la place. Les vôtres passent en premier.",
  },
  "seats.rule_joins": {
    en: "Up to {n} people can join this subscription in any 30 days; {used} joined in the last 30.",
    fr: "Jusqu'à {n} personnes peuvent se joindre à cet abonnement sur toute période de 30 jours; {used} l'ont fait au cours des 30 derniers jours.",
  },
  "seats.invite_title": { en: "Invite a Person", fr: "Inviter une personne" },
  "seats.invite_lead": {
    en: "The address gets one message with a link that works for {days} days. The person signs in with that address to take the seat; signing in makes an account for it if it has none.",
    fr: "L'adresse reçoit un seul message avec un lien valable {days} jours. La personne se connecte avec cette adresse pour prendre le siège; la connexion crée un compte pour elle s'il n'y en a pas.",
  },
  "seats.email": { en: "Email address", fr: "Adresse courriel" },
  "seats.lang": { en: "Language of the message", fr: "Langue du message" },
  "seats.send": { en: "Send the invitation", fr: "Envoyer l'invitation" },
  "seats.msg_sent": { en: "The invitation went to {email}.", fr: "L'invitation a été envoyée à {email}." },
  "seats.msg_cancelled": {
    en: "The invitation was cancelled, and its link no longer works.",
    fr: "L'invitation a été annulée, et son lien ne fonctionne plus.",
  },
  "seats.msg_removed": {
    en: "{email} no longer holds a seat. What their account keeps stays theirs, and the subscription's figures have room again.",
    fr: "{email} n'occupe plus de siège. Ce que son compte conserve lui reste, et les chiffres de l'abonnement ont de nouveau de la place.",
  },
  "seats.err_full": {
    en: "All {cap} seats are taken or invited. Remove a person or cancel an invitation to invite someone else.",
    fr: "Les {cap} sièges sont occupés ou réservés par une invitation. Retirez une personne ou annulez une invitation pour inviter quelqu'un d'autre.",
  },
  "seats.err_self": {
    en: "That is this account's own address, which holds its seat already.",
    fr: "C'est l'adresse de ce compte, qui occupe déjà son siège.",
  },
  "seats.err_member": { en: "{email} holds a seat on this subscription already.", fr: "{email} occupe déjà un siège de cet abonnement." },
  "seats.err_open": { en: "{email} has an invitation waiting already.", fr: "{email} a déjà une invitation en attente." },
  "seats.err_day": {
    en: "This account has sent {n} invitations in the last 24 hours, the most it can. Try again tomorrow.",
    fr: "Ce compte a envoyé {n} invitations au cours des dernières 24 heures, le maximum. Réessayez demain.",
  },
  "seats.err_address": {
    en: "This address has had {n} invitations from this account in the last 30 days, the most for one address.",
    fr: "Cette adresse a reçu {n} invitations de ce compte au cours des 30 derniers jours, le maximum pour une adresse.",
  },
  "seats.err_joins": {
    en: "{n} people have joined this subscription or been invited to it in the last 30 days, the most it allows. Try again from {date}.",
    fr: "{n} personnes se sont jointes à cet abonnement ou y ont été invitées au cours des 30 derniers jours, le maximum permis. Réessayez à compter du {date}.",
  },
  "seats.err_today": {
    en: "No more invitations can be sent today. Try again after 00:00 UTC.",
    fr: "Aucune autre invitation ne peut être envoyée aujourd'hui. Réessayez après 0 h UTC.",
  },
  "seats.err_send": {
    en: "The invitation could not be sent, and nothing was kept. Try again in a few minutes.",
    fr: "L'invitation n'a pas pu être envoyée, et rien n'a été conservé. Réessayez dans quelques minutes.",
  },
  "seats.pro_text": {
    en: "Pro has {pro_seats}, the subscriber's. Ultra has {ultra_seats}: the subscriber's and {others} for people the subscriber invites, sharing the plan's figures.",
    fr: "Pro compte {pro_seats}, celui de l'abonné. Ultra compte {ultra_seats} : celui de l'abonné et {others} pour les personnes que l'abonné invite, qui partagent les chiffres du forfait.",
  },
  "seats.fewer": {
    en: "{plan} has {seats}, so the people below get no plan from this subscription now. What they keep is saved, and past their own plan's figures unavailable until a plan covers it again. Move to Ultra to give it back, or remove them.",
    fr: "{plan} compte {seats}; les personnes ci-dessous n'obtiennent donc aucun forfait de cet abonnement pour le moment. Ce qu'elles conservent est enregistré et, au-delà des chiffres de leur propre forfait, indisponible jusqu'à ce qu'un forfait le couvre de nouveau. Passez à Ultra pour le leur rendre, ou retirez-les.",
  },
  "seats.lapsed": {
    en: "This account has no paid plan now, so its seats give none. What each person keeps is saved, and past their own plan's figures unavailable until a plan covers it again. If this account takes Ultra again, the seats give it again. You can remove them, and each person can leave their own.",
    fr: "Ce compte n'a plus de forfait payant; ses sièges n'en donnent donc aucun. Ce que chaque personne conserve est enregistré et, au-delà des chiffres de son propre forfait, indisponible jusqu'à ce qu'un forfait le couvre de nouveau. Si ce compte reprend Ultra, les sièges le donnent de nouveau. Vous pouvez les retirer, et chaque personne peut quitter le sien.",
  },
  "seats.remove_title": { en: "Remove {email}?", fr: "Retirer {email}?" },
  "seats.remove_text": {
    en: "{email} returns to their own plan at once, Free unless they have another, and gets one message saying the seat ended. Everything their account keeps is saved; past their plan's figures it is unavailable until a plan covers it again, and nothing is deleted. The subscription's figures have room again at once.",
    fr: "{email} revient aussitôt à son propre forfait, Gratuit s'il n'en a pas d'autre, et reçoit un seul message indiquant que le siège a pris fin. Tout ce que garde son compte est enregistré; au-delà des chiffres de son forfait, il est indisponible jusqu'à ce qu'un forfait le couvre de nouveau, et rien n'est supprimé. Les chiffres de l'abonnement ont aussitôt de nouveau de la place.",
  },
  "seats.remove_confirm": { en: "Remove from the seat", fr: "Retirer du siège" },
  "seats.keep": { en: "Keep the seat", fr: "Garder le siège" },
  // The overview's row and the billing page's link to the Seats page; the row's words for an account whose
  // plan no longer holds the seats it gives.
  "account.field_seats": { en: "Seats", fr: "Sièges" },
  "seats.overview_fewer": { en: "Seats this plan does not hold", fr: "Sièges que ce forfait ne comprend pas" },

  // -- what a member sees (seats_pages.tsx memberView, billing.tsx) ------------------------
  "seat.title": { en: "Your Seat", fr: "Votre siège" },
  "seat.link": { en: "Your seat", fr: "Votre siège" },
  "seat.covered": {
    en: "You hold a seat on the subscription of {holder}, which gives your account Ultra.",
    fr: "Vous occupez un siège de l'abonnement de {holder}, qui donne Ultra à votre compte.",
  },
  "seat.saved": {
    en: "Everything your account keeps is saved. Past the {plan} plan's figures it is unavailable until a plan covers it again; nothing is deleted.",
    fr: "Tout ce que garde votre compte est enregistré. Au-delà des chiffres du forfait {plan}, il est indisponible jusqu'à ce qu'un forfait le couvre de nouveau; rien n'est supprimé.",
  },
  "seat.sees": {
    en: "{holder} sees your address, whether your seat gives the plan, and how many of each figure you hold, and nothing of what they are: no search, watch, view, dashboard, key or page.",
    fr: "{holder} voit votre adresse, si votre siège donne le forfait et combien vous détenez de chaque chiffre, et rien de leur contenu : aucune recherche, aucun suivi, vue, tableau de bord, clé ou page.",
  },
  "seat.pool_title": { en: "What the Subscription Holds", fr: "Ce que détient l'abonnement" },
  "seat.pool_lead": {
    en: "Ultra's figures are the subscription's, shared by {holder} and the people in its seats. The subscriber's items are served first, then each seat's in the order it joined.",
    fr: "Les chiffres d'Ultra sont ceux de l'abonnement, partagés entre {holder} et les personnes de ses sièges. Les éléments de l'abonné passent en premier, puis ceux de chaque siège dans l'ordre d'arrivée.",
  },
  "seat.pool_col_yours": { en: "Yours", fr: "Les vôtres" },
  "seat.billing": {
    en: "Billing is the subscriber's. To buy a plan of your own, leave the seat first.",
    fr: "La facturation relève de l'abonné. Pour acheter votre propre forfait, quittez d'abord le siège.",
  },
  "seat.leave": { en: "Leave this seat", fr: "Quitter ce siège" },
  "seat.leave_title": { en: "Leave the Seat?", fr: "Quitter le siège?" },
  "seat.leave_text": {
    en: "Your account returns to its own plan at once, Free unless it has another. Everything it keeps is saved; past that plan's figures it is unavailable until a plan covers it again, and nothing is deleted. {holder} sees the seat free.",
    fr: "Votre compte revient aussitôt à son propre forfait, Gratuit s'il n'en a pas d'autre. Tout ce qu'il garde est enregistré; au-delà des chiffres de ce forfait, il est indisponible jusqu'à ce qu'un forfait le couvre de nouveau, et rien n'est supprimé. {holder} voit le siège libre.",
  },
  "seat.msg_left": { en: "You left the seat. Your account is on {plan}.", fr: "Vous avez quitté le siège. Votre compte est au forfait {plan}." },

  // -- the invitation's page (seats_pages.tsx joinView) -------------------------------------
  "join.title": { en: "An Invitation to a Seat", fr: "Invitation à un siège" },
  "join.lead": { en: "{holder} invited {email} to a seat on their Ultra subscription.", fr: "{holder} a invité {email} à occuper un siège de son abonnement Ultra." },
  "join.what": {
    en: "A seat gives an account of your own the Ultra plan while the subscription holds the seat. Ultra's figures are the subscription's, shared with {holder} and the others in its seats: {lines}. {holder} sees your address and how many of each figure you hold, and nothing of what they are.",
    fr: "Un siège donne le forfait Ultra à un compte qui est le vôtre tant que l'abonnement comprend ce siège. Les chiffres d'Ultra sont ceux de l'abonnement, partagés avec {holder} et les autres personnes de ses sièges : {lines}. {holder} voit votre adresse et combien vous détenez de chaque chiffre, et rien de leur contenu.",
  },
  "join.sign_in": {
    en: "Sign in with {email} to answer. Signing in makes an account for the address if it has none.",
    fr: "Connectez-vous avec {email} pour répondre. La connexion crée un compte pour cette adresse s'il n'y en a pas.",
  },
  "join.what_title": { en: "What a Seat Gives", fr: "Ce que donne un siège" },
  "join.panel_answer": { en: "Your Answer", fr: "Votre réponse" },
  "join.room_title": { en: "What Fits", fr: "Ce qui entre" },
  "join.room_lead": {
    en: "Where what your account keeps would pass the room left in the subscription's figures, the items past it are saved and unavailable until there is room; nothing is deleted.",
    fr: "Là où ce que garde votre compte dépasserait la place qui reste dans les chiffres de l'abonnement, les éléments en trop sont enregistrés et indisponibles jusqu'à ce qu'il y ait de la place; rien n'est supprimé.",
  },
  "join.room_line": {
    en: "{things}: {fits} of your {own} in service, {left} saved and unavailable",
    fr: "{things} : {fits} sur {own} en service, {left} en attente de place",
  },
  "join.room_none": { en: "Everything your account keeps fits.", fr: "Tout ce que garde votre compte y entre." },
  "join.take": { en: "Take the seat", fr: "Prendre le siège" },
  "join.decline": { en: "Decline", fr: "Refuser" },
  "join.other": {
    en: "This invitation is for {email}, and this browser is signed in as {you}. Sign out, open the link again and sign in with {email}.",
    fr: "Cette invitation s'adresse à {email}, et ce navigateur est connecté au compte {you}. Déconnectez-vous, rouvrez le lien et connectez-vous avec {email}.",
  },
  "join.own_plan": {
    en: "This account has a paid plan of its own, so it cannot take a seat while that plan lasts. You can decline, or ask {holder} for a new invitation once your plan has ended.",
    fr: "Ce compte a son propre forfait payant; il ne peut donc pas prendre de siège tant que ce forfait dure. Vous pouvez refuser, ou demander une nouvelle invitation à {holder} une fois votre forfait terminé.",
  },
  "join.seated": {
    en: "This account holds a seat on another subscription. Leave it on the Seats page to take this one.",
    fr: "Ce compte occupe un siège d'un autre abonnement. Quittez-le à la page Sièges pour prendre celui-ci.",
  },
  "join.no_room": {
    en: "This subscription has no seat for you now. {holder} can invite you again later.",
    fr: "Cet abonnement n'a pas de siège pour vous pour le moment. {holder} pourra vous inviter de nouveau plus tard.",
  },
  "join.stale": { en: "This invitation link has expired, been used or been cancelled.", fr: "Ce lien d'invitation a expiré, a déjà servi ou a été annulé." },
  "join.msg_taken": { en: "You took the seat. Your account is on Ultra.", fr: "Vous avez pris le siège. Votre compte est au forfait Ultra." },
  "join.msg_declined": { en: "You declined the invitation.", fr: "Vous avez refusé l'invitation." },

  // -- the invitation message (sender.ts inviteMessage) ----------------------------------------
  // The subject names no address, so a crafted address cannot ride in a subject line.
  "invite.subject": { en: "An invitation to a seat on Award Watch Ultra", fr: "Une invitation à un siège d'Award Watch Ultra" },
  "invite.heading": { en: "An invitation to a seat", fr: "Une invitation à un siège" },
  "invite.preheader": {
    en: "{holder} invited this address. The link works until {date}.",
    fr: "{holder} a invité cette adresse. Le lien fonctionne jusqu'au {date}.",
  },
  "invite.lead": {
    en: "{holder} invited this address to a seat on their Award Watch Ultra subscription.",
    fr: "{holder} a invité cette adresse à occuper un siège de son abonnement Award Watch Ultra.",
  },
  "invite.what": {
    en: "Award Watch is a public site of Canadian federal tenders, contract awards, contracts and grants. A seat gives an account of your own, with its own sign-in, the Ultra plan while {holder}'s subscription holds the seat; the plan's figures, such as saved searches and dashboards, are shared within the subscription. {holder} sees your address, whether you took the seat and how many of each figure you hold, and nothing of what they are.",
    fr: "Award Watch est un site public des appels d'offres, des attributions de contrats, des contrats et des subventions du gouvernement fédéral du Canada. Un siège donne à un compte qui est le vôtre, avec sa propre connexion, le forfait Ultra tant que l'abonnement de {holder} comprend ce siège; les chiffres du forfait, comme les recherches enregistrées et les tableaux de bord, sont partagés au sein de l'abonnement. {holder} voit votre adresse, si vous avez pris le siège et combien vous détenez de chaque chiffre, et rien de leur contenu.",
  },
  "invite.button": { en: "See the invitation", fr: "Voir l'invitation" },
  // The text part's line before the link, the button's words.
  "invite.text_link": { en: "See the invitation:", fr: "Voir l'invitation :" },
  "invite.until": {
    en: "The link works once, until {date} at {time} UTC.",
    fr: "Le lien fonctionne une seule fois, jusqu'au {date} à {time} UTC.",
  },
  "invite.ignore": {
    en: "If you do not know {holder} or do not want a seat, ignore this message. Nothing happens, no account is made, and the invitation, with this address, is deleted 30 days after it was sent. This is the only message about it.",
    fr: "Si vous ne connaissez pas {holder} ou ne voulez pas de siège, ne tenez pas compte de ce message. Rien ne se produit, aucun compte n'est créé, et l'invitation, avec cette adresse, est supprimée 30 jours après son envoi. C'est le seul message à son sujet.",
  },
  "invite.why": {
    en: "You receive this because a subscriber typed this address on the Seats page of their account.",
    fr: "Vous recevez ce message parce qu'un abonné a saisi cette adresse à la page Sièges de son compte.",
  },

  // -- slice C2: what the seats say elsewhere, while the switch is on -----------------------------------
  // The holder's pool table, when a live seat its plan does not cover is left out of it (seats_pages.tsx).
  "seats.pool_uncovered": {
    en: "The people in seats without the plan for now are not counted here: what they keep is under their own plan's figures.",
    fr: "Les personnes des sièges sans le forfait pour le moment ne sont pas comptées ici : ce qu'elles conservent relève des chiffres de leur propre forfait.",
  },
  // The plan cards' row (src/pro.tsx SEATS_ROW), each plan's own figure from entitlements.ts PLAN_SEATS: a
  // plan of one seat in the singular, a plan of several with the words the operator ruled (2026-11-16).
  "plans.seat_one": { en: "{n} seat", fr: "{n} siège" },
  "plans.seats_shared": { en: "{n} seats sharing these figures", fr: "{n} sièges qui partagent ces chiffres" },
  // /pro's Ultra section and its question (src/pages/pro.tsx), while the switch is on: {seats} and
  // {ultra_seats} a plan's own figure ("5 seats"), {pro_seats} Pro's ("1 seat"), {others} the member
  // seats, {keys} account/api_keys.ts KEYS_MAX.
  "propage.ultra_text_seats": {
    en: "Ultra includes everything in Pro, with these figures: {seats}, yours and {others} for people you invite, each with their own sign-in; {searches} saved searches and briefings by email, {watches} watches, {keys} API keys of {day} requests a day each and {dashboards}, shared by the people in its seats; and {years} fiscal years of analytics for each of them.",
    fr: "Ultra comprend tout ce que comprend Pro, avec ces chiffres : {seats}, le vôtre et {others} pour les personnes que vous invitez, chacune avec sa propre connexion; {searches} recherches et bulletins par courriel, {watches} suivis, {keys} clés d'API de {day} requêtes par jour chacune et {dashboards}, partagés entre les personnes de ses sièges; et {years} exercices d'analyses pour chacune d'elles.",
  },
  "propage.q_seats": { en: "Can several people use one subscription?", fr: "Plusieurs personnes peuvent-elles utiliser un même abonnement?" },
  "propage.a_seats": {
    en: "Pro has {pro_seats}, yours. Ultra has {ultra_seats}: yours and {others} you give by invitation from your account's Seats page. Each person signs in with their own address and keeps their own searches, watches and dashboards. The figures for what is kept (saved searches and briefings, watches, saved views, dashboards, API keys and calendar feeds) are the subscription's, shared by all of you, yours served first. You see each person's count of each, and nothing of what they are.",
    fr: "Pro compte {pro_seats}, le vôtre. Ultra compte {ultra_seats} : le vôtre et {others} que vous attribuez par invitation depuis la page Sièges de votre compte. Chaque personne se connecte avec sa propre adresse et garde ses propres recherches, suivis et tableaux de bord. Les chiffres de ce qui est conservé (recherches enregistrées et bulletins, suivis, vues enregistrées, tableaux de bord, clés d'API et flux de calendrier) sont ceux de l'abonnement, partagés entre vous tous, les vôtres en premier. Vous voyez combien chaque personne en détient de chacun, et rien de leur contenu.",
  },
  // The Terms' Seats section (src/pages/docs.tsx PAID_TERMS, after What the Paid Plans Include) and the abuse
  // paragraph with the seat named, while Ultra is on sale and the switch is on. Every figure is read when the
  // page is drawn: {pro_seats} and {ultra_seats} the plans' own (PLAN_SEATS), {others} the member seats, {days}
  // seats.ts SEAT_INVITE_DAYS, {joins} joinsAllowed("ultra"), {window} SEAT_WINDOW_DAYS, {devices} session.ts
  // SESSIONS_MAX. These wait on the lawyer's read before the switch goes on.
  "terms.pro_seats_title": { en: "Seats", fr: "Sièges" },
  "terms.pro_seats": {
    en: "A seat is for one named person, with an Award Watch account and a sign-in of their own. Pro has {pro_seats}, the subscriber's. Ultra has {ultra_seats}: the subscriber's, and {others} the subscriber may give to other people by invitation from the account's Seats page; an invitation's link works for {days} days. The plan's figures for saved searches and briefings, watches, saved views, dashboards, API keys, calendar feeds, downloads a minute and bug reports a day are the subscription's, shared by the subscriber and the people in its seats; its other figures are each person's. When the accounts of a subscription together hold more than one of those figures, the subscriber's items are served first, then each seat's in the order the seat was taken, each account's oldest first; the items past the figure are kept, nothing is deleted, and they may be unavailable until there is room. No account sees what another keeps: the subscriber sees each seat's address, whether it gives the plan, and how many saved searches and briefings, watches, saved views, dashboards, API keys and calendar feeds it holds; a person in a seat sees the subscriber's address, the subscription's totals and their own counts. A person holds at most one seat, and an account with a paid plan of its own cannot take one. The subscriber may remove a person from a seat, and a person may leave one, at any time; at most {joins} people may join one subscription in any {window} days. Billing, the refund of the first payment and cancellation are the subscriber's alone. A seat gives the plan while the subscriber's plan holds it: when the subscription ends or moves to a plan with fewer seats, the accounts in the seats it no longer holds return to their own plan, and what they keep stays, under that plan's figures, until a plan covers it again. Deleting the subscriber's account ends every seat it gives; deleting a person's account ends their seat. An account stays signed in on at most {devices} browsers at a time. Letting more than one person use a seat is sharing an account, under Ending Service for Abuse below.",
    fr: "Un siège est destiné à une personne nommée, qui a son propre compte Award Watch et sa propre connexion. Pro compte {pro_seats}, celui de l'abonné. Ultra compte {ultra_seats} : celui de l'abonné et {others} que l'abonné peut attribuer à d'autres personnes par invitation, depuis la page Sièges du compte; le lien d'une invitation fonctionne pendant {days} jours. Les chiffres du forfait pour les recherches enregistrées et les bulletins, les suivis, les vues enregistrées, les tableaux de bord, les clés d'API, les flux de calendrier, les téléchargements par minute et les signalements de bogue par jour sont ceux de l'abonnement, partagés entre l'abonné et les personnes de ses sièges; ses autres chiffres sont ceux de chaque personne. Quand les comptes d'un abonnement détiennent ensemble plus que l'un de ces chiffres, les éléments de l'abonné passent en premier, puis ceux de chaque siège dans l'ordre où il a été pris, les plus anciens de chaque compte d'abord; les éléments au-delà du chiffre sont conservés, rien n'est supprimé, et ils peuvent être indisponibles jusqu'à ce qu'il y ait de la place. Aucun compte ne voit ce qu'un autre conserve : l'abonné voit l'adresse de chaque siège, si celui-ci donne le forfait, et combien de recherches enregistrées et de bulletins, de suivis, de vues enregistrées, de tableaux de bord, de clés d'API et de flux de calendrier il détient; la personne d'un siège voit l'adresse de l'abonné, les totaux de l'abonnement et ses propres nombres. Une personne occupe au plus un siège, et un compte qui a son propre forfait payant ne peut pas en prendre un. L'abonné peut retirer une personne d'un siège, et une personne peut quitter un siège, en tout temps; au plus {joins} personnes peuvent se joindre à un même abonnement sur toute période de {window} jours. La facturation, le remboursement du premier paiement et l'annulation relèvent de l'abonné seul. Un siège donne le forfait tant que le forfait de l'abonné le comprend : quand l'abonnement prend fin ou passe à un forfait comptant moins de sièges, les comptes des sièges qu'il ne comprend plus reviennent à leur propre forfait, et ce qu'ils conservent reste, sous les chiffres de ce forfait, jusqu'à ce qu'un forfait le couvre de nouveau. La suppression du compte de l'abonné met fin à chaque siège qu'il donne; la suppression du compte d'une personne met fin à son siège. Un compte reste connecté dans au plus {devices} navigateurs à la fois. Laisser plus d'une personne utiliser un siège revient à partager un compte, au sens de Fin du service en cas d'abus ci-dessous.",
  },
  "terms.pro_abuse_seats": {
    en: "Allwater may suspend or end an account and its subscription for abuse, including breaking these Terms, automated access beyond the published limits, sharing or reselling an account or a seat, getting around a limit or a payment, or use that harms the site or other people. When service ends for abuse, the current period is not refunded. If Allwater ends a paid plan for any other reason, it refunds the unused part of the current period.",
    fr: "Allwater peut suspendre ou fermer un compte et son abonnement en cas d'abus, notamment le non-respect des présentes conditions, un accès automatisé au-delà des limites publiées, le partage ou la revente d'un compte ou d'un siège, le contournement d'une limite ou d'un paiement, ou un usage qui nuit au site ou à autrui. Lorsque le service prend fin pour abus, la période en cours n'est pas remboursée. Si Allwater met fin à un forfait payant pour toute autre raison, elle rembourse la partie inutilisée de la période en cours.",
  },
  // The privacy page's seats paragraph (account/privacy.tsx), while the switch is on: {days} seats.ts
  // SEAT_KEEP_DAYS, the sweep's (signin.ts sweep, SEATS_SWEEP_SQL).
  "seats.privacy": {
    en: "Ultra's seats. An invitation keeps the address it was sent to, the account that sent it, its language, when it was sent, when its link stops working, and when it was taken, declined or cancelled; its link's secret is kept only as a hash. The invited address receives one message, which names the subscriber's address. The address is cleared when the invitation is taken; otherwise the invitation, with its address, is deleted {days} days after it was sent. A seat keeps which account holds it, on which subscriber's account, when it began and ended and why, and is deleted {days} days after it ends. Within a subscription, counts are shown and not stored: the subscriber sees how many saved searches and briefings, watches, saved views, dashboards, API keys and calendar feeds each seat holds, and a person in a seat sees the subscription's totals and their own; no one sees what another's are. The person in a seat sees the subscriber's address, and the subscriber each seat's. Deleting an account ends the seats it gives or holds, clears the address on its invitations and deletes the invitations sent to its address; an invitation already cancelled or declined keeps its address until it is deleted, {days} days after it was sent.",
    fr: "Les sièges d'Ultra. Une invitation conserve l'adresse à laquelle elle a été envoyée, le compte qui l'a envoyée, sa langue, le moment de son envoi, celui où son lien cesse de fonctionner, et celui où elle a été acceptée, refusée ou annulée; le secret de son lien n'est conservé que sous forme de hachage. L'adresse invitée reçoit un seul message, qui nomme l'adresse de l'abonné. L'adresse est effacée quand l'invitation est acceptée; sinon, l'invitation et son adresse sont supprimées {days} jours après son envoi. Un siège conserve quel compte l'occupe, sur le compte de quel abonné, quand il a commencé et pris fin et pourquoi, et il est supprimé {days} jours après sa fin. Au sein d'un abonnement, des nombres sont montrés, sans être conservés : l'abonné voit combien de recherches enregistrées et de bulletins, de suivis, de vues enregistrées, de tableaux de bord, de clés d'API et de flux de calendrier chaque siège détient, et la personne d'un siège voit les totaux de l'abonnement et les siens; personne ne voit le contenu de ceux des autres. La personne d'un siège voit l'adresse de l'abonné, et l'abonné celle de chaque siège. La suppression d'un compte met fin aux sièges qu'il donne ou occupe, efface l'adresse de ses invitations et supprime les invitations envoyées à son adresse; une invitation déjà annulée ou refusée garde son adresse jusqu'à sa suppression, {days} jours après son envoi.",
  },
  // A control that refuses because the subscription is full (seats_lines.tsx; the seats design's 3.4 and 5.9),
  // in place of the line that says "this account": a member reads whom to ask, the holder ({holder} read from the
  // member's own session, never a form) and the holder where each seat's counts are, {seats} the Seats page
  // (a link where the line is markup, pool.full_seats as words where it is a plain notice). {things} is one of
  // pool.f_*, {cap} the plan's figure.
  "pool.full": {
    en: "The subscription's {cap} {things} are all in use. Ask {holder}, who holds the subscription, or remove one of yours.",
    fr: "Cet abonnement a atteint son chiffre de {cap} {things}. Adressez-vous à {holder}, qui détient l'abonnement, ou retirez un élément parmi les vôtres.",
  },
  "pool.full_holder": {
    en: "The subscription's {cap} {things} are all in use. {seats} shows how many each seat holds; remove one of yours, or ask a person in a seat to remove one of theirs.",
    fr: "Cet abonnement a atteint son chiffre de {cap} {things}. {seats} indique combien chaque siège en détient; retirez un élément parmi les vôtres, ou demandez à une personne d'un siège de retirer un élément parmi les siens.",
  },
  "pool.full_seats": { en: "The Seats page", fr: "La page Sièges" },
  // The briefings' panel on the searches page for an account in a group, in place of briefing.list_lead.
  "briefing.list_lead_pool": {
    en: "A briefing counts toward the subscription's figure of saved searches and briefings, shared by the people in its seats. Each one is sent on Mondays, in the language of the page it was added from.",
    fr: "Un bulletin compte dans le chiffre de recherches enregistrées et de bulletins de l'abonnement, partagé entre les personnes de ses sièges. Chacun est envoyé le lundi, dans la langue de la page où il a été ajouté.",
  },
  // The delete page (pages.tsx deleteView), while the switch is on: what deleting the account does to the seat it
  // holds ({holder} from its own session) and to the seats it gives ({n}: its live seats and open invitations,
  // seats.ts SEATS_IN_USE_SQL, as the Seats page counts them).
  "account.delete_seat": {
    en: "Deleting the account ends your seat on the subscription of {holder}.",
    fr: "La suppression du compte met fin à votre siège de l'abonnement de {holder}.",
  },
  "account.delete_seats": {
    en: "Deleting the account ends the {n} seats it gives, invitations included; each person keeps their own account.",
    fr: "La suppression du compte met fin aux {n} sièges qu'il donne, invitations comprises; chaque personne garde son propre compte.",
  },
  "account.delete_seats_one": {
    en: "Deleting the account ends the seat it gives, or the invitation to it; the person keeps their own account.",
    fr: "La suppression du compte met fin au siège qu'il donne, ou à l'invitation à ce siège; la personne garde son propre compte.",
  },
  // The console's actions on a holder's seats (admin.tsx), each through its own page and box, while the switch is
  // on; the Seats panel stays read-only while it is off.
  "admin.seat_end": { en: "End this seat", fr: "Mettre fin à ce siège" },
  "admin.seat_end_title": { en: "End This Seat", fr: "Mettre fin au siège" },
  "admin.seat_end_lead": {
    en: "The person in the seat returns to their own plan at once. Nothing of theirs is deleted, and the subscription's figures have room again.",
    fr: "La personne du siège revient aussitôt à son propre forfait. Rien de ce qui lui appartient n'est supprimé, et les chiffres de l'abonnement ont de nouveau de la place.",
  },
  "admin.seat_end_button": { en: "End the seat", fr: "Mettre fin au siège" },
  "admin.invite_end": { en: "Cancel this invitation", fr: "Annuler cette invitation" },
  "admin.invite_end_title": { en: "Cancel This Invitation", fr: "Annuler l'invitation" },
  "admin.invite_end_lead": {
    en: "The invitation's link stops working at once. Its address stays on the row until the sweep, {days} days after it was sent, as when the subscriber cancels it.",
    fr: "Le lien de l'invitation cesse aussitôt de fonctionner. Son adresse reste sur la ligne jusqu'au nettoyage, {days} jours après son envoi, comme lorsque l'abonné l'annule.",
  },
  "admin.invite_end_button": { en: "Cancel the invitation", fr: "Annuler l'invitation" },
  "admin.seat_field_person": { en: "Person in the seat", fr: "Personne du siège" },
  "admin.seat_field_invited": { en: "Invited address", fr: "Adresse invitée" },
  "admin.seat_field_holder": { en: "Subscriber", fr: "Abonné" },
  "admin.msg_seat_ended": { en: "The seat was ended.", fr: "Le siège a pris fin." },
  "admin.msg_invite_cancelled": { en: "The invitation was cancelled.", fr: "L'invitation a été annulée." },
  "admin.msg_seat_nothing": {
    en: "Nothing changed: that seat or invitation is no longer open.",
    fr: "Rien n'a changé : ce siège ou cette invitation n'est plus ouvert.",
  },
} as const;
