import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Upload, AlertTriangle, Download, FileSpreadsheet } from "lucide-react";
import { api, TIME_ZONES, formatInterval } from "../api.js";
import { downloadSampleSheet, mapOutreachRows, readSpreadsheetFile } from "../excel.js";

function SheetUpload({ label, hint, fileName, headers, mapping, onFile, onChangeCol, preview, validCount, totalCount }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
      </div>
      <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl p-6 cursor-pointer hover:border-indigo-300 bg-slate-50/50">
        <Upload className="w-5 h-5 text-indigo-600" />
        <span className="text-sm font-medium mt-2">{fileName || "Drop Excel (.xlsx / .csv) or click to upload"}</span>
        <span className="text-[11px] text-slate-500 mt-1">Columns: Business Name, Email Address, Body</span>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>
      {headers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="text-[11px] font-semibold uppercase text-slate-500">
            Business name
            <select value={mapping.nameCol || ""} onChange={(e) => onChangeCol("nameCol", e.target.value)} className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm font-normal text-slate-800">
              <option value="">(none)</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold uppercase text-slate-500">
            Email address
            <select value={mapping.emailCol || ""} onChange={(e) => onChangeCol("emailCol", e.target.value)} className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm font-normal text-slate-800">
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold uppercase text-slate-500">
            Pre-written body
            <select value={mapping.bodyCol || ""} onChange={(e) => onChangeCol("bodyCol", e.target.value)} className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm font-normal text-slate-800">
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        </div>
      )}
      {totalCount > 0 && (
        <div className="text-xs text-slate-600">
          {validCount} ready to send / {totalCount} rows
        </div>
      )}
      {preview && (
        <div className="text-xs bg-slate-50 border rounded-lg p-3">
          <div className="font-semibold text-slate-700">Preview · {preview.businessName || preview.email}</div>
          <div className="mt-1 font-medium">{preview.subject}</div>
          <pre className="whitespace-pre-wrap mt-1 text-slate-600 max-h-40 overflow-auto">{preview.body}</pre>
        </div>
      )}
    </div>
  );
}

function emptySheet() {
  return { fileName: "", headers: [], rows: [], emailCol: "", nameCol: "", bodyCol: "" };
}

function windowMinutes(start, end) {
  const toMin = (v) => {
    const [h, m] = String(v || "0:0").split(":").map((n) => Number(n) || 0);
    return h * 60 + m;
  };
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : 0;
}

export default function CampaignCreator({ settings, onCreated }) {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [interval, setInterval] = useState(10);
  const [dailyLimit, setDailyLimit] = useState(settings?.daily_send_limit || 100);
  const [newPerDay, setNewPerDay] = useState(10);
  const [winStart, setWinStart] = useState("08:00");
  const [winEnd, setWinEnd] = useState("10:00");
  const [workdaysOnly, setWorkdaysOnly] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [email1, setEmail1] = useState(emptySheet);
  const [fu1, setFu1] = useState(emptySheet);
  const [fu2, setFu2] = useState(emptySheet);
  const [fu1Days, setFu1Days] = useState(2);
  const [fu2Days, setFu2Days] = useState(2);

  useEffect(() => {
    if (!settings) return;
    if (settings.default_timezone && settings.default_timezone !== "LOCAL") setTimezone(settings.default_timezone);
    if (settings.sending_interval_sec) setInterval(settings.sending_interval_sec);
    if (settings.daily_send_limit) setDailyLimit(settings.daily_send_limit);
  }, [settings]);

  const email1Mapped = useMemo(
    () => mapOutreachRows(email1.headers, email1.rows, email1),
    [email1]
  );
  const fu1Mapped = useMemo(() => mapOutreachRows(fu1.headers, fu1.rows, fu1), [fu1]);
  const fu2Mapped = useMemo(() => mapOutreachRows(fu2.headers, fu2.rows, fu2), [fu2]);

  const loadSheet = async (file, setter) => {
    setError(null);
    try {
      const { headers, rows } = await readSpreadsheetFile(file);
      const mapped = mapOutreachRows(headers, rows, {});
      setter({
        fileName: file.name,
        headers,
        rows,
        emailCol: mapped.emailCol,
        nameCol: mapped.nameCol,
        bodyCol: mapped.bodyCol
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Campaign name is required.");
    if (!email1Mapped.valid.length) return setError("Upload an Excel sheet with Business Name, Email Address, and Body columns.");
    setSaving(true);
    setError(null);
    try {
      if (dailyLimit > 0 && settings && Number(dailyLimit) !== Number(settings.daily_send_limit)) {
        try {
          await api.updateSettings({ daily_send_limit: Number(dailyLimit) });
        } catch {
          /* ignore */
        }
      }
      const created = await api.createCampaign({
        name: name.trim(),
        target_timezone: timezone,
        time_window_start: winStart,
        time_window_end: winEnd,
        sending_interval_sec: Number(interval) || 10,
        workdays_only: !!workdaysOnly,
        daily_new_limit: Number(newPerDay) || 0,
        status: "scheduled",
        followup1_enabled: fu1Mapped.valid.length > 0,
        followup1_delay_days: Number(fu1Days) || 0,
        followup1_time_window_start: winStart,
        followup1_time_window_end: winEnd,
        followup2_enabled: fu2Mapped.valid.length > 0,
        followup2_delay_days: Number(fu2Days) || 0,
        followup2_time_window_start: winStart,
        followup2_time_window_end: winEnd,
        recipients: email1Mapped.valid.map((r) => ({
          email: r.email,
          subject: r.subject,
          body: r.body,
          custom_fields: r.custom_fields,
          followup1_subject: "",
          followup1_body: "",
          followup2_subject: "",
          followup2_body: ""
        }))
      });
      if (fu1Mapped.valid.length) {
        await api.importFollowups(created.id, {
          stage: 1,
          delay_days: Number(fu1Days) || 0,
          recipients: fu1Mapped.valid.map((r) => ({
            email: r.email,
            subject: r.subject,
            body: r.body,
            businessName: r.businessName,
            custom_fields: r.custom_fields
          }))
        });
      }
      if (fu2Mapped.valid.length) {
        await api.importFollowups(created.id, {
          stage: 2,
          delay_days: Number(fu2Days) || 0,
          recipients: fu2Mapped.valid.map((r) => ({
            email: r.email,
            subject: r.subject,
            body: r.body,
            businessName: r.businessName,
            custom_fields: r.custom_fields
          }))
        });
      }
      await api.triggerScheduler(true, created.id);
      onCreated();
    } catch (err) {
      setError(`Failed to start sending: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Upload Excel and send</h2>
        <p className="text-xs text-slate-500 mt-1">
          Each row is one recipient. The app reads Business Name, Email Address, and the pre-written body, then sends one after another.
        </p>
        <div className="mt-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-900 text-xs">
          Email 1 starts sending as soon as you create the campaign. Upload Email 2 / Email 3 the same way for Follow-up 1 and Follow-up 2 (matched by email address).
        </div>
        {error && (
          <div className="mt-4 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}
        <div className="mt-5">
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">Campaign name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., April plumber outreach"
            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              {TIME_ZONES.map((z) => (
                <option key={z.code} value={z.iana}>{z.label}</option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50/40 p-2.5">
            <label className="block text-xs font-bold text-indigo-800 uppercase mb-1.5">Seconds between emails</label>
            <input type="number" min="1" value={interval} onChange={(e) => setInterval(e.target.value)} className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm bg-white" />
            <div className="text-[11px] text-indigo-700 mt-1">Gap between each send = {formatInterval(Number(interval) || 1, true)}</div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">Emails per day</label>
            <input type="number" min="1" value={newPerDay} onChange={(e) => setNewPerDay(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">Window start</label>
            <input type="time" value={winStart} onChange={(e) => setWinStart(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">Window end</label>
            <input type="time" value={winEnd} onChange={(e) => setWinEnd(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
        </div>
        <label className="mt-3 inline-flex items-center space-x-2 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={workdaysOnly} onChange={(e) => setWorkdaysOnly(e.target.checked)} />
          <span>Weekdays only (Mon-Fri)</span>
        </label>
        <p className="mt-2 text-[11px] text-slate-500">
          "Emails per day" caps only new Email 1 sends (e.g. 10). Follow-ups go out in the same {winStart}-{winEnd} window and are not counted against it.
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          At {formatInterval(Number(interval) || 1, true)} per send, the {winStart}-{winEnd} window fits about{" "}
          {Math.max(0, Math.floor(windowMinutes(winStart, winEnd) * 60 / (Number(interval) || 1)))} emails per day.
        </p>
        <button type="button" onClick={() => downloadSampleSheet()} className="mt-4 inline-flex items-center space-x-1.5 text-xs font-semibold text-indigo-700">
          <Download className="w-3.5 h-3.5" />
          <span>Download sample Excel</span>
        </button>
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200">
        <SheetUpload
          label="Email 1 · initial outreach sheet"
          hint="Required. Sends sequentially, one recipient after another, using each row's body text."
          fileName={email1.fileName}
          headers={email1.headers}
          mapping={email1}
          onFile={(file) => loadSheet(file, setEmail1)}
          onChangeCol={(key, value) => setEmail1((s) => ({ ...s, [key]: value }))}
          preview={email1Mapped.valid[0]}
          validCount={email1Mapped.valid.length}
          totalCount={email1.rows.length}
        />
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
        <div className="flex items-center space-x-2">
          <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-semibold">Email 2 · Follow-up 1 sheet (optional)</h3>
        </div>
        <p className="text-xs text-slate-500">Same 3 columns. Rows are matched to Email 1 by email address. Set delay to 0 to send as soon as Email 1 is done.</p>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Days after Email 1
          <input type="number" min="0" value={fu1Days} onChange={(e) => setFu1Days(e.target.value)} className="mt-1 w-32 border rounded-lg px-2 py-1.5 text-sm font-normal block" />
        </label>
        <SheetUpload
          label=""
          hint=""
          fileName={fu1.fileName}
          headers={fu1.headers}
          mapping={fu1}
          onFile={(file) => loadSheet(file, setFu1)}
          onChangeCol={(key, value) => setFu1((s) => ({ ...s, [key]: value }))}
          preview={fu1Mapped.valid[0]}
          validCount={fu1Mapped.valid.length}
          totalCount={fu1.rows.length}
        />
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
        <div className="flex items-center space-x-2">
          <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-semibold">Email 3 · Follow-up 2 sheet (optional)</h3>
        </div>
        <p className="text-xs text-slate-500">Same 3 columns, matched by email. Delay is extra days after Follow-up 1.</p>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Extra days after Follow-up 1
          <input type="number" min="0" value={fu2Days} onChange={(e) => setFu2Days(e.target.value)} className="mt-1 w-32 border rounded-lg px-2 py-1.5 text-sm font-normal block" />
        </label>
        <SheetUpload
          label=""
          hint=""
          fileName={fu2.fileName}
          headers={fu2.headers}
          mapping={fu2}
          onFile={(file) => loadSheet(file, setFu2)}
          onChangeCol={(key, value) => setFu2((s) => ({ ...s, [key]: value }))}
          preview={fu2Mapped.valid[0]}
          validCount={fu2Mapped.valid.length}
          totalCount={fu2.rows.length}
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full inline-flex items-center justify-center space-x-2 px-5 py-3 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
      >
        <CheckCircle2 className="w-4 h-4" />
        <span>
          {saving
            ? "Starting sequential send..."
            : `Upload and start sending${email1Mapped.valid.length ? ` (${email1Mapped.valid.length})` : ""}`}
        </span>
      </button>
    </form>
  );
}
