// The sign-in message through Cloudflare Email Sending (the MAIL binding,
// src/account/sender.ts). A fake binding records what it was handed, or
// throws the way the real one does; the local runtime's stand-in for the
// binding is never given a message.
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { providerSender, senderFor, signInMessage } from "../src/account/sender";
import { CONTACT_EMAIL } from "../src/pages/docs";
import { ACCOUNTS, codeIn, lastMail, newEmail, nextIp, onEnv, post, tokenIn, useAccountsDb } from "./accounts-helpers";
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
    expect(m.subject).toBe("Your sign-in code for Award Watch");
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
