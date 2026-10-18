import {
  db,
  getSettings,
  addLog,
  incrementSentToday,
  sentTodayCount,
  nowIso,
  parseJson,
  campaignCounts,
  todayKey,
  getPacing,
  bumpPacing
} from "./db.js";
import { evaluateWindow } from "./timezones.js";
import { sendMail, interpolate } from "./mailer.js";

let running = false;
let lastRun = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function dateKeyInZone(date, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function elapsedDays(fromIso, { workdaysOnly = false, timeZone = "UTC" } = {}) {
  if (!fromIso) return 0;
  const fromKey = dateKeyInZone(new Date(fromIso), timeZone);
  const toKey = dateKeyInZone(new Date(), timeZone);
  let cursor = new Date(`${fromKey}T00:00:00Z`);
  const end = new Date(`${toKey}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return 0;
  let count = 0;
  cursor = new Date(cursor.getTime() + 86400000);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (!workdaysOnly || (dow !== 0 && dow !== 6)) count += 1;
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return count;
}

export async function dispatchOnce({ forceWindow = false, campaignId = null } = {}) {
  if (running) return lastRun || { dispatchedThisRun: 0, skipped: "already_running" };
  running = true;
  const summary = { dispatchedThisRun: 0, failedThisRun: 0, skipped: [], followups: 0 };
  try {
    const settings = getSettings();
    const dailyCap = Number(settings.daily_send_limit) || 100;
    let remaining = Math.max(0, dailyCap - sentTodayCount());
    if (remaining <= 0) {
      summary.skipped.push("Daily send cap reached.");
      lastRun = summary;
      return summary;
    }

    let campaigns;
    if (campaignId) {
      campaigns = db.prepare("SELECT * FROM campaigns WHERE id = ?").all(campaignId);
    } else {
      campaigns = db.prepare("SELECT * FROM campaigns WHERE status IN ('scheduled', 'sending', 'active')").all();
    }

    for (const campaign of campaigns) {
      if (remaining <= 0) break;
      if (campaign.status === "draft") continue;
      const explicitSend = !!campaignId && forceWindow;
      if (campaign.status === "completed" && !explicitSend) continue;
      if (campaign.status === "paused" && !explicitSend) continue;

      const evalResult = evaluateWindow({
        timeZone: campaign.target_timezone,
        windowStart: campaign.time_window_start,
        windowEnd: campaign.time_window_end,
        workdaysOnly: !!campaign.workdays_only,
        allDay: false
      });
      if (!forceWindow && !evalResult.canDispatch) {
        summary.skipped.push(`${campaign.name}: ${evalResult.reasons[0] || "Outside window"}`);
        continue;
      }

      db.prepare("UPDATE campaigns SET status = 'sending', updated_at = ? WHERE id = ?").run(nowIso(), campaign.id);

      const dayKey = todayKey(campaign.target_timezone || "UTC");
      const pacing = getPacing(campaign.id, dayKey);
      const newLimit = Number(campaign.daily_new_limit) || 0;
      let newAllowance = newLimit > 0 ? Math.max(0, newLimit - pacing.new_sent) : remaining;
      newAllowance = Math.min(newAllowance, remaining);

      const pending = db
        .prepare("SELECT * FROM recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY row_index ASC, created_at ASC")
        .all(campaign.id);

      const intervalMs = Math.max(1, Number(campaign.sending_interval_sec) || 10) * 1000;

      let sentNew = 0;
      for (const recipient of pending) {
        if (remaining <= 0 || sentNew >= newAllowance) break;
        const unsub = db.prepare("SELECT email FROM unsubscribed WHERE lower(email) = lower(?)").get(recipient.email);
        if (unsub) {
          db.prepare("UPDATE recipients SET status = 'unsubscribed' WHERE id = ?").run(recipient.id);
          addLog({
            type: "send",
            status: "skipped",
            recipient_email: recipient.email,
            campaign_id: campaign.id,
            message: "Recipient is on the suppression list."
          });
          continue;
        }

        const fields = parseJson(recipient.custom_fields, {});
        const subject = interpolate(recipient.subject, fields);
        const body = interpolate(recipient.body, fields);
        try {
          const info = await sendMail({
            to: recipient.email,
            subject: subject || "Outreach",
            body,
            recipientId: recipient.id,
            campaignId: campaign.id
          });
          const rejected = (info?.rejected || []).map(String).filter(Boolean);
          if (rejected.length) {
            throw new Error(`Zoho rejected recipient(s): ${rejected.join(", ")}`);
          }
          db.prepare("UPDATE recipients SET status = 'sent', sent_at = ?, error_message = NULL WHERE id = ?").run(
            nowIso(),
            recipient.id
          );
          incrementSentToday();
          remaining -= 1;
          sentNew += 1;
          bumpPacing(campaign.id, dayKey, { newSent: 1 });
          summary.dispatchedThisRun += 1;
          db.prepare("UPDATE campaigns SET last_sent_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), campaign.id);
          addLog({
            type: "send",
            status: "sent",
            recipient_email: recipient.email,
            campaign_id: campaign.id,
            message: `Accepted by Zoho SMTP (${info?.response || "250 OK"}). Subject: ${subject}`
          });
        } catch (err) {
          db.prepare("UPDATE recipients SET status = 'failed', error_message = ? WHERE id = ?").run(String(err.message || err), recipient.id);
          summary.failedThisRun += 1;
          addLog({
            type: "send",
            status: "failed",
            recipient_email: recipient.email,
            campaign_id: campaign.id,
            message: String(err.message || err)
          });
        }
        if (remaining > 0 && sentNew < newAllowance && pending.length > 1) await sleep(intervalMs);
      }

      if (campaign.followup1_enabled) {
        const followupEval = evaluateWindow({
          timeZone: campaign.target_timezone,
          windowStart: campaign.followup1_time_window_start || campaign.time_window_start,
          windowEnd: campaign.followup1_time_window_end || campaign.time_window_end,
          workdaysOnly: !!campaign.workdays_only
        });
        if (forceWindow || followupEval.canDispatch) {
          const due = db
            .prepare(
              "SELECT * FROM recipients WHERE campaign_id = ? AND status = 'sent' AND followup1_status = 'pending' AND sent_at IS NOT NULL AND IFNULL(followup1_body, '') != '' ORDER BY row_index ASC, created_at ASC"
            )
            .all(campaign.id);
          const fu1Delay = Number(campaign.followup1_delay_days);
          for (const recipient of due) {
            if (remaining <= 0) break;
            const fu1Elapsed = elapsedDays(recipient.sent_at, {
              workdaysOnly: !!campaign.workdays_only,
              timeZone: campaign.target_timezone
            });
            if (fu1Elapsed < (Number.isFinite(fu1Delay) ? fu1Delay : 0)) continue;
            const unsub = db.prepare("SELECT email FROM unsubscribed WHERE lower(email) = lower(?)").get(recipient.email);
            if (unsub) continue;
            const fields = parseJson(recipient.custom_fields, {});
            const subject = interpolate(recipient.followup1_subject || campaign.followup1_default_subject, fields);
            const body = interpolate(recipient.followup1_body || campaign.followup1_default_body, fields);
            if (!subject && !body) continue;
            try {
              await sendMail({
                to: recipient.email,
                subject: subject || "Following up",
                body,
                recipientId: recipient.id,
                campaignId: campaign.id
              });
              db.prepare("UPDATE recipients SET followup1_status = 'sent', followup1_sent_at = ? WHERE id = ?").run(nowIso(), recipient.id);
              incrementSentToday();
              remaining -= 1;
              bumpPacing(campaign.id, dayKey, { followupSent: 1 });
              summary.followups += 1;
              summary.dispatchedThisRun += 1;
              addLog({
                type: "followup",
                status: "sent",
                recipient_email: recipient.email,
                campaign_id: campaign.id,
                message: "Follow-up 1 delivered."
              });
            } catch (err) {
              db.prepare("UPDATE recipients SET followup1_status = 'failed' WHERE id = ?").run(recipient.id);
              addLog({
                type: "followup",
                status: "failed",
                recipient_email: recipient.email,
                campaign_id: campaign.id,
                message: String(err.message || err)
              });
            }
            await sleep(Math.max(1, Number(campaign.sending_interval_sec) || 10) * 1000);
          }
        }
      }

      if (campaign.followup2_enabled) {
        const followupEval = evaluateWindow({
          timeZone: campaign.target_timezone,
          windowStart: campaign.followup2_time_window_start || campaign.time_window_start,
          windowEnd: campaign.followup2_time_window_end || campaign.time_window_end,
          workdaysOnly: !!campaign.workdays_only
        });
        if (forceWindow || followupEval.canDispatch) {
          const due = db
            .prepare(
              "SELECT * FROM recipients WHERE campaign_id = ? AND status = 'sent' AND followup1_status = 'sent' AND followup2_status = 'pending' AND IFNULL(followup2_body, '') != '' ORDER BY row_index ASC, created_at ASC"
            )
            .all(campaign.id);
          const fu2Delay = Number(campaign.followup2_delay_days);
          for (const recipient of due) {
            if (remaining <= 0) break;
            const from = recipient.followup1_sent_at || recipient.sent_at;
            const fu2Elapsed = elapsedDays(from, {
              workdaysOnly: !!campaign.workdays_only,
              timeZone: campaign.target_timezone
            });
            if (fu2Elapsed < (Number.isFinite(fu2Delay) ? fu2Delay : 0)) continue;
            const unsub = db.prepare("SELECT email FROM unsubscribed WHERE lower(email) = lower(?)").get(recipient.email);
            if (unsub) continue;
            const fields = parseJson(recipient.custom_fields, {});
            const subject = interpolate(recipient.followup2_subject || campaign.followup2_default_subject, fields);
            const body = interpolate(recipient.followup2_body || campaign.followup2_default_body, fields);
            if (!subject && !body) continue;
            try {
              await sendMail({
                to: recipient.email,
                subject: subject || "Checking in",
                body,
                recipientId: recipient.id,
                campaignId: campaign.id
              });
              db.prepare("UPDATE recipients SET followup2_status = 'sent', followup2_sent_at = ? WHERE id = ?").run(nowIso(), recipient.id);
              incrementSentToday();
              remaining -= 1;
              bumpPacing(campaign.id, dayKey, { followupSent: 1 });
              summary.followups += 1;
              summary.dispatchedThisRun += 1;
              addLog({
                type: "followup",
                status: "sent",
                recipient_email: recipient.email,
                campaign_id: campaign.id,
                message: "Follow-up 2 delivered."
              });
            } catch (err) {
              db.prepare("UPDATE recipients SET followup2_status = 'failed' WHERE id = ?").run(recipient.id);
            }
            await sleep(Math.max(1, Number(campaign.sending_interval_sec) || 10) * 1000);
          }
        }
      }

      const counts = campaignCounts(campaign.id);
      const followupPending = db
        .prepare(
          `SELECT COUNT(*) AS c FROM recipients WHERE campaign_id = ?
           AND (
             (followup1_status = 'pending' AND IFNULL(followup1_body, '') != '')
             OR (followup2_status = 'pending' AND IFNULL(followup2_body, '') != '')
           )`
        )
        .get(campaign.id);
      if (counts.pending === 0 && counts.total > 0 && (followupPending.c || 0) === 0) {
        db.prepare("UPDATE campaigns SET status = 'completed', updated_at = ? WHERE id = ? AND status != 'paused'").run(
          nowIso(),
          campaign.id
        );
      } else if (campaign.status !== "paused") {
        db.prepare("UPDATE campaigns SET status = 'scheduled', updated_at = ? WHERE id = ?").run(nowIso(), campaign.id);
      }
    }
    lastRun = summary;
    return summary;
  } finally {
    running = false;
  }
}

export function startScheduler() {
  const tick = async () => {
    try {
      await dispatchOnce({ forceWindow: false });
    } catch (err) {
      addLog({ type: "scheduler", status: "error", message: String(err.message || err) });
    }
  };
  setInterval(tick, 60 * 1000);
  setTimeout(tick, 8000);
}
