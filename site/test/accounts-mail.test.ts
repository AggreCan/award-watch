// The sign-in message through Cloudflare Email Sending (the MAIL binding,
// src/account/sender.ts). A fake binding records what it was handed, or
// throws the way the real one does; the local runtime's stand-in for the
// binding is never given a message. The message's template mirrors
// design/email's sign-in prototype.
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { providerSender, senderFor, signInMessage } from "../src/account/sender";
import { CONTACT_EMAIL } from "../src/pages/docs";
import { ACCOUNTS, codeIn, lastMail, nbsp, newEmail, nextIp, onEnv, post, tokenIn, useAccountsDb } from "./accounts-helpers";
import { testEnv } from "./assets";

useAccountsDb();

const FROM = "alerts@awardwatch.ca";
const LOCAL = "http://localhost/account/sign-in";
const SITE = "https://awardwatch.ca/account/sign-in";

type Handed = {
  from: unknown; to: unknown; replyTo?: unknown; subject: string; text?: string; html?: string; headers?: Record<string, string>;
};

// A binding that keeps every message it is handed; with an error, it throws
// that error after keeping the message.
function fakeMail(error?: unknown) {
  const handed: Handed[] = [];
  const binding = {
    async send(message: Handed) {
      handed.push(message);
      if (error !== undefined) throw error;
      return { messageId: "<test@awardwatch.ca>" };
    },
  } as unknown as SendEmail;
  return { handed, binding };
}

// A sign-in post to the site's own host, as the deployed Worker sees it.
async function postToSite(email: string, env: object): Promise<Response> {
  return app.request(SITE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": nextIp(), origin: "https://awardwatch.ca" },
    body: new URLSearchParams({ email }).toString(),
  }, env);
}

async function auditCount(event: string): Promise<number> {
  return (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM audit WHERE event = ?").bind(event).first<{ n: number }>())?.n ?? 0;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("which sender answers", () => {
  it("as wrangler.jsonc ships it: the MAIL binding from MAIL_FROM on the site's host", () => {
    const shipped = testEnv() as unknown as { MAIL?: unknown; MAIL_FROM?: string };
    expect(shipped.MAIL).toBeDefined();
    expect(shipped.MAIL_FROM).toBe(FROM);
    expect(senderFor(shipped as never, SITE).kind).toBe("provider");
  });

  it("takes the log outbox first, on a local host only, then the binding, then the stub", () => {
    const { handed, binding } = fakeMail();
    const bound = onEnv({ MAIL: binding, MAIL_FROM: FROM });
    // MAIL_SENDER=log on a local host: the outbox, even with the binding.
    expect(senderFor(bound as never, LOCAL).kind).toBe("log");
    // The same variable on the site's host never reaches the outbox.
    expect(senderFor(bound as never, SITE).kind).toBe("provider");
    expect(senderFor({ ...bound, MAIL_SENDER: undefined } as never, LOCAL).kind).toBe("provider");
    // The binding and the address are both needed.
    for (const partial of [{ MAIL: binding, MAIL_FROM: undefined }, { MAIL: binding, MAIL_FROM: "  " }, { MAIL: undefined, MAIL_FROM: FROM }]) {
      const env = onEnv({ ...partial, MAIL_SENDER: undefined }) as never;
      expect(senderFor(env, SITE).kind).toBe("stub");
      expect(providerSender(env)).toBeNull();
    }
    // Choosing a sender sends nothing.
    expect(handed).toEqual([]);
  });
});

describe("the message handed to the binding", () => {
  it("comes from MAIL_FROM with the site's name, replies to the contact address, and carries the code in both bodies only", async () => {
    const { handed, binding } = fakeMail();
    const email = newEmail("mail");
    // MAIL_SENDER=log is still set: on the site's host the binding answers.
    const res = await postToSite(email, onEnv({ MAIL: binding, MAIL_FROM: FROM }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>Check Your Email</h1>");
    expect(handed).toHaveLength(1);
    const m = handed[0];
    expect(m.from).toEqual({ email: FROM, name: "Award Watch" });
    expect(m.to).toBe(email);
    expect(m.replyTo).toBe(CONTACT_EMAIL);
    expect(CONTACT_EMAIL).toBe("contact@awardwatch.ca");
    expect(m.subject).toBe("Your Award Watch sign-in code");
    expect(m.headers).toEqual({ "Auto-Submitted": "auto-generated" });
    expect(typeof m.text).toBe("string");
    expect(typeof m.html).toBe("string");
    const code = codeIn(m.text!);
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(m.html).toContain(code);
    expect(m.subject).not.toContain(code);
    expect(m.subject).not.toMatch(/[0-9]{6}/);
    // The link is the site's own address, in both bodies.
    const token = tokenIn(m.text!);
    expect(m.text).toContain(`https://awardwatch.ca/account/check?token=${token}`);
    expect(m.html).toContain(`https://awardwatch.ca/account/check?token=${token}`);
    // Nothing reached the development outbox.
    expect(await lastMail(email)).toBeNull();
    // The code in the message is the one stored: it signs in.
    expect((await post("/account/check", { email, code, sent: "1" })).status).toBe(303);
  });

  it("is in the language of the page", async () => {
    const { handed, binding } = fakeMail();
    const email = newEmail("mail-fr");
    await post("/account/sign-in", { email, lang: "fr" }, { env: onEnv({ MAIL_SENDER: undefined, MAIL: binding, MAIL_FROM: FROM }) });
    expect(handed).toHaveLength(1);
    expect(handed[0].subject).toBe("Votre code de connexion à Award Watch");
    expect(handed[0].from).toEqual({ email: FROM, name: "Award Watch" });
  });
});

// The parts of the template a test reads back: the image tags, the hidden
// preheader, the code band and the button.
const imagesIn = (html: string) => [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const preheaderIn = (html: string) => /<div style="display:none;[^"]*">([^<]*)<\/div>/.exec(html)?.[1];
const BAND = /<td class="band"[^>]*>\s*<span class="ink" role="text" aria-label="([^"]*)"[^>]*>([^<]*)<\/span>/;
const BUTTON = /<td class="btn"[^>]*><a href="([^"]*)"[^>]*>([^<]*)<\/a><\/td>/;

describe("the message's template", () => {
  it("holds both wordmarks, the code in its band, the button with the link and the address replies go to", async () => {
    const { handed, binding } = fakeMail();
    const email = newEmail("template");
    await postToSite(email, onEnv({ MAIL: binding, MAIL_FROM: FROM }));
    expect(handed).toHaveLength(1);
    const m = handed[0];
    const html = m.html!;
    const code = codeIn(m.text!);
    const link = `https://awardwatch.ca/account/check?token=${tokenIn(m.text!)}`;
    // The light wordmark shows by default; the dark one waits for the dark query.
    const images = imagesIn(html);
    expect(images.map((tag) => attr(tag, "src"))).toEqual([
      "https://awardwatch.ca/brand/wordmark.png",
      "https://awardwatch.ca/brand/wordmark-dark.png",
    ]);
    for (const tag of images) {
      expect(attr(tag, "alt")).toBe("Award Watch");
      expect([attr(tag, "width"), attr(tag, "height")]).toEqual(["142", "20"]);
    }
    expect(attr(images[0], "style")).toContain("display:block;");
    expect(attr(images[1], "style")).toContain("display:none;");
    expect(html).toContain(".logo-light{display:none!important}.logo-dark{display:block!important}");
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    // The code in the ruled band, labelled digit by digit.
    const band = BAND.exec(html);
    expect(band?.[2]).toBe(code);
    expect(band?.[1]).toBe(code.split("").join(" "));
    // Large and in a monospace face, so no digit is taken for another.
    const bandFont = /font:700 (\d+)px\/1 ([^;]*);/.exec(/<span class="ink" role="text"[^>]*\sstyle="([^"]*)"/.exec(html)?.[1] ?? "");
    expect(Number(bandFont?.[1])).toBeGreaterThanOrEqual(30);
    expect(bandFont?.[2]).toMatch(/\bmonospace$/);
    // The button carries the link.
    const button = BUTTON.exec(html);
    expect(button?.[1]).toBe(link);
    expect(button?.[2]).toBe("Sign in to Award Watch");
    // Replies go to the contact address the footer prints.
    expect(m.replyTo).toBe(CONTACT_EMAIL);
    expect(html).toContain(`<a href="mailto:${CONTACT_EMAIL}" style="color:#5b6b80;">${CONTACT_EMAIL}</a>`);
    expect(html).toContain(">This message was sent because this address was entered on awardwatch.ca.</p>");
    expect(html).toContain(">Award Watch · Federal tenders, awards, contracts and grants, by organization. · <a href=\"mailto:");
    // The code is in both parts and nowhere a preview shows.
    expect(m.text).toContain(code);
    expect(html).toContain(code);
    expect(preheaderIn(html)).toBe("A sign-in was requested for this address on awardwatch.ca.");
    expect(preheaderIn(html)).not.toMatch(/[0-9]{6}/);
    expect(m.subject).not.toContain(code);
    expect(html).toContain(`<title>${m.subject}</title>`);
  });

  it("keeps to what mail clients show: inline styles, no web font, no script, no image but the wordmarks", () => {
    const { html } = signInMessage("en", "reader@example.com", "482913", "https://awardwatch.ca/account/check?token=abc", 15);
    expect(html).not.toMatch(/<script\b|<link\b|@font-face|@import|url\(/i);
    expect(html).not.toMatch(/<svg\b|<iframe\b|<form\b/i);
    expect(imagesIn(html)).toHaveLength(2);
    expect(html.match(/(https?:)?\/\/[^"\s<)]+/g)?.every((url) => url.startsWith("https://awardwatch.ca"))).toBe(true);
    // Every element that draws something carries its own style.
    const drawn = html.match(/<(?:p|h1|a|img|span)\b[^>]*>|<td class="(?:band|btn)"[^>]*>/g) ?? [];
    expect(drawn.length).toBeGreaterThan(10);
    for (const tag of drawn) expect(tag, tag).toMatch(/\sstyle="[^"]+"/);
  });

  it("has a plain-text part with the prototype's lines, in order", () => {
    const link = "https://awardwatch.ca/account/check?token=abc";
    const { text } = signInMessage("en", "reader@example.com", "482913", link, 15);
    expect(text.split("\n")).toEqual([
      "Your sign-in code",
      "",
      "482913",
      "",
      "Enter it on the page where you asked for it, or open this link:",
      link,
      "",
      "Either one works once, within 15 minutes.",
      "",
      "If you did not ask for this, ignore this message. Nothing happens without the code.",
      "",
      "This message was sent because this address was entered on awardwatch.ca.",
      "Award Watch · Federal tenders, awards, contracts and grants, by organization.",
      CONTACT_EMAIL,
      "",
    ]);
  });

  it("is in French from a French page: the strings, the link's language and the header link", () => {
    const link = "https://awardwatch.ca/account/check?token=abc&lang=fr";
    const m = signInMessage("fr", "lecteur@example.com", "482913", link, 15);
    expect(m.subject).toBe("Votre code de connexion à Award Watch");
    expect(m.html).toContain('<html lang="fr">');
    expect(m.html).toContain(">Votre code de connexion</h1>");
    expect(nbsp(m.html)).toContain("Saisissez ce code sur la page où vous l’avez demandé, ou utilisez le bouton. L’un ou l’autre fonctionne une seule fois, pendant 15 minutes.");
    expect(preheaderIn(m.html)).toBe("Une connexion a été demandée pour cette adresse sur awardwatch.ca.");
    expect(BAND.exec(m.html)?.[2]).toBe("482913");
    expect(BUTTON.exec(m.html)?.slice(1)).toEqual(["https://awardwatch.ca/account/check?token=abc&amp;lang=fr", "Se connecter à Award Watch"]);
    expect(m.html).toContain('<a href="https://awardwatch.ca/?lang=fr" style="color:#5b6b80;text-decoration:none;">awardwatch.ca</a>');
    for (const tag of imagesIn(m.html)) expect(attr(tag, "alt")).toBe("Award Watch");
    for (const english of ["Your sign-in code", "Enter this code", "Sign in to Award Watch", "This message was sent", "Federal tenders"]) {
      expect(m.html).not.toContain(english);
      expect(m.text).not.toContain(english);
    }
    expect(nbsp(m.text).split("\n")).toEqual([
      "Votre code de connexion",
      "",
      "482913",
      "",
      "Saisissez-le sur la page où vous l’avez demandé, ou ouvrez ce lien :",
      link,
      "",
      "L’un ou l’autre fonctionne une seule fois, pendant 15 minutes.",
      "",
      "Si vous n’avez rien demandé, ignorez ce message. Rien ne se passe sans le code.",
      "",
      "Ce message a été envoyé parce que cette adresse a été saisie sur awardwatch.ca.",
      "Award Watch · Appels d’offres, attributions, contrats et subventions du fédéral, par organisation.",
      CONTACT_EMAIL,
      "",
    ]);
  });

  it("escapes what it is given", () => {
    const { html } = signInMessage("en", "reader@example.com", "<b>1</b>", 'https://awardwatch.ca/x?a=1&b="><script>', 15, 'https://awardwatch.ca/"><i>');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
    expect(html).toContain('href="https://awardwatch.ca/x?a=1&amp;b=&quot;&gt;&lt;script&gt;"');
    expect(html).toContain("&lt;b&gt;1&lt;/b&gt;");
    expect(html).toContain('src="https://awardwatch.ca/&quot;&gt;&lt;i&gt;/brand/wordmark.png"');
  });

  it("points its images at the request's own origin on a local run", async () => {
    const email = newEmail("local-images");
    await post("/account/sign-in", { email });
    const mail = await lastMail(email);
    expect(imagesIn(mail!.html).map((tag) => attr(tag, "src"))).toEqual([
      "http://localhost/brand/wordmark.png",
      "http://localhost/brand/wordmark-dark.png",
    ]);
  });

  // Static files are served before the Worker runs (wrangler.jsonc, "assets"),
  // so the site's routes never see /brand/; the test runtime's ASSETS binding
  // serves the same public/ directory.
  it("finds both images served from the site's /brand/ as 284 by 40 PNGs", async () => {
    for (const file of ["wordmark.png", "wordmark-dark.png"]) {
      const res = await env.ASSETS.fetch(`https://awardwatch.ca/brand/${file}`);
      expect(res.status, file).toBe(200);
      expect(res.headers.get("content-type"), file).toBe("image/png");
      const bytes = new Uint8Array(await res.arrayBuffer());
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect([...bytes.slice(0, 8)], file).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(new TextDecoder().decode(bytes.slice(12, 16)), file).toBe("IHDR");
      expect([view.getUint32(16), view.getUint32(20)], file).toEqual([284, 40]);
    }
  });
});

describe("a send the binding refuses", () => {
  it("answers failed and logs the error's code, never the address, the subject or the body", async () => {
    const email = newEmail("refused");
    const message = signInMessage("en", email, "482913", "https://awardwatch.ca/account/check?token=abc", 15);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cases: [unknown, string][] = [
      // The binding's own errors carry a code; the message may quote the address.
      [Object.assign(new Error(`email to ${email} not allowed`), { code: "E_RECIPIENT_NOT_ALLOWED" }), "E_RECIPIENT_NOT_ALLOWED"],
      [Object.assign(new Error("quota"), { code: "E_DAILY_LIMIT_EXCEEDED" }), "E_DAILY_LIMIT_EXCEEDED"],
      // No code: the error's name.
      [new TypeError(`bad recipient ${email}`), "TypeError"],
      // A code that is not a code is not logged.
      [Object.assign(new Error("x"), { code: `to ${email}` }), "Error"],
      [`refused ${email}`, "unknown"],
    ];
    for (const [error, tag] of cases) {
      log.mockClear();
      const sender = providerSender(onEnv({ MAIL: fakeMail(error).binding, MAIL_FROM: FROM }) as never)!;
      expect(sender.kind).toBe("provider");
      expect(await sender.send(message)).toEqual({ sent: false, reason: "failed" });
      const logged = log.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
      expect(logged).toBe(`[mail] not sent: ${tag}`);
      expect(logged).not.toContain(email);
      expect(logged).not.toContain("482913");
      expect(logged).not.toContain(message.subject);
    }
  });

  it("leaves the sign-in page saying the message could not be sent, with a 503", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const email = newEmail("refused");
    const { handed, binding } = fakeMail(Object.assign(new Error("not verified"), { code: "E_SENDER_NOT_VERIFIED" }));
    const before = await auditCount("mail_failed");
    const res = await postToSite(email, onEnv({ MAIL: binding, MAIL_FROM: FROM }));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("The message could not be sent. Try again in a few minutes.");
    expect(handed).toHaveLength(1);
    expect(await auditCount("mail_failed")).toBe(before + 1);
    const audit = await ACCOUNTS.prepare("SELECT detail FROM audit ORDER BY id DESC LIMIT 20").all<{ detail: string | null }>();
    for (const row of audit.results ?? []) expect(row.detail ?? "").not.toContain("@");
    expect(await lastMail(email)).toBeNull();
  });
});
