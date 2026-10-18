import { ImapFlow } from "imapflow";
import {
  db,
  getSettings,
  updateSettings,
  addLog,
  nowIso,
  normalizeEmail,
  suppressEmail,
  isInboundProcessed,
  markInboundProcessed
} from "./db.js";

const EMAIL_RE = /[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g;

const BOUNCE_SENDER_RE = /(mailer-daemon|mail-daemon|mailerdaemon|postmaster|mail delivery|no-?reply.*(delivery|bounce))/i;
const BOUNCE_SUBJECT_RE = /(undelivered|delivery status notification|delivery (failure|has failed)|returned to sender|mail delivery failed|failure notice|mail delivery subsystem|could not be delivered|returned mail|undeliverable)/i;

const STOP_PATTERNS = [
  /^\s*(stop|unsubscribe|remove)\b/im,
  /\breply\s+stop\b/i,
  /\bunsubscribe\b/i,
  /\bremove me\b/i,
  /\bopt[\s-]?out\b/i,
  /\btake me off\b/i,
  /\bdon'?t (email|contact|message) me\b/i,
  /\bplease stop\b/i
];

export function splitHeadersAndBody(source) {
  const idx = source.indexOf("\r\n\r\n");
  const alt = source.indexOf("\n\n");
  const cut = idx >= 0 ? idx : alt;
  if (cut < 0) return { headers: source, body: "" };
  return { headers: source.slice(0, cut), body: source.slice(cut + 2) };
}

function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtml(text) {
  return text
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function decodeEntitiesBasic(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function stripQuoted(text) {
  let out = text;
  const onWrote = out.search(/^\s*On .{0,120}\bwrote:/im);
  if (onWrote >= 0) out = out.slice(0, onWrote);
  const original = out.search(/^\s*-{2,}\s*original message\s*-{2,}/im);
  if (original >= 0) out = out.slice(0, original);
  const underscore = out.search(/^\s*_{5,}\s*$/m);
  if (underscore >= 0) out = out.slice(0, underscore);
  const fromLine = out.search(/^\s*From:\s.+$/im);
  if (fromLine >= 0 && fromLine > 0) out = out.slice(0, fromLine);
  return out
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n")
    .trim();
}

export function readableText(source) {
  const { body } = splitHeadersAndBody(source);
  let text = body;
  if (/=\?|=\r?\n|=[0-9A-F]{2}/i.test(text)) {
    try {
      text = decodeQuotedPrintable(text);
    } catch {
      /* keep raw */
    }
  }
  if (/<[a-z!/][^>]*>/i.test(text)) text = stripHtml(text);
  return decodeEntitiesBasic(text).replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

export function classifyBounce(fromAddresses, subject, source) {
  const fromHit = fromAddresses.some((a) => BOUNCE_SENDER_RE.test(a || ""));
  const subjHit = BOUNCE_SUBJECT_RE.test(subject || "");
  const statusHit = /Content-Type:\s*multipart\/report/i.test(source) && /report-type\s*=\s*delivery-status/i.test(source);
  return fromHit || subjHit || statusHit;
}

export function extractFailedRecipients(source, exclude) {
  const { headers } = splitHeadersAndBody(source);
  const candidates = new Set();
  const xFailed = headers.match(/X-Failed-Recipients:\s*(.+)/i);
  if (xFailed) {
    for (const m of xFailed[1].match(EMAIL_RE) || []) candidates.add(m);
  }
  for (const m of source.match(EMAIL_RE) || []) candidates.add(m);
  const out = [];
  for (const raw of candidates) {
    const email = normalizeEmail(raw.replace(/[>,;:).]+$/, ""));
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (exclude.has(email)) continue;
    if (BOUNCE_SENDER_RE.test(email)) continue;
    out.push(email);
  }
  return [...new Set(out)];
}

export function bounceDetail(source) {
  const text = readableText(source);
  const permanent = /\b5\.\d+\.\d+\b/.test(text) || /permanent (error|failure)/i.test(text);
  const transient = /\b4\.\d+\.\d+\b/.test(text) || /temporary (error|failure)/i.test(text);
  let reason = "";
  const codeLine = text.match(/(error\s*code\s*:?[^\n]*)/i);
  const diag = text.match(/(diagnostic-code:\s*[^\n]*)/i);
  const status = text.match(/Status:\s*([0-9]+\.[0-9]+\.[0-9]+)/i);
  if (diag) reason = diag[1];
  else if (codeLine) reason = codeLine[1];
  else if (status) reason = `Status ${status[1]}`;
  reason = reason.replace(/\s+/g, " ").trim().slice(0, 240);
  const hard = permanent || (!transient && /5\.\d+\.\d+/.test(reason));
  return { reason: reason || (hard ? "Permanent delivery failure" : "Delivery failure"), hard };
}

function summarize(text, limit = 200) {
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

function findRecipientsByEmail(email) {
  return db
    .prepare("SELECT * FROM recipients WHERE lower(email) = lower(?) AND status IN ('sent','replied') ORDER BY sent_at DESC")
    .all(email);
}

function cancelFollowups(recipientId) {
  const info = db
    .prepare(
      `UPDATE recipients SET followup1_status = 'cancelled'
       WHERE id = ? AND followup1_status = 'pending'`
    )
    .run(recipientId);
  const info2 = db
    .prepare(
      `UPDATE recipients SET followup2_status = 'cancelled'
       WHERE id = ? AND followup2_status = 'pending'`
    )
    .run(recipientId);
  return (info.changes || 0) + (info2.changes || 0);
}

export function handleBounce({ source, exclude }) {
  const { reason, hard } = bounceDetail(source);
  const emails = extractFailedRecipients(source, exclude);
  let bounces = 0;
  let suppressed = 0;
  let cancelled = 0;
  for (const email of emails) {
    const matches = findRecipientsByEmail(email);
    if (!matches.length) continue;
    for (const rec of matches) {
      bounces += 1;
      db.prepare("UPDATE recipients SET status = 'bounced', error_message = ? WHERE id = ?").run(
        `${hard ? "Hard" : "Soft"} bounce: ${reason}`,
        rec.id
      );
      cancelled += cancelFollowups(rec.id);
      addLog({
        type: "bounce",
        status: hard ? "hard" : "soft",
        recipient_email: rec.email,
        campaign_id: rec.campaign_id,
        message: `${hard ? "Hard" : "Soft"} bounce detected: ${reason}`
      });
    }
    if (hard) {
      suppressEmail(email, `hard bounce: ${reason}`);
      suppressed += 1;
    }
  }
  return { bounces, suppressed, cancelled };
}

export function handleReply({ source, recipients, exclude }) {
  const text = readableText(source);
  const cleaned = stripQuoted(text).toLowerCase();
  const isStop = STOP_PATTERNS.some((re) => re.test(cleaned.slice(0, 600)));
  let replies = 0;
  let suppressed = 0;
  let cancelled = 0;
  for (const rec of recipients) {
    replies += 1;
    db.prepare("UPDATE recipients SET status = 'replied', replied_at = COALESCE(replied_at, ?) WHERE id = ?").run(
      nowIso(),
      rec.id
    );
    cancelled += cancelFollowups(rec.id);
    addLog({
      type: "reply",
      status: isStop ? "stop" : "replied",
      recipient_email: rec.email,
      campaign_id: rec.campaign_id,
      message: isStop
        ? "Reply detected with opt-out request; recipient suppressed and follow-ups stopped."
        : `Reply detected from ${rec.email}; follow-ups stopped.`
    });
    if (isStop) {
      suppressEmail(rec.email, "replied STOP / unsubscribe");
      suppressed += 1;
    }
  }
  return { replies, suppressed, cancelled, isStop, preview: summarize(text) };
}

export async function pollInbound() {
  if (polling) return { scanned: 0, replies: 0, bounces: 0, suppressed: 0, cancelledFollowups: 0, skipped: 0, alreadyRunning: true };
  polling = true;
  try {
    return await runPoll();
  } finally {
    polling = false;
  }
}

let polling = false;

async function runPoll() {
  const settings = getSettings();
  const user = settings.zoho_imap_user || settings.zoho_sender_email;
  const pass = String(settings.zoho_imap_pass || settings.zoho_smtp_pass || "").replace(/\s+/g, "");
  if (!user || !pass) throw new Error("IMAP credentials are not configured.");

  const exclude = new Set();
  if (user) exclude.add(normalizeEmail(user));
  if (settings.zoho_sender_email) exclude.add(normalizeEmail(settings.zoho_sender_email));

  const client = new ImapFlow({
    host: settings.zoho_imap_host || "imappro.zoho.com",
    port: Number(settings.zoho_imap_port) || 993,
    secure: true,
    auth: { user, pass },
    logger: false
  });

  let streamError = null;
  client.on("error", (err) => {
    streamError = streamError || err;
  });

  const summary = { scanned: 0, replies: 0, bounces: 0, suppressed: 0, cancelledFollowups: 0, skipped: 0 };
  const mailboxes = ["INBOX", "Trash"];

  await client.connect();
  try {
    for (const mailbox of mailboxes) {
      if (client.usable === false) break;
      let lock;
      try {
        lock = await client.getMailboxLock(mailbox);
      } catch {
        continue;
      }
      try {
        const since = new Date(Date.now() - 14 * 86400000);
        for await (const msg of client.fetch({ since }, { envelope: true, source: true, uid: true })) {
          const messageId = msg.envelope?.messageId || `${mailbox}:${msg.uid}`;
          const key = `${mailbox}:${messageId}`;
          if (isInboundProcessed(key)) {
            summary.skipped += 1;
            continue;
          }
          summary.scanned += 1;
          const source = msg.source ? msg.source.toString("utf8") : "";
          const fromAddresses = (msg.envelope?.from || []).map((f) => f.address).filter(Boolean);
          const subject = msg.envelope?.subject || "";

          if (classifyBounce(fromAddresses, subject, source)) {
            const r = handleBounce({ source, exclude });
            summary.bounces += r.bounces;
            summary.suppressed += r.suppressed;
            summary.cancelledFollowups += r.cancelled;
            markInboundProcessed(key);
            continue;
          }

          const normalizedFrom = fromAddresses.map(normalizeEmail).filter((e) => e && !exclude.has(e));
          const matched = [];
          for (const addr of normalizedFrom) {
            for (const rec of findRecipientsByEmail(addr)) {
              if (!matched.some((m) => m.id === rec.id)) matched.push(rec);
            }
          }
          if (matched.length) {
            const r = handleReply({ source, recipients: matched, exclude });
            summary.replies += r.replies;
            summary.suppressed += r.suppressed;
            summary.cancelledFollowups += r.cancelled;
          }
          markInboundProcessed(key);
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
  }

  if (streamError && summary.scanned === 0) {
    throw streamError;
  }

  updateSettings({ last_imap_check: nowIso() });
  return summary;
}
