import { useEffect, useState } from "react";
import { CheckCircle2, Settings as SettingsIcon, ShieldCheck, Loader2, AlertTriangle, XCircle, Globe } from "lucide-react";
import { api, TIME_ZONES } from "../api.js";

const STATUS_STYLES = {
  ok: { badge: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2, label: "Pass" },
  warn: { badge: "bg-amber-50 text-amber-700 border-amber-200", Icon: AlertTriangle, label: "Warning" },
  fail: { badge: "bg-rose-50 text-rose-700 border-rose-200", Icon: XCircle, label: "Missing" }
};

function DnsRow({ title, data }) {
  const style = STATUS_STYLES[data.status] || STATUS_STYLES.warn;
  const Icon = style.Icon;
  return (
    <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-slate-200">
      <div className="min-w-0">
        <div className="text-xs font-bold text-slate-800">{title}</div>
        <p className="text-xs text-slate-500 mt-0.5 break-words">{data.message}</p>
        {data.record && <code className="block mt-1 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1 break-all">{data.record}</code>}
        {data.records && data.records.length > 1 && (
          <ul className="mt-1 text-[11px] text-slate-500 space-y-0.5">
            {data.records.map((r, i) => <li key={i} className="break-all">- {r}</li>)}
          </ul>
        )}
      </div>
      <span className={`shrink-0 inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-semibold border rounded-full ${style.badge}`}>
        <Icon className="w-3 h-3" />
        <span>{style.label}</span>
      </span>
    </div>
  );
}

const EMPTY = {
  daily_send_limit: 100,
  time_window_start: "08:00",
  time_window_end: "10:00",
  sending_interval_sec: 10,
  default_timezone: "LOCAL",
  default_workdays_only: true,
  all_day_dispatch: false,
  track_links_enabled: true,
  zoho_auth_mode: "smtp",
  zoho_sender_email: "",
  zoho_smtp_host: "smtppro.zoho.com",
  zoho_smtp_port: 465,
  zoho_smtp_user: "",
  zoho_smtp_pass: "",
  zoho_client_id: "",
  zoho_client_secret: "",
  zoho_refresh_token: "",
  zoho_account_id: "",
  zoho_domain: "zoho.com",
  zoho_imap_host: "imappro.zoho.com",
  zoho_imap_port: 993,
  zoho_imap_user: "",
  zoho_imap_pass: ""
};

export default function SettingsPage({ settings, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingImap, setTestingImap] = useState(false);
  const [notice, setNotice] = useState(null);
  const [dnsDomain, setDnsDomain] = useState("");
  const [dnsSelector, setDnsSelector] = useState("");
  const [dnsResult, setDnsResult] = useState(null);
  const [dnsLoading, setDnsLoading] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm((prev) => ({
      ...prev,
      ...settings,
      zoho_smtp_pass: settings.zoho_smtp_pass || "",
      zoho_imap_pass: settings.zoho_imap_pass || "",
      zoho_client_secret: settings.zoho_client_secret || "",
      zoho_refresh_token: settings.zoho_refresh_token || ""
    }));
    const domain = String(settings.zoho_sender_email || "").split("@").pop() || "";
    setDnsDomain((prev) => prev || domain);
  }, [settings]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const payload = { ...form };
      if (!payload.zoho_smtp_pass) delete payload.zoho_smtp_pass;
      if (!payload.zoho_imap_pass) delete payload.zoho_imap_pass;
      if (!payload.zoho_client_secret) delete payload.zoho_client_secret;
      if (!payload.zoho_refresh_token) delete payload.zoho_refresh_token;
      await api.updateSettings(payload);
      try {
        localStorage.setItem("zoho_mailer_settings_backup", JSON.stringify({
          zoho_sender_email: form.zoho_sender_email,
          zoho_smtp_user: form.zoho_smtp_user,
          zoho_smtp_host: form.zoho_smtp_host,
          zoho_smtp_port: form.zoho_smtp_port,
          zoho_auth_mode: form.zoho_auth_mode
        }));
      } catch {
        /* ignore */
      }
      setNotice({ type: "success", message: "Settings saved. Worker will use them on the next tick." });
      onSaved?.();
    } catch (err) {
      setNotice({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const testSmtp = async () => {
    setTesting(true);
    setNotice(null);
    try {
      const result = await api.testZoho({
        zoho_smtp_host: form.zoho_smtp_host,
        zoho_smtp_port: form.zoho_smtp_port,
        zoho_smtp_user: form.zoho_smtp_user || form.zoho_sender_email,
        zoho_smtp_pass: form.zoho_smtp_pass,
        zoho_sender_email: form.zoho_sender_email
      });
      setNotice({ type: "success", message: `SMTP verified for ${result.user} on ${result.host}.` });
    } catch (err) {
      setNotice({ type: "error", message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const testImap = async () => {
    setTestingImap(true);
    setNotice(null);
    try {
      const result = await api.testZohoImap({
        zoho_imap_host: form.zoho_imap_host,
        zoho_imap_port: form.zoho_imap_port,
        zoho_imap_user: form.zoho_imap_user || form.zoho_sender_email,
        zoho_imap_pass: form.zoho_imap_pass || form.zoho_smtp_pass
      });
      setNotice({ type: "success", message: `IMAP verified for ${result.user} on ${result.host}.` });
    } catch (err) {
      setNotice({ type: "error", message: err.message });
    } finally {
      setTestingImap(false);
    }
  };

  const runDns = async () => {
    setDnsLoading(true);
    setDnsResult(null);
    try {
      const result = await api.checkDns(dnsDomain || form.zoho_sender_email, dnsSelector || undefined);
      setDnsResult(result);
    } catch (err) {
      setDnsResult({ error: err.message });
    } finally {
      setDnsLoading(false);
    }
  };

  const restoreBackup = () => {
    try {
      const raw = localStorage.getItem("zoho_mailer_settings_backup");
      if (!raw) return setNotice({ type: "error", message: "No browser backup found." });
      const parsed = JSON.parse(raw);
      setForm((f) => ({ ...f, ...parsed }));
      setNotice({ type: "success", message: "Restored non-secret fields from browser backup." });
    } catch {
      setNotice({ type: "error", message: "Backup restore failed." });
    }
  };

  return (
    <form onSubmit={save} className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
              <SettingsIcon className="w-5 h-5 text-indigo-600" />
              <span>Automation Engine Settings</span>
            </h2>
            <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full flex items-center space-x-1">
              <ShieldCheck className="w-3 h-3" />
              <span>Persistent Storage Active</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Configure daily dispatch ceilings, time window constraints, Zoho credentials, and SMTP/IMAP tests.</p>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          <button type="button" onClick={restoreBackup} className="px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg">
            Restore Backup
          </button>
          <button type="submit" disabled={saving} className="inline-flex items-center space-x-2 px-5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>{saving ? "Saving..." : "Save Settings"}</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className={`p-4 rounded-xl text-xs border ${notice.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
          {notice.message}
        </div>
      )}

      <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
        <h3 className="text-sm font-semibold">Dispatch defaults</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs font-semibold uppercase text-slate-600">
            Daily cap
            <input type="number" min="1" value={form.daily_send_limit} onChange={(e) => set("daily_send_limit", Number(e.target.value))} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold uppercase text-slate-600">
            Interval (sec)
            <input type="number" min="1" value={form.sending_interval_sec} onChange={(e) => set("sending_interval_sec", Number(e.target.value))} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold uppercase text-slate-600">
            Default timezone
            <select value={form.default_timezone} onChange={(e) => set("default_timezone", e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal">
              {TIME_ZONES.map((z) => <option key={z.code} value={z.iana === "LOCAL" ? "LOCAL" : z.iana}>{z.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase text-slate-600">
            Window start
            <input type="time" disabled={form.all_day_dispatch} value={form.time_window_start} onChange={(e) => set("time_window_start", e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold uppercase text-slate-600">
            Window end
            <input type="time" disabled={form.all_day_dispatch} value={form.time_window_end} onChange={(e) => set("time_window_end", e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <label className="inline-flex items-center space-x-2"><input type="checkbox" checked={!!form.all_day_dispatch} onChange={(e) => set("all_day_dispatch", e.target.checked)} /><span>Anytime dispatch</span></label>
          <label className="inline-flex items-center space-x-2"><input type="checkbox" checked={!!form.default_workdays_only} onChange={(e) => set("default_workdays_only", e.target.checked)} /><span>Weekdays only</span></label>
          <label className="inline-flex items-center space-x-2"><input type="checkbox" checked={!!form.track_links_enabled} onChange={(e) => set("track_links_enabled", e.target.checked)} /><span>Track links</span></label>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
        <h3 className="text-sm font-semibold">Zoho SMTP (required to send)</h3>
        <p className="text-xs text-slate-500">Use a Zoho Mail <strong>app password</strong>, not your account login. Host is usually smtppro.zoho.com port 465.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input placeholder="From email" value={form.zoho_sender_email} onChange={(e) => set("zoho_sender_email", e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          <input placeholder="SMTP user (usually same as from)" value={form.zoho_smtp_user} onChange={(e) => set("zoho_smtp_user", e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          <input placeholder="SMTP host" value={form.zoho_smtp_host} onChange={(e) => set("zoho_smtp_host", e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          <input type="number" placeholder="Port" value={form.zoho_smtp_port} onChange={(e) => set("zoho_smtp_port", Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm" />
          <input type="password" placeholder={settings?.zoho_smtp_pass_configured ? "App password (saved — leave blank to keep)" : "Zoho app password"} value={form.zoho_smtp_pass} onChange={(e) => set("zoho_smtp_pass", e.target.value)} className="border rounded-lg px-3 py-2 text-sm sm:col-span-2" />
        </div>
        <button type="button" onClick={testSmtp} disabled={testing} className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">
          {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>{testing ? "Testing SMTP..." : "Test SMTP"}</span>
        </button>
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
        <h3 className="text-sm font-semibold">Zoho IMAP (optional reply monitoring)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input placeholder="IMAP host" value={form.zoho_imap_host} onChange={(e) => set("zoho_imap_host", e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          <input type="number" placeholder="Port" value={form.zoho_imap_port} onChange={(e) => set("zoho_imap_port", Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm" />
          <input placeholder="IMAP user" value={form.zoho_imap_user} onChange={(e) => set("zoho_imap_user", e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          <input type="password" placeholder={settings?.zoho_imap_pass_configured ? "IMAP password (saved — leave blank to keep)" : "IMAP app password"} value={form.zoho_imap_pass} onChange={(e) => set("zoho_imap_pass", e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="button" onClick={testImap} disabled={testingImap} className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-bold border rounded-lg disabled:opacity-50">
          {testingImap && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>{testingImap ? "Testing IMAP..." : "Test IMAP"}</span>
        </button>
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center space-x-2">
              <Globe className="w-4 h-4 text-indigo-600" />
              <span>Email deliverability (SPF / DKIM / DMARC)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">Verifies the DNS records receivers check before accepting your mail. Run this before your first send.</p>
          </div>
          {dnsResult && !dnsResult.error && (
            <span className={`shrink-0 px-2 py-0.5 text-[11px] font-semibold border rounded-full ${dnsResult.summary.fail ? "bg-rose-50 text-rose-700 border-rose-200" : dnsResult.summary.warn ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
              {dnsResult.summary.ok}/{dnsResult.summary.total} passed
            </span>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input placeholder="Domain to check (e.g. yourdomain.com)" value={dnsDomain} onChange={(e) => setDnsDomain(e.target.value)} className="flex-1 border rounded-lg px-3 py-2 text-sm" />
          <input placeholder="DKIM selector (optional)" value={dnsSelector} onChange={(e) => setDnsSelector(e.target.value)} className="sm:w-56 border rounded-lg px-3 py-2 text-sm" />
          <button type="button" onClick={runDns} disabled={dnsLoading} className="inline-flex items-center justify-center space-x-2 px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg disabled:opacity-50">
            {dnsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{dnsLoading ? "Checking..." : "Run check"}</span>
          </button>
        </div>
        {dnsResult?.error && (
          <div className="p-3 rounded-lg text-xs bg-rose-50 border border-rose-200 text-rose-800">{dnsResult.error}</div>
        )}
        {dnsResult && !dnsResult.error && (
          <div className="space-y-2">
            <DnsRow title={`SPF`} data={dnsResult.spf} />
            <DnsRow title={`DKIM${dnsResult.dkim.selector ? ` (selector: ${dnsResult.dkim.selector})` : ""}`} data={dnsResult.dkim} />
            <DnsRow title="DMARC" data={dnsResult.dmarc} />
            <DnsRow title="MX (receiving replies)" data={dnsResult.mx} />
            {dnsResult.guidance?.length > 0 && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-xs font-bold text-slate-700 mb-1">Recommended actions</div>
                <ul className="text-xs text-slate-600 space-y-1">
                  {dnsResult.guidance.map((g, i) => <li key={i}>- {g}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-3">
        <h3 className="text-sm font-semibold">Zoho OAuth (optional Mail API)</h3>
        <p className="text-xs text-slate-500">SMTP is enough to send. OAuth is stored if you already have a Zoho API client.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input placeholder="Client ID" value={form.zoho_client_id} onChange={(e) => set("zoho_client_id", e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          <input type="password" placeholder="Client secret" value={form.zoho_client_secret} onChange={(e) => set("zoho_client_secret", e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Account ID" value={form.zoho_account_id} onChange={(e) => set("zoho_account_id", e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Domain (zoho.com / zoho.eu)" value={form.zoho_domain} onChange={(e) => set("zoho_domain", e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          <input type="password" placeholder="Refresh token" value={form.zoho_refresh_token} onChange={(e) => set("zoho_refresh_token", e.target.value)} className="border rounded-lg px-3 py-2 text-sm sm:col-span-2" />
        </div>
      </div>
    </form>
  );
}
