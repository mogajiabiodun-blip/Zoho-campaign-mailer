import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import {
  db,
  getSettings,
  updateSettings,
  mapCampaign,
  campaignCounts,
  mapRecipient,
  addLog,
  sentTodayCount,
  nowIso,
  parseJson,
  csvEscape
} from "./db.js";
import { TIME_ZONES, timezoneStatuses, evaluateWindow } from "./timezones.js";
import { testSmtp } from "./mailer.js";
import { dispatchOnce, startScheduler } from "./scheduler.js";
import { pollInbound } from "./inbound.js";
import { checkDomainDeliverability, normalizeDomain } from "./dnscheck.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: "8mb" }));

function ok(res, data) {
  return res.json({ success: true, data });
}
function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error: String(error) });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

app.get("/api/health", (_req, res) => ok(res, { ok: true }));

app.get("/api/stats", (_req, res) => {
  try {
    const settings = getSettings();
    const sentToday = sentTodayCount();
    const dailyCap = Number(settings.daily_send_limit) || 100;
    const totals = db
      .prepare(
        `SELECT
          COUNT(*) AS totalCampaigns,
          SUM(CASE WHEN status IN ('scheduled','sending','active') THEN 1 ELSE 0 END) AS activeCampaigns
         FROM campaigns`
      )
      .get();
    const rec = db
      .prepare(
        `SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
          SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
          SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed,
          SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS uniqueClicks
         FROM recipients`
      )
      .get();
    const clickRow = db.prepare("SELECT COUNT(*) AS c FROM clicks").get();
    const totalSent = rec.sent || 0;
    const totalReplied = rec.replied || 0;
    const uniqueClicks = rec.uniqueClicks || 0;
    ok(res, {
      sentToday,
      dailyCap,
      remainingDailyQuota: Math.max(0, dailyCap - sentToday),
      activeCampaigns: totals.activeCampaigns || 0,
      totalCampaigns: totals.totalCampaigns || 0,
      pendingQueueCount: rec.pending || 0,
      totalSent,
      totalReplied,
      totalFailed: rec.failed || 0,
      totalBounced: rec.bounced || 0,
      totalUnsubscribed: rec.unsubscribed || 0,
      replyRatePercent: totalSent ? Math.round((totalReplied / totalSent) * 1000) / 10 : 0,
      totalClicks: clickRow.c || 0,
      uniqueClicks,
      clickThroughRatePercent: totalSent ? Math.round((uniqueClicks / totalSent) * 1000) / 10 : 0,
      timeZoneStatuses: timezoneStatuses(settings),
      lastImapCheck: settings.last_imap_check
    });
  } catch (err) {
    fail(res, err.message, 500);
  }
});

app.get("/api/timezones", (_req, res) => {
  const settings = getSettings();
  const list = TIME_ZONES.filter((z) => z.code !== "LOCAL").map((z) => ({
    ...z,
    evaluation: evaluateWindow({
      timeZone: z.iana,
      windowStart: settings.time_window_start,
      windowEnd: settings.time_window_end,
      workdaysOnly: !!settings.default_workdays_only,
      allDay: !!settings.all_day_dispatch
    })
  }));
  ok(res, list);
});

app.get("/api/settings", (_req, res) => ok(res, getSettings()));

app.post("/api/settings", (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};
    const copyKeys = [
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
      "zoho_imap_pass"
    ];
    for (const k of copyKeys) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    if (patch.zoho_smtp_pass) patch.zoho_smtp_pass = String(patch.zoho_smtp_pass).replace(/\s+/g, "");
    if (patch.zoho_imap_pass) patch.zoho_imap_pass = String(patch.zoho_imap_pass).replace(/\s+/g, "");
    ok(res, updateSettings(patch));
  } catch (err) {
    fail(res, err.message, 500);
  }
});

app.get("/api/dns/check", async (req, res) => {
  try {
    const settings = getSettings();
    const requested = req.query.domain || settings.zoho_sender_email || "";
    const domain = normalizeDomain(requested);
    if (!domain) return fail(res, "No domain to check. Set a From email or pass ?domain=yourdomain.com");
    const selector = req.query.selector ? String(req.query.selector).trim().toLowerCase() : null;
    const result = await checkDomainDeliverability(domain, { selectors: selector ? [selector] : [] });
    if (result.error) return fail(res, result.error);
    ok(res, result);
  } catch (err) {
    fail(res, err.message, 500);
  }
});

function hydrateCampaign(row) {
  return mapCampaign(row, { counts: campaignCounts(row.id) });
}

app.get("/api/campaigns", (_req, res) => {
  const rows = db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all();
  ok(res, rows.map(hydrateCampaign));
});

app.get("/api/campaigns/export/csv", (_req, res) => {
  const rows = db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all();
  const header = ["ID", "Name", "Status", "Timezone", "Window Start", "Window End", "Interval Sec", "Recipients", "Sent", "Failed", "Replied", "Created"];
  const lines = [header.join(",")];
  for (const row of rows) {
    const c = hydrateCampaign(row);
    lines.push(
      [
        c.id,
        c.name,
        c.status,
        c.target_timezone,
        c.time_window_start,
        c.time_window_end,
        c.sending_interval_sec,
        c.recipient_count,
        c.sent_count,
        c.failed_count,
        c.replied_count,
        c.created_at
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=campaigns.csv");
  res.send("\uFEFF" + lines.join("\r\n"));
});

app.get("/api/campaigns/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!row) return fail(res, "Campaign not found", 404);
  ok(res, hydrateCampaign(row));
});

app.post("/api/campaigns", (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return fail(res, "Campaign name is required.");
    const id = randomUUID();
    const now = nowIso();
    db.prepare(
      `INSERT INTO campaigns (
        id, name, target_timezone, time_window_start, time_window_end, sending_interval_sec,
        workdays_only, daily_new_limit, daily_followup_limit, status, tags,
        followup1_enabled, followup1_delay_days, followup1_time_window_start, followup1_time_window_end,
        followup1_default_subject, followup1_default_body,
        followup2_enabled, followup2_delay_days, followup2_time_window_start, followup2_time_window_end,
        followup2_default_subject, followup2_default_body, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      String(b.name).trim(),
      b.target_timezone || "America/New_York",
      b.time_window_start || "08:00",
      b.time_window_end || "10:00",
      Number(b.sending_interval_sec) || 10,
      b.workdays_only === false ? 0 : 1,
      Number(b.daily_new_limit) || 0,
      Number(b.daily_followup_limit) || 0,
      b.status || "scheduled",
      JSON.stringify(b.tags || []),
      b.followup1_enabled ? 1 : 0,
      Number(b.followup1_delay_days) || 3,
      b.followup1_time_window_start || "08:00",
      b.followup1_time_window_end || "10:00",
      b.followup1_default_subject || "",
      b.followup1_default_body || "",
      b.followup2_enabled ? 1 : 0,
      Number(b.followup2_delay_days) || 4,
      b.followup2_time_window_start || "08:00",
      b.followup2_time_window_end || "10:00",
      b.followup2_default_subject || "",
      b.followup2_default_body || "",
      now,
      now
    );

    const recipients = Array.isArray(b.recipients) ? b.recipients : [];
    const insert = db.prepare(
      `INSERT INTO recipients (id, campaign_id, email, subject, body, custom_fields, status,
        followup1_subject, followup1_body, followup2_subject, followup2_body, row_index, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    let imported = 0;
    for (const r of recipients) {
      const email = String(r.email || "").trim();
      if (!EMAIL_RE.test(email)) continue;
      insert.run(
        randomUUID(),
        id,
        email,
        r.subject || "",
        r.body || "",
        JSON.stringify(r.custom_fields || {}),
        "pending",
        r.followup1_subject || "",
        r.followup1_body || "",
        r.followup2_subject || "",
        r.followup2_body || "",
        imported,
        now
      );
      imported += 1;
    }
    addLog({ type: "campaign", status: "created", campaign_id: id, message: `Created campaign with ${imported} recipients.` });
    const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
    ok(res, { ...hydrateCampaign(row), imported_count: imported });
  } catch (err) {
    fail(res, err.message, 500);
  }
});

app.patch("/api/campaigns/:id/status", (req, res) => {
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!row) return fail(res, "Campaign not found", 404);
  const status = String(req.body?.status || "").trim();
  if (!status) return fail(res, "Status is required.");
  db.prepare("UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), req.params.id);
  ok(res, hydrateCampaign(db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id)));
});

app.patch("/api/campaigns/:id/interval", (req, res) => {
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!row) return fail(res, "Campaign not found", 404);
  const sec = Number(req.body?.sending_interval_sec);
  if (!sec || sec < 1) return fail(res, "Interval must be at least 1 second.");
  db.prepare("UPDATE campaigns SET sending_interval_sec = ?, updated_at = ? WHERE id = ?").run(sec, nowIso(), req.params.id);
  ok(res, hydrateCampaign(db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id)));
});

app.patch("/api/campaigns/:id/schedule", (req, res) => {
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!row) return fail(res, "Campaign not found", 404);
  const b = req.body || {};
  const patch = {
    target_timezone: b.target_timezone ?? row.target_timezone,
    time_window_start: b.time_window_start ?? row.time_window_start,
    time_window_end: b.time_window_end ?? row.time_window_end,
    workdays_only: b.workdays_only === undefined ? row.workdays_only : b.workdays_only ? 1 : 0,
    sending_interval_sec: b.sending_interval_sec ?? row.sending_interval_sec,
    status: b.status ?? row.status
  };
  db.prepare(
    `UPDATE campaigns SET target_timezone=?, time_window_start=?, time_window_end=?, workdays_only=?, sending_interval_sec=?, status=?, updated_at=? WHERE id=?`
  ).run(
    patch.target_timezone,
    patch.time_window_start,
    patch.time_window_end,
    patch.workdays_only,
    patch.sending_interval_sec,
    patch.status,
    nowIso(),
    req.params.id
  );
  ok(res, hydrateCampaign(db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id)));
});

app.patch("/api/campaigns/:id/tags", (req, res) => {
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!row) return fail(res, "Campaign not found", 404);
  db.prepare("UPDATE campaigns SET tags = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(req.body?.tags || []),
    nowIso(),
    req.params.id
  );
  ok(res, hydrateCampaign(db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id)));
});

app.delete("/api/campaigns/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!row) return fail(res, "Campaign not found", 404);
  db.prepare("DELETE FROM recipients WHERE campaign_id = ?").run(req.params.id);
  db.prepare("DELETE FROM campaigns WHERE id = ?").run(req.params.id);
  ok(res, { deleted: true });
});

app.post("/api/campaigns/:id/followups", (req, res) => {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!campaign) return fail(res, "Campaign not found", 404);
  const stage = Number(req.body?.stage);
  if (stage !== 1 && stage !== 2) return fail(res, "stage must be 1 or 2.");
  const list = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  const delayDays = req.body?.delay_days === undefined ? 0 : Number(req.body.delay_days);
  const now = nowIso();
  const winStart = req.body?.time_window_start || campaign.time_window_start || "08:00";
  const winEnd = req.body?.time_window_end || campaign.time_window_end || "10:00";
  const interval = req.body?.sending_interval_sec ?? campaign.sending_interval_sec;
  if (stage === 1) {
    db.prepare(
      "UPDATE campaigns SET followup1_enabled = 1, followup1_delay_days = ?, followup1_time_window_start = ?, followup1_time_window_end = ?, sending_interval_sec = ?, updated_at = ? WHERE id = ?"
    ).run(Number.isFinite(delayDays) ? delayDays : 0, winStart, winEnd, interval, now, campaign.id);
  } else {
    db.prepare(
      "UPDATE campaigns SET followup2_enabled = 1, followup2_delay_days = ?, followup2_time_window_start = ?, followup2_time_window_end = ?, sending_interval_sec = ?, updated_at = ? WHERE id = ?"
    ).run(Number.isFinite(delayDays) ? delayDays : 0, winStart, winEnd, interval, now, campaign.id);
  }
  let matched = 0;
  let missing = 0;
  const findRec = db.prepare("SELECT * FROM recipients WHERE campaign_id = ? AND lower(email) = lower(?)");
  for (const r of list) {
    const email = String(r.email || "").trim();
    if (!EMAIL_RE.test(email)) continue;
    const rec = findRec.get(campaign.id, email);
    if (!rec) {
      missing += 1;
      continue;
    }
    const fields = { ...(parseJson(rec.custom_fields, {})), ...(r.custom_fields || {}) };
    if (r.businessName) {
      fields["Business Name"] = r.businessName;
      fields.Company = r.businessName;
    }
    if (stage === 1) {
      db.prepare(
        "UPDATE recipients SET followup1_subject = ?, followup1_body = ?, followup1_status = 'pending', custom_fields = ? WHERE id = ?"
      ).run(r.subject || rec.followup1_subject || "", r.body || "", JSON.stringify(fields), rec.id);
    } else {
      db.prepare(
        "UPDATE recipients SET followup2_subject = ?, followup2_body = ?, followup2_status = 'pending', custom_fields = ? WHERE id = ?"
      ).run(r.subject || rec.followup2_subject || "", r.body || "", JSON.stringify(fields), rec.id);
    }
    matched += 1;
  }
  if (campaign.status === "completed" || campaign.status === "paused" || campaign.status === "draft") {
    db.prepare("UPDATE campaigns SET status = 'scheduled', updated_at = ? WHERE id = ?").run(now, campaign.id);
  }
  addLog({
    type: "followup",
    status: "imported",
    campaign_id: campaign.id,
    message: `Follow-up ${stage} sheet imported. Matched ${matched} emails${missing ? `, ${missing} not in campaign` : ""}.`
  });
  ok(res, { matched, missing, stage });
});

app.post("/api/campaigns/:id/recipients", (req, res) => {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!campaign) return fail(res, "Campaign not found", 404);
  const list = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  const maxRow = db.prepare("SELECT IFNULL(MAX(row_index), -1) AS m FROM recipients WHERE campaign_id = ?").get(campaign.id);
  let nextIndex = (maxRow?.m ?? -1) + 1;
  const insert = db.prepare(
    `INSERT INTO recipients (id, campaign_id, email, subject, body, custom_fields, status, row_index, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  let imported = 0;
  const now = nowIso();
  for (const r of list) {
    const email = String(r.email || "").trim();
    if (!EMAIL_RE.test(email)) continue;
    insert.run(
      randomUUID(),
      campaign.id,
      email,
      r.subject || "",
      r.body || "",
      JSON.stringify(r.custom_fields || {}),
      "pending",
      nextIndex,
      now
    );
    nextIndex += 1;
    imported += 1;
  }
  if (campaign.status === "completed" && imported > 0) {
    db.prepare("UPDATE campaigns SET status = 'scheduled', updated_at = ? WHERE id = ?").run(now, campaign.id);
  }
  ok(res, { imported_count: imported });
});

app.delete("/api/campaigns/:id/recipients", (req, res) => {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!campaign) return fail(res, "Campaign not found", 404);
  const status = req.query.status;
  if (status && status !== "all") {
    db.prepare("DELETE FROM recipients WHERE campaign_id = ? AND status = ?").run(req.params.id, status);
  } else {
    db.prepare("DELETE FROM recipients WHERE campaign_id = ?").run(req.params.id);
  }
  ok(res, { deleted: true });
});

app.get("/api/recipients", (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.status) {
    clauses.push("status = ?");
    params.push(req.query.status);
  }
  if (req.query.campaign_id) {
    clauses.push("campaign_id = ?");
    params.push(req.query.campaign_id);
  }
  if (req.query.search) {
    clauses.push("(email LIKE ? OR subject LIKE ?)");
    params.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  const rows = db
    .prepare(`SELECT * FROM recipients ${where} ORDER BY created_at DESC LIMIT ${limit}`)
    .all(...params);
  ok(res, rows.map(mapRecipient));
});

app.delete("/api/recipients/:id", (req, res) => {
  db.prepare("DELETE FROM recipients WHERE id = ?").run(req.params.id);
  ok(res, { deleted: true });
});

app.post("/api/recipients/bulk-delete", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const stmt = db.prepare("DELETE FROM recipients WHERE id = ?");
  for (const id of ids) stmt.run(id);
  ok(res, { deleted: ids.length });
});

app.post("/api/recipients/unsubscribe", (req, res) => {
  const emails = Array.isArray(req.body?.emails) ? req.body.emails : [];
  const reason = req.body?.reason || "";
  const stmt = db.prepare(
    "INSERT INTO unsubscribed (email, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET reason = excluded.reason"
  );
  let count = 0;
  for (const raw of emails) {
    const email = String(raw || "").trim();
    if (!EMAIL_RE.test(email)) continue;
    stmt.run(normalizeEmail(email), reason, nowIso());
    db.prepare("UPDATE recipients SET status = 'unsubscribed' WHERE lower(email) = ? AND status = 'pending'").run(
      normalizeEmail(email)
    );
    count += 1;
  }
  ok(res, { added: count });
});

app.get("/api/recipients/unsubscribed", (_req, res) => {
  ok(res, db.prepare("SELECT * FROM unsubscribed ORDER BY created_at DESC").all());
});

app.delete("/api/recipients/unsubscribe/:email", (req, res) => {
  db.prepare("DELETE FROM unsubscribed WHERE lower(email) = lower(?)").run(decodeURIComponent(req.params.email));
  ok(res, { deleted: true });
});

app.post("/api/database/clear-prospects", (_req, res) => {
  db.exec("DELETE FROM recipients; DELETE FROM campaigns; DELETE FROM logs; DELETE FROM clicks; DELETE FROM send_counters;");
  ok(res, { cleared: true });
});

app.get("/api/logs", (req, res) => {
  const limitAll = req.query.limit === "all";
  const limit = limitAll ? 5000 : Math.min(Number(req.query.limit) || 200, 2000);
  const rows = db.prepare("SELECT * FROM logs ORDER BY created_at DESC LIMIT ?").all(limit);
  ok(res, rows);
});

app.get("/api/logs/export/csv", (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.type) {
    clauses.push("type = ?");
    params.push(req.query.type);
  }
  if (req.query.campaign_id) {
    clauses.push("campaign_id = ?");
    params.push(req.query.campaign_id);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM logs ${where} ORDER BY created_at DESC`).all(...params);
  const header = ["Event ID", "Timestamp", "Type", "Status", "Recipient", "Campaign ID", "Message"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([r.id, r.created_at, r.type, r.status, r.recipient_email, r.campaign_id, r.message].map(csvEscape).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=logs.csv");
  res.send("\uFEFF" + lines.join("\r\n"));
});

app.delete("/api/logs/:id", (req, res) => {
  db.prepare("DELETE FROM logs WHERE id = ?").run(req.params.id);
  ok(res, { deleted: true });
});

app.post("/api/logs/bulk-delete", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const stmt = db.prepare("DELETE FROM logs WHERE id = ?");
  for (const id of ids) stmt.run(id);
  ok(res, { deleted: ids.length });
});

app.delete("/api/logs", (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.type) {
    clauses.push("type = ?");
    params.push(req.query.type);
  }
  if (req.query.campaign_id) {
    clauses.push("campaign_id = ?");
    params.push(req.query.campaign_id);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  db.prepare(`DELETE FROM logs ${where}`).run(...params);
  ok(res, { deleted: true });
});

app.post("/api/scheduler/trigger", async (req, res) => {
  try {
    const forceWindow = !!req.body?.forceWindow;
    const campaignId = req.body?.campaignId || null;
    const result = await dispatchOnce({ forceWindow, campaignId });
    ok(res, result);
  } catch (err) {
    fail(res, err.message, 500);
  }
});

app.post("/api/zoho/test", async (req, res) => {
  try {
    const result = await testSmtp(req.body || {});
    ok(res, result);
  } catch (err) {
    fail(res, err.message, 400);
  }
});

app.post("/api/zoho/test-imap", async (req, res) => {
  const settings = { ...getSettings(), ...(req.body || {}) };
  const user = settings.zoho_imap_user || settings.zoho_sender_email;
  const pass = (settings.zoho_imap_pass || settings.zoho_smtp_pass || "").replace(/\s+/g, "");
  if (!user || !pass) return fail(res, "IMAP user and password are required.");
  const client = new ImapFlow({
    host: settings.zoho_imap_host || "imappro.zoho.com",
    port: Number(settings.zoho_imap_port) || 993,
    secure: true,
    auth: { user, pass },
    logger: false
  });
  try {
    await client.connect();
    await client.logout();
    ok(res, { ok: true, host: settings.zoho_imap_host, user });
  } catch (err) {
    fail(res, err.message, 400);
  }
});

app.get("/api/zoho/oauth/url", (req, res) => {
  const clientId = req.query.clientId || getSettings().zoho_client_id;
  const domain = req.query.domain || getSettings().zoho_domain || "zoho.com";
  const redirectUri = req.query.redirectUri || `${req.protocol}://${req.get("host")}/api/zoho/oauth/callback`;
  if (!clientId) return fail(res, "Zoho client ID is required.");
  const url = `https://accounts.${domain}/oauth/v2/auth?scope=ZohoMail.messages.ALL,ZohoMail.accounts.READ&client_id=${encodeURIComponent(clientId)}&response_type=code&access_type=offline&redirect_uri=${encodeURIComponent(redirectUri)}`;
  ok(res, { url, redirectUri });
});

app.post("/api/zoho/oauth/exchange", async (req, res) => {
  try {
    const { code, clientId, clientSecret, domain, redirectUri } = req.body || {};
    const settings = getSettings();
    const d = domain || settings.zoho_domain || "zoho.com";
    const cid = clientId || settings.zoho_client_id;
    const secret = clientSecret || settings.zoho_client_secret;
    if (!code || !cid || !secret) return fail(res, "code, clientId and clientSecret are required.");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cid,
      client_secret: secret,
      redirect_uri: redirectUri || "",
      code
    });
    const resp = await fetch(`https://accounts.${d}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const json = await resp.json();
    if (!resp.ok || json.error) return fail(res, json.error || "OAuth exchange failed");
    if (json.refresh_token) updateSettings({ zoho_refresh_token: json.refresh_token });
    ok(res, json);
  } catch (err) {
    fail(res, err.message, 500);
  }
});

app.post("/api/zoho/oauth/set-token", (req, res) => {
  const token = req.body?.refreshToken;
  if (!token) return fail(res, "refreshToken is required.");
  ok(res, updateSettings({ zoho_refresh_token: token }));
});

app.post("/api/imap/poll", async (_req, res) => {
  try {
    const summary = await pollInbound();
    ok(res, summary);
  } catch (err) {
    fail(res, err.message, 400);
  }
});

app.post("/api/imap/simulate-reply", (req, res) => {
  const recipientId = req.body?.recipientId;
  const snippet = req.body?.snippet || "Thanks for following up!";
  const rec = db.prepare("SELECT * FROM recipients WHERE id = ?").get(recipientId);
  if (!rec) return fail(res, "Recipient not found", 404);
  db.prepare("UPDATE recipients SET status = 'replied', replied_at = ? WHERE id = ?").run(nowIso(), rec.id);
  db.prepare("UPDATE recipients SET followup1_status = 'cancelled' WHERE id = ? AND followup1_status = 'pending'").run(rec.id);
  db.prepare("UPDATE recipients SET followup2_status = 'cancelled' WHERE id = ? AND followup2_status = 'pending'").run(rec.id);
  addLog({
    type: "reply",
    status: "replied",
    recipient_email: rec.email,
    campaign_id: rec.campaign_id,
    message: snippet
  });
  ok(res, { ok: true });
});

app.get("/api/analytics/reply-heatmap", (req, res) => {
  const campaignId = req.query.campaign_id;
  const params = [];
  let where = "WHERE status = 'replied' AND replied_at IS NOT NULL";
  if (campaignId) {
    where += " AND campaign_id = ?";
    params.push(campaignId);
  }
  const rows = db.prepare(`SELECT replied_at FROM recipients ${where}`).all(...params);
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of rows) {
    const d = new Date(r.replied_at);
    grid[d.getUTCDay()][d.getUTCHours()] += 1;
  }
  ok(res, { grid, total: rows.length });
});

app.get("/api/analytics/clicks", (req, res) => {
  const campaignId = req.query.campaign_id;
  const params = [];
  let where = "";
  if (campaignId) {
    where = "WHERE campaign_id = ?";
    params.push(campaignId);
  }
  const rows = db.prepare(`SELECT url, COUNT(*) AS c FROM clicks ${where} GROUP BY url ORDER BY c DESC LIMIT 50`).all(...params);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM clicks ${where}`).get(...params);
  ok(res, { urls: rows, total: total.c });
});

app.post("/api/track/simulate-click", (req, res) => {
  const recipientId = req.body?.recipientId;
  const rec = recipientId ? db.prepare("SELECT * FROM recipients WHERE id = ?").get(recipientId) : null;
  db.prepare("INSERT INTO clicks (id, campaign_id, recipient_id, url, created_at) VALUES (?,?,?,?,?)").run(
    randomUUID(),
    rec?.campaign_id || req.body?.campaignId || null,
    rec?.id || null,
    req.body?.url || "https://example.com",
    nowIso()
  );
  if (rec) db.prepare("UPDATE recipients SET clicked_at = ? WHERE id = ?").run(nowIso(), rec.id);
  ok(res, { ok: true });
});

app.get("/api/track/click", (req, res) => {
  const rid = req.query.rid;
  const url = req.query.u || "https://example.com";
  const rec = rid ? db.prepare("SELECT * FROM recipients WHERE id = ?").get(rid) : null;
  db.prepare("INSERT INTO clicks (id, campaign_id, recipient_id, url, created_at) VALUES (?,?,?,?,?)").run(
    randomUUID(),
    rec?.campaign_id || req.query.cid || null,
    rec?.id || null,
    url,
    nowIso()
  );
  if (rec) db.prepare("UPDATE recipients SET clicked_at = ? WHERE id = ?").run(nowIso(), rec.id);
  res.redirect(url);
});

app.get("/api/track/open", (req, res) => {
  const rid = req.query.rid;
  if (rid) {
    const rec = db.prepare("SELECT * FROM recipients WHERE id = ?").get(rid);
    if (rec && !rec.clicked_at) {
      addLog({ type: "open", status: "opened", recipient_email: rec.email, campaign_id: rec.campaign_id, message: "Open pixel fired." });
    }
  }
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  res.setHeader("Content-Type", "image/gif");
  res.send(gif);
});

app.post("/api/chat", async (req, res) => {
  const { message, history = [], role = "general", model = "template", grounding = "none" } = req.body || {};
  if (!message) return fail(res, "message is required.");
  const apiKey = process.env.USER_LLM_API_KEY;
  const baseUrl = process.env.USER_LLM_BASE_URL;
  const modelName = process.env.USER_LLM_MODEL || model;
  const system = `You are the Zoho Campaign Mailer assistant. Role: ${role}. Help with outbound email campaigns, Zoho SMTP/IMAP, US timezone dispatch windows (8-10 AM local), deliverability, and copywriting. Grounding mode: ${grounding}. Do not invent that you scraped the web unless grounding is search/maps. Keep answers practical.`;

  if (apiKey && baseUrl) {
    try {
      const messages = [{ role: "system", content: system }];
      for (const h of history.slice(-12)) {
        messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.content });
      }
      messages.push({ role: "user", content: message });
      const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelName, messages, temperature: 0.5 })
      });
      const json = await resp.json();
      const text = json.choices?.[0]?.message?.content;
      if (text) {
        return ok(res, { text, modelUsed: modelName, groundingUsed: grounding, webLinks: [], mapsPlaces: [], searchQueries: [] });
      }
    } catch {
      // fall through to local reply
    }
  }

  const templates = {
    maps_prospector: `I can help you structure a Maps prospecting export, but this clone does not auto-scrape Google Maps.\n\n**How to use it for outreach**\n1. Export a CSV of businesses you already researched (columns: Email, Company, Address, google_maps_url).\n2. Import that file on the **New Campaign** tab.\n3. Use merge tags like \`{{Company}}\` and \`{{Address}}\` in the body.\n\nYour prompt: "${message}"\n\nSuggested columns: Email, Company, Address, google_maps_url, review_hook.`,
    search_researcher: `Search grounding is optional in this clone. Configure USER_LLM_API_KEY to enable live model replies.\n\nFor "${message}", research checklist:\n- Recent news / funding\n- Decision-maker titles\n- Pain points you can mention in line 1 of the email\n- A specific proof point (review count, product launch, hiring)`,
    copywriter: `**Subject:** Quick idea for {{Company}}\n\nHi {{First_Name}},\n\nNoticed {{Company}} and thought a short note was worth sending.\n\nMost teams I talk to waste time chasing replies that never land because they send outside local hours. This mailer dispatches in the recipient's 8:00–10:00 AM window via Zoho SMTP.\n\nOpen to a 12-minute look this week?\n\n— {{Sender_Name}}`,
    deliverability_advisor: `**Zoho deliverability checklist**\n- SPF: include \`zoho.com\` / \`zoho.eu\` as published in Zoho Admin.\n- DKIM: enable in Zoho Mail Control Panel and publish the TXT record.\n- DMARC: start with \`p=none\` then move to quarantine.\n- Send 8:00–10:00 AM recipient local time, weekdays only.\n- Warm up: 20/day week 1, 40 week 2, 80 week 3, then your daily cap.\n- Interval: 10–30 seconds between messages.\n- Use a Zoho **app password**, not the mailbox login password.`,
    general: `Zoho Campaign Mailer clone is ready.\n\n1. Open **Settings** and save Zoho SMTP (smtppro.zoho.com:465) + app password.\n2. Click **Test SMTP**.\n3. Create a campaign, upload CSV, map Email / Subject / Body.\n4. Keep the 8–10 AM local window unless you choose Anytime.\n5. Use **Dispatch now** only after SMTP verifies.\n\nYour question: "${message}"`
  };
  const text = templates[role] || templates.general;
  ok(res, { text, modelUsed: "local-advisor", groundingUsed: "none", webLinks: [], mapsPlaces: [], searchQueries: [] });
});

app.get("/unsubscribe", (req, res) => {
  const email = String(req.query.email || "").trim();
  if (EMAIL_RE.test(email)) {
    db.prepare(
      "INSERT INTO unsubscribed (email, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING"
    ).run(normalizeEmail(email), "one-click unsubscribe", nowIso());
  }
  res.type("html").send(`<!doctype html><html><body style="font-family:sans-serif;padding:40px"><h2>You have been unsubscribed.</h2><p>${email || ""} will no longer receive outreach from this mailer.</p></body></html>`);
});

app.use((err, _req, res, _next) => {
  fail(res, err.message || "Server error", 500);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Zoho Campaign Mailer backend on ${PORT}`);
  startScheduler();

  const pollMinutes = Number(process.env.IMAP_POLL_MINUTES) || 15;
  const runImapPoll = async () => {
    try {
      const settings = getSettings();
      if (!settings.zoho_imap_pass && !settings.zoho_smtp_pass) return;
      const result = await pollInbound();
      if (result.replies || result.bounces || result.suppressed) {
        addLog({
          type: "imap",
          status: "poll",
          message: `Inbound poll: ${result.replies} replies, ${result.bounces} bounces, ${result.suppressed} suppressed, ${result.cancelledFollowups} follow-ups stopped.`
        });
      }
    } catch (err) {
      addLog({ type: "imap", status: "error", message: String(err.message || err) });
    }
  };
  setInterval(runImapPoll, pollMinutes * 60 * 1000);
  setTimeout(runImapPoll, 60 * 1000);
});
