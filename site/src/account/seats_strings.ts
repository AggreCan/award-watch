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
} as const;
