import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, "campaigns.db");

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  daily_send_limit INTEGER DEFAULT 100,
  time_window_start TEXT DEFAULT '08:00',
  time_window_end TEXT DEFAULT '10:00',
  sending_interval_sec INTEGER DEFAULT 10,
  default_timezone TEXT DEFAULT 'LOCAL',
  default_workdays_only INTEGER DEFAULT 1,
  all_day_dispatch INTEGER DEFAULT 0,
  track_links_enabled INTEGER DEFAULT 1,
  zoho_sender_email TEXT DEFAULT '',
  zoho_smtp_host TEXT DEFAULT 'smtppro.zoho.com',
  zoho_smtp_port INTEGER DEFAULT 465,
  zoho_smtp_user TEXT DEFAULT '',
  zoho_smtp_pass TEXT DEFAULT '',
  zoho_auth_mode TEXT DEFAULT 'smtp',
  zoho_client_id TEXT DEFAULT '',
  zoho_client_secret TEXT DEFAULT '',
  zoho_refresh_token TEXT DEFAULT '',
  zoho_account_id TEXT DEFAULT '',
  zoho_domain TEXT DEFAULT 'zoho.com',
  zoho_imap_host TEXT DEFAULT 'imappro.zoho.com',
  zoho_imap_port INTEGER DEFAULT 993,
  zoho_imap_user TEXT DEFAULT '',
  zoho_imap_pass TEXT DEFAULT '',
  last_imap_check TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_timezone TEXT DEFAULT 'America/New_York',
  time_window_start TEXT DEFAULT '08:00',
  time_window_end TEXT DEFAULT '10:00',
  sending_interval_sec INTEGER DEFAULT 10,
  workdays_only INTEGER DEFAULT 1,
  daily_new_limit INTEGER DEFAULT 0,
  daily_followup_limit INTEGER DEFAULT 0,
  status TEXT DEFAULT 'scheduled',
  tags TEXT DEFAULT '[]',
  followup1_enabled INTEGER DEFAULT 0,
  followup1_delay_days INTEGER DEFAULT 3,
  followup1_time_window_start TEXT DEFAULT '08:00',
  followup1_time_window_end TEXT DEFAULT '10:00',
  followup1_default_subject TEXT DEFAULT '',
  followup1_default_body TEXT DEFAULT '',
  followup2_enabled INTEGER DEFAULT 0,
  followup2_delay_days INTEGER DEFAULT 4,
  followup2_time_window_start TEXT DEFAULT '08:00',
  followup2_time_window_end TEXT DEFAULT '10:00',
  followup2_default_subject TEXT DEFAULT '',
  followup2_default_body TEXT DEFAULT '',
  last_sent_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  custom_fields TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  followup1_subject TEXT DEFAULT '',
  followup1_body TEXT DEFAULT '',
  followup1_status TEXT DEFAULT 'pending',
  followup2_subject TEXT DEFAULT '',
  followup2_body TEXT DEFAULT '',
  followup2_status TEXT DEFAULT 'pending',
  followup1_sent_at TEXT,
  followup2_sent_at TEXT,
  row_index INTEGER DEFAULT 0,
  error_message TEXT,
  sent_at TEXT,
  replied_at TEXT,
  clicked_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS unsubscribed (
  email TEXT PRIMARY KEY,
  reason TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'info',
  recipient_email TEXT,
  campaign_id TEXT,
  message TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clicks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  recipient_id TEXT,
  url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS send_counters (
  day TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS campaign_pacing (
  campaign_id TEXT NOT NULL,
  day TEXT NOT NULL,
  new_sent INTEGER DEFAULT 0,
  followup_sent INTEGER DEFAULT 0,
  PRIMARY KEY (campaign_id, day)
);

CREATE TABLE IF NOT EXISTS inbound_processed (
  key TEXT PRIMARY KEY,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("recipients", "row_index", "row_index INTEGER DEFAULT 0");
ensureColumn("recipients", "followup1_sent_at", "followup1_sent_at TEXT");
ensureColumn("recipients", "followup2_sent_at", "followup2_sent_at TEXT");
ensureColumn("campaigns", "daily_new_limit", "daily_new_limit INTEGER DEFAULT 0");
ensureColumn("campaigns", "daily_followup_limit", "daily_followup_limit INTEGER DEFAULT 0");

const existing = db.prepare("SELECT id FROM settings WHERE id = 1").get();
if (!existing) {
  db.prepare("INSERT INTO settings (id) VALUES (1)").run();
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayKey(timeZone = "UTC") {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function getSettings() {
  const row = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  return {
    ...row,
    default_workdays_only: !!row.default_workdays_only,
    all_day_dispatch: !!row.all_day_dispatch,
    track_links_enabled: !!row.track_links_enabled,
    zoho_smtp_pass_configured: !!row.zoho_smtp_pass,
    zoho_client_secret_configured: !!row.zoho_client_secret,
    zoho_refresh_token_configured: !!row.zoho_refresh_token,
    zoho_imap_pass_configured: !!row.zoho_imap_pass
  };
}

export function updateSettings(patch) {
  const current = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  const merged = { ...current, ...patch, updated_at: nowIso() };
  const keys = [
    "daily_send_limit",
    "time_window_start",
    "time_window_end",
    "sending_interval_sec",
    "default_timezone",
    "default_workdays_only",
    "all_day_dispatch",
    "track_links_enabled",
    "zoho_sender_email",
    "zoho_smtp_host",
    "zoho_smtp_port",
    "zoho_smtp_user",
    "zoho_smtp_pass",
    "zoho_auth_mode",
    "zoho_client_id",
    "zoho_client_secret",
    "zoho_refresh_token",
    "zoho_account_id",
    "zoho_domain",
    "zoho_imap_host",
    "zoho_imap_port",
    "zoho_imap_user",
    "zoho_imap_pass",
    "last_imap_check",
    "updated_at"
  ];
  const assignments = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => {
    const v = merged[k];
    if (typeof v === "boolean") return v ? 1 : 0;
    return v ?? current[k];
  });
  db.prepare(`UPDATE settings SET ${assignments} WHERE id = 1`).run(...values);
  return getSettings();
}

export function mapCampaign(row, extra = {}) {
  if (!row) return null;
  const counts = extra.counts || {};
  return {
    id: row.id,
    name: row.name,
    target_timezone: row.target_timezone,
    time_window_start: row.time_window_start,
    time_window_end: row.time_window_end,
    sending_interval_sec: row.sending_interval_sec,
    workdays_only: !!row.workdays_only,
    daily_new_limit: row.daily_new_limit || 0,
    daily_followup_limit: row.daily_followup_limit || 0,
    status: row.status,
    tags: parseJson(row.tags, []),
    followup1_enabled: !!row.followup1_enabled,
    followup1_delay_days: row.followup1_delay_days,
    followup1_time_window_start: row.followup1_time_window_start,
    followup1_time_window_end: row.followup1_time_window_end,
    followup1_default_subject: row.followup1_default_subject,
    followup1_default_body: row.followup1_default_body,
    followup2_enabled: !!row.followup2_enabled,
    followup2_delay_days: row.followup2_delay_days,
    followup2_time_window_start: row.followup2_time_window_start,
    followup2_time_window_end: row.followup2_time_window_end,
    followup2_default_subject: row.followup2_default_subject,
    followup2_default_body: row.followup2_default_body,
    last_sent_at: row.last_sent_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    recipient_count: counts.total || 0,
    pending_count: counts.pending || 0,
    sent_count: counts.sent || 0,
    failed_count: counts.failed || 0,
    replied_count: counts.replied || 0,
    bounced_count: counts.bounced || 0,
    clicked_count: counts.clicked || 0
  };
}

export function campaignCounts(campaignId) {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS c FROM recipients WHERE campaign_id = ? GROUP BY status")
    .all(campaignId);
  const counts = { total: 0, pending: 0, sent: 0, failed: 0, replied: 0, clicked: 0, unsubscribed: 0, bounced: 0 };
  for (const r of rows) {
    counts.total += r.c;
    if (counts[r.status] !== undefined) counts[r.status] += r.c;
  }
  const clicked = db.prepare("SELECT COUNT(*) AS c FROM recipients WHERE campaign_id = ? AND clicked_at IS NOT NULL").get(campaignId);
  counts.clicked = clicked.c;
  return counts;
}

export function mapRecipient(row) {
  return {
    ...row,
    custom_fields: parseJson(row.custom_fields, {})
  };
}

export function addLog({ type, status = "info", recipient_email = null, campaign_id = null, message = "" }) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO logs (id, type, status, recipient_email, campaign_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, type, status, recipient_email, campaign_id, message, nowIso());
  return id;
}

export function sentTodayCount() {
  const day = todayKey("UTC");
  const row = db.prepare("SELECT count FROM send_counters WHERE day = ?").get(day);
  return row ? row.count : 0;
}

export function incrementSentToday() {
  const day = todayKey("UTC");
  db.prepare(
    "INSERT INTO send_counters (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1"
  ).run(day);
}

export function getPacing(campaignId, day) {
  const row = db
    .prepare("SELECT * FROM campaign_pacing WHERE campaign_id = ? AND day = ?")
    .get(campaignId, day);
  return { campaign_id: campaignId, day, new_sent: row?.new_sent || 0, followup_sent: row?.followup_sent || 0 };
}

export function bumpPacing(campaignId, day, { newSent = 0, followupSent = 0 } = {}) {
  db.prepare(
    `INSERT INTO campaign_pacing (campaign_id, day, new_sent, followup_sent) VALUES (?, ?, ?, ?)
     ON CONFLICT(campaign_id, day) DO UPDATE SET
       new_sent = new_sent + excluded.new_sent,
       followup_sent = followup_sent + excluded.followup_sent`
  ).run(campaignId, day, newSent, followupSent);
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isSuppressed(email) {
  return !!db.prepare("SELECT email FROM unsubscribed WHERE lower(email) = lower(?)").get(normalizeEmail(email));
}

export function suppressEmail(email, reason = "") {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  db.prepare(
    "INSERT INTO unsubscribed (email, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET reason = excluded.reason"
  ).run(normalized, reason, nowIso());
  return true;
}

export function isInboundProcessed(key) {
  return !!db.prepare("SELECT key FROM inbound_processed WHERE key = ?").get(key);
}

export function markInboundProcessed(key) {
  db.prepare("INSERT OR IGNORE INTO inbound_processed (key, created_at) VALUES (?, ?)").run(key, nowIso());
}

export function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
