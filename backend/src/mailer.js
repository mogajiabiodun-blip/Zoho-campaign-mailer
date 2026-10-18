import nodemailer from "nodemailer";
import { getSettings } from "./db.js";

export function interpolate(template, fields = {}) {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_\s-]+?)\s*\}\}|\{\s*([a-zA-Z0-9_\s-]+?)\s*\}/g, (raw, a, b) => {
    const key = (a || b || "").trim();
    if (!key) return raw;
    if (fields[key] !== undefined && fields[key] !== null) return String(fields[key]);
    const norm = key.toLowerCase().replace(/[\s_-]+/g, "");
    for (const k of Object.keys(fields)) {
      if (k.toLowerCase().replace(/[\s_-]+/g, "") === norm && fields[k] != null) return String(fields[k]);
    }
    return raw;
  });
}

const HTML_TAG_RE = /<\s*(a|p|div|br|span|table|tr|td|th|ul|ol|li|h[1-6]|strong|em|b|i|u|img|font|html|body|center|blockquote)\b[^>]*>/i;

export function looksLikeHtml(value) {
  return HTML_TAG_RE.test(String(value || ""));
}

function decodeEntities(value) {
  const map = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
    "&apos;": "'", "&nbsp;": " ", "&mdash;": "\u2014", "&ndash;": "\u2013", "&hellip;": "\u2026"
  };
  return String(value || "").replace(/&[a-z#0-9]+;/gi, (m) => map[m.toLowerCase()] ?? m);
}

export function htmlToText(value) {
  const withLinks = String(value || "").replace(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, label) => {
      const text = String(label || "").replace(/<[^>]+>/g, "").trim();
      if (!text) return href;
      return text.includes(href) ? text : `${text} (${href})`;
    }
  );
  const stripped = withLinks
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|blockquote|center)\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(stripped)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toPlainText(value) {
  const raw = String(value || "");
  return looksLikeHtml(raw) ? htmlToText(raw) : raw;
}

function trackingBase() {
  const base = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(base)) return null;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(base)) return null;
  return base;
}

export function buildMessageParts(body, { recipientId, campaignId, track } = {}) {
  const raw = String(body || "");
  const isHtml = looksLikeHtml(raw);
  let text;
  let html;
  if (isHtml) {
    html = raw;
    text = htmlToText(raw) || raw.replace(/<[^>]+>/g, " ").trim();
  } else {
    const escaped = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    text = raw;
    html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${escaped.replace(/\n/g, "<br/>")}</div>`;
  }
  const base = track ? trackingBase() : null;
  if (base && recipientId) {
    html = html.replace(/https?:\/\/[^\s"'<>)]+/g, (url) => {
      if (url.startsWith(base)) return url;
      const tracked = `${base}/api/track/click?rid=${encodeURIComponent(recipientId)}&cid=${encodeURIComponent(campaignId || "")}&u=${encodeURIComponent(url)}`;
      return tracked;
    });
    html += `<img src="${base}/api/track/open?rid=${encodeURIComponent(recipientId)}" width="1" height="1" alt="" style="display:none"/>`;
  }
  return { text, html, isHtml };
}

export function createTransport(settings = getSettings()) {
  const port = Number(settings.zoho_smtp_port) || 465;
  return nodemailer.createTransport({
    host: settings.zoho_smtp_host || "smtppro.zoho.com",
    port,
    secure: port === 465,
    auth: {
      user: settings.zoho_smtp_user || settings.zoho_sender_email,
      pass: (settings.zoho_smtp_pass || "").replace(/\s+/g, "")
    }
  });
}

export async function sendMail({ to, subject, body, recipientId, campaignId }) {
  const settings = getSettings();
  const user = settings.zoho_smtp_user || settings.zoho_sender_email;
  const pass = (settings.zoho_smtp_pass || "").replace(/\s+/g, "");
  if (!user || !pass) {
    throw new Error("Zoho SMTP credentials are not configured. Add them in Settings.");
  }
  const transporter = createTransport(settings);
  const text = toPlainText(body);
  const info = await transporter.sendMail({
    from: settings.zoho_sender_email || user,
    replyTo: settings.zoho_sender_email || user,
    to,
    subject: subject || "Outreach",
    text: text || " "
  });
  return info;
}

export async function testSmtp(override = {}) {
  const settings = { ...getSettings(), ...override };
  if (override.zoho_smtp_pass) settings.zoho_smtp_pass = override.zoho_smtp_pass;
  const user = settings.zoho_smtp_user || settings.zoho_sender_email;
  const pass = (settings.zoho_smtp_pass || "").replace(/\s+/g, "");
  if (!user || !pass) throw new Error("SMTP user and app password are required.");
  const transporter = createTransport(settings);
  await transporter.verify();
  return { ok: true, host: settings.zoho_smtp_host, user };
}
