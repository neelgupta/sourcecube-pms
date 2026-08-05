import net from "node:net";
import tls from "node:tls";
import { prisma } from "./prisma.js";

type SmtpSecurity = "TLS" | "SSL" | "NONE";

export type SmtpEmailSetting = {
  tenantId: string;
  enabled: boolean;
  host: string | null;
  port: number | null;
  security: SmtpSecurity;
  username: string | null;
  password: string | null;
  senderEmail: string | null;
  senderName: string | null;
  defaultRecipients: string[];
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  lastError: string | null;
};

export type SafeSmtpEmailSetting = Omit<SmtpEmailSetting, "password"> & { passwordSet: boolean };

function postgresTextArray(values: string[]) {
  return `{${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

function asRows(value: unknown): SmtpEmailSetting[] {
  return Array.isArray(value) ? (value as SmtpEmailSetting[]) : [];
}

export function publicSmtpSetting(row: SmtpEmailSetting | null): SafeSmtpEmailSetting | null {
  if (!row) return null;
  const { password, ...rest } = row;
  return { ...rest, passwordSet: Boolean(password) };
}

export async function getSmtpEmailSetting(tenantId: string): Promise<SmtpEmailSetting | null> {
  try {
    const rows = asRows(await prisma.$queryRawUnsafe(
      'SELECT "tenantId", "enabled", "host", "port", "security", "username", "password", "senderEmail", "senderName", "defaultRecipients", "lastTestedAt", "lastTestStatus", "lastError" FROM "SmtpEmailSetting" WHERE "tenantId" = $1 LIMIT 1',
      tenantId,
    ));
    return rows[0] ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("SmtpEmailSetting") || message.includes("relation") || message.includes("does not exist")) return null;
    throw error;
  }
}

export async function upsertSmtpEmailSetting(tenantId: string, input: {
  enabled: boolean;
  host: string | null;
  port: number | null;
  security: SmtpSecurity;
  username: string | null;
  password?: string | null;
  senderEmail: string | null;
  senderName: string | null;
  defaultRecipients: string[];
}) {
  const existing = await getSmtpEmailSetting(tenantId);
  const password = input.password === undefined ? existing?.password ?? null : input.password;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SmtpEmailSetting" ("tenantId", "enabled", "host", "port", "security", "username", "password", "senderEmail", "senderName", "defaultRecipients", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], CURRENT_TIMESTAMP)
     ON CONFLICT ("tenantId") DO UPDATE SET
       "enabled" = EXCLUDED."enabled",
       "host" = EXCLUDED."host",
       "port" = EXCLUDED."port",
       "security" = EXCLUDED."security",
       "username" = EXCLUDED."username",
       "password" = EXCLUDED."password",
       "senderEmail" = EXCLUDED."senderEmail",
       "senderName" = EXCLUDED."senderName",
       "defaultRecipients" = EXCLUDED."defaultRecipients",
       "updatedAt" = CURRENT_TIMESTAMP`,
    tenantId,
    input.enabled,
    input.host,
    input.port,
    input.security,
    input.username,
    password,
    input.senderEmail,
    input.senderName,
    postgresTextArray(input.defaultRecipients),
  );
  return getSmtpEmailSetting(tenantId);
}

function encodeAddress(email: string, name?: string | null) {
  const cleanEmail = email.trim();
  const cleanName = name?.trim();
  if (!cleanName) return cleanEmail;
  return `"${cleanName.replace(/"/g, "'")}" <${cleanEmail}>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] ?? char));
}

function createMessage(input: { from: string; to: string[]; subject: string; text: string; html?: string }) {
  const boundary = `sct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to.join(", ")}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  return `${headers.join("\r\n")}\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${input.text}\r\n--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${input.html ?? escapeHtml(input.text).replace(/\n/g, "<br />")}\r\n--${boundary}--\r\n.`;
}

async function smtpExchange(socket: net.Socket | tls.TLSSocket, command?: string, expected = [250]) {
  if (command) socket.write(`${command}\r\n`);
  let buffer = "";
  return await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => cleanup(new Error("SMTP server timed out")), 20000);
    function cleanup(error?: Error, response?: string) {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
      if (error) reject(error);
      else resolve(response ?? "");
    }
    function onError(error: Error) { cleanup(error); }
    function onData(chunk: Buffer) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return;
      const code = Number(last.slice(0, 3));
      if (!expected.includes(code)) cleanup(new Error(buffer.trim() || `SMTP command failed (${code})`));
      else cleanup(undefined, buffer.trim());
    }
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function connect(setting: SmtpEmailSetting): Promise<net.Socket | tls.TLSSocket> {
  const host = setting.host!;
  const port = setting.port!;
  const socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
    const created: net.Socket | tls.TLSSocket = setting.security === "SSL"
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });

    const readyEvent = setting.security === "SSL" ? "secureConnect" : "connect";
    const cleanup = () => {
      created.off(readyEvent, onReady);
      created.off("error", onError);
      created.off("timeout", onTimeout);
    };
    const onReady = () => {
      cleanup();
      resolve(created);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      created.destroy();
      reject(new Error("SMTP connection timed out"));
    };

    created.once(readyEvent, onReady);
    created.once("error", onError);
    created.once("timeout", onTimeout);
    created.setTimeout(20000);
  });
  await smtpExchange(socket, undefined, [220]);
  await smtpExchange(socket, `EHLO ${setting.senderEmail?.split("@")[1] ?? "localhost"}`, [250]);
  if (setting.security === "TLS") {
    await smtpExchange(socket, "STARTTLS", [220]);
    const secure = tls.connect({ socket, servername: host });
    await new Promise<void>((resolve, reject) => {
      secure.once("secureConnect", () => resolve());
      secure.once("error", reject);
    });
    await smtpExchange(secure, `EHLO ${setting.senderEmail?.split("@")[1] ?? "localhost"}`, [250]);
    return secure;
  }
  return socket;
}
export async function sendSmtpEmail(setting: SmtpEmailSetting, input: { to: string[]; subject: string; text: string; html?: string }) {
  if (!setting.enabled) throw new Error("SMTP notifications are disabled");
  if (!setting.host || !setting.port || !setting.username || !setting.password || !setting.senderEmail) {
    throw new Error("SMTP settings are incomplete");
  }
  const socket = await connect(setting);
  try {
    await smtpExchange(socket, "AUTH LOGIN", [334]);
    await smtpExchange(socket, Buffer.from(setting.username).toString("base64"), [334]);
    await smtpExchange(socket, Buffer.from(setting.password).toString("base64"), [235]);
    await smtpExchange(socket, `MAIL FROM:<${setting.senderEmail}>`, [250]);
    for (const recipient of input.to) await smtpExchange(socket, `RCPT TO:<${recipient}>`, [250, 251]);
    await smtpExchange(socket, "DATA", [354]);
    await smtpExchange(socket, createMessage({ from: encodeAddress(setting.senderEmail, setting.senderName), to: input.to, subject: input.subject, text: input.text, html: input.html }), [250]);
    await smtpExchange(socket, "QUIT", [221, 250]);
  } finally {
    socket.end();
  }
}

export function inviteUrl(token: string) {
  const origin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
  return `${origin.replace(/\/$/, "")}/login?invite=${encodeURIComponent(token)}`;
}

export async function sendCompanyInviteEmail(input: { tenantId: string; to: string; name: string; companyName: string; token: string; message?: string | null }) {
  const setting = await getSmtpEmailSetting(input.tenantId);
  if (!setting?.enabled) return { sent: false, skipped: true, error: null as string | null };
  const url = inviteUrl(input.token);
  const customMessage = input.message?.trim();
  const text = [
    `Hello ${input.name},`,
    "",
    `You have been invited to join ${input.companyName}.`,
    customMessage ? `Message: ${customMessage}` : null,
    "",
    `Open this link to set your password and join: ${url}`,
    "",
    "This invitation expires in 7 days."
  ].filter(Boolean).join("\n");
  const html = `<p>Hello ${escapeHtml(input.name)},</p><p>You have been invited to join <strong>${escapeHtml(input.companyName)}</strong>.</p>${customMessage ? `<p>${escapeHtml(customMessage)}</p>` : ""}<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#159c69;color:#fff;text-decoration:none;font-weight:600">Accept invitation</a></p><p style="color:#64748b;font-size:13px">This invitation expires in 7 days.</p><p style="word-break:break-all"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`;
  try {
    await sendSmtpEmail(setting, { to: [input.to], subject: `Invitation to join ${input.companyName}`, text, html });
    return { sent: true, skipped: false, error: null as string | null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invite email could not be sent";
    await prisma.$executeRawUnsafe('UPDATE "SmtpEmailSetting" SET "lastTestStatus" = $2, "lastError" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = $1', input.tenantId, "failed", message.slice(0, 1000));
    return { sent: false, skipped: false, error: message };
  }
}
