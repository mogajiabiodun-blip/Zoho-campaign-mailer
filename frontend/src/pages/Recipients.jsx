import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Trash2, Download, Ban } from "lucide-react";
import { api } from "../api.js";
import { downloadSampleSheet, mapOutreachRows, readSpreadsheetFile } from "../excel.js";

function emptySheet() {
  return { fileName: "", headers: [], rows: [], emailCol: "", nameCol: "", bodyCol: "" };
}

export default function Recipients({ campaigns, onRefresh }) {
  const [recipients, setRecipients] = useState([]);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("all");
  const [campaignId, setCampaignId] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [optOuts, setOptOuts] = useState([]);
  const [optText, setOptText] = useState("");
  const [optReason, setOptReason] = useState("");
  const [importCampaign, setImportCampaign] = useState(campaigns[0]?.id || "");
  const [email1, setEmail1] = useState(emptySheet);
  const [fu1, setFu1] = useState(emptySheet);
  const [fu2, setFu2] = useState(emptySheet);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);
  const fu1Ref = useRef(null);
  const fu2Ref = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const [r, l, o] = await Promise.all([
        api.getRecipients({
          status: status !== "all" ? status : undefined,
          campaign_id: campaignId !== "all" ? campaignId : undefined,
          search: search || undefined
        }),
        api.getLogs(),
        api.getOptOutList()
      ]);
      setRecipients(r);
      setLogs(l);
      setOptOuts(o);
    } catch (err) {
      setNotice({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    setSelected(new Set());
  }, [status, campaignId]);

  useEffect(() => {
    if (campaigns.length && !importCampaign) setImportCampaign(campaigns[0].id);
  }, [campaigns, importCampaign]);

  const campaignName = (id) => campaigns.find((c) => c.id === id)?.name || id || "—";

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    if (!selected.size) return;
    await api.bulkDeleteRecipients([...selected]);
    setSelected(new Set());
    await load();
    onRefresh();
  };

  const applyOptOut = async () => {
    const emails = optText
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (!emails.length) return;
    await api.unsubscribeEmails(emails, optReason);
    setOptText("");
    setNotice({ type: "success", message: `Applied ${emails.length} suppression(s).` });
    await load();
    onRefresh();
  };

  const loadSheet = async (file, setter) => {
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
      setNotice({ type: "error", message: err.message });
    }
  };

  const email1Mapped = useMemo(() => mapOutreachRows(email1.headers, email1.rows, email1), [email1]);
  const fu1Mapped = useMemo(() => mapOutreachRows(fu1.headers, fu1.rows, fu1), [fu1]);
  const fu2Mapped = useMemo(() => mapOutreachRows(fu2.headers, fu2.rows, fu2), [fu2]);

  const runImport = async () => {
    if (!importCampaign) return setNotice({ type: "error", message: "Select a campaign." });
    if (!email1Mapped.valid.length) return setNotice({ type: "error", message: "Upload Email 1 Excel with Business Name, Email Address, and Body." });
    setImporting(true);
    try {
      const result = await api.importRecipients(
        importCampaign,
        email1Mapped.valid.map((r) => ({
          email: r.email,
          subject: r.subject,
          body: r.body,
          custom_fields: r.custom_fields
        }))
      );
      setNotice({ type: "success", message: `Imported ${result.imported_count} recipients. Sequential send will continue.` });
      setEmail1(emptySheet());
      await api.triggerScheduler(true, importCampaign);
      await load();
      onRefresh();
    } catch (err) {
      setNotice({ type: "error", message: err.message });
    } finally {
      setImporting(false);
    }
  };

  const runFollowupImport = async (stage, mapped, setter) => {
    if (!importCampaign) return setNotice({ type: "error", message: "Select a campaign." });
    if (!mapped.valid.length) return setNotice({ type: "error", message: `Upload Follow-up ${stage} Excel first.` });
    setImporting(true);
    try {
      const result = await api.importFollowups(importCampaign, {
        stage,
        delay_days: 0,
        recipients: mapped.valid.map((r) => ({
          email: r.email,
          subject: r.subject,
          body: r.body,
          businessName: r.businessName,
          custom_fields: r.custom_fields
        }))
      });
      setNotice({
        type: "success",
        message: `Follow-up ${stage}: matched ${result.matched} emails${result.missing ? `, ${result.missing} not in campaign` : ""}.`
      });
      setter(emptySheet());
      await api.triggerScheduler(true, importCampaign);
      await load();
      onRefresh();
    } catch (err) {
      setNotice({ type: "error", message: err.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className={`p-3.5 border rounded-xl text-xs ${notice.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
          {notice.message}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-sm font-semibold text-slate-900">Excel upload · Email 1 / Follow-up 1 / Follow-up 2</h2>
          <p className="text-xs text-slate-500 mt-0.5">Same 3 columns on every sheet: Business Name, Email Address, Body. Sends one after another in sheet order.</p>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select value={importCampaign} onChange={(e) => setImportCampaign(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
              <option value="">Select campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button type="button" onClick={() => downloadSampleSheet()} className="inline-flex items-center justify-center space-x-1.5 px-3 py-2 text-xs font-semibold border rounded-lg">
              <Download className="w-3.5 h-3.5" />
              <span>Download sample Excel</span>
            </button>
          </div>

          <div className="border rounded-xl p-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-600">Email 1 sheet</div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && loadSheet(e.target.files[0], setEmail1)} />
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 border rounded-lg">
              <Upload className="w-3.5 h-3.5" />
              <span>{email1.fileName || "Upload Email 1 Excel"}</span>
            </button>
            {email1.rows.length > 0 && (
              <div className="text-xs text-slate-500">{email1Mapped.valid.length} ready / {email1.rows.length} rows · {email1Mapped.valid[0]?.email}</div>
            )}
            <button type="button" disabled={importing} onClick={runImport} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">
              {importing ? "Importing..." : "Import Email 1 and send sequentially"}
            </button>
          </div>

          <div className="border rounded-xl p-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-600">Follow-up 1 sheet</div>
            <p className="text-[11px] text-slate-500">Matched to existing recipients by email address. Uses each row's body as Email 2.</p>
            <input ref={fu1Ref} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && loadSheet(e.target.files[0], setFu1)} />
            <button type="button" onClick={() => fu1Ref.current?.click()} className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 border rounded-lg">
              <Upload className="w-3.5 h-3.5" />
              <span>{fu1.fileName || "Upload Follow-up 1 Excel"}</span>
            </button>
            {fu1.rows.length > 0 && <div className="text-xs text-slate-500">{fu1Mapped.valid.length} ready / {fu1.rows.length} rows</div>}
            <button type="button" disabled={importing} onClick={() => runFollowupImport(1, fu1Mapped, setFu1)} className="px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg disabled:opacity-50">
              Apply Follow-up 1 sheet
            </button>
          </div>

          <div className="border rounded-xl p-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-600">Follow-up 2 sheet</div>
            <p className="text-[11px] text-slate-500">Matched by email. Uses each row's body as Email 3.</p>
            <input ref={fu2Ref} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && loadSheet(e.target.files[0], setFu2)} />
            <button type="button" onClick={() => fu2Ref.current?.click()} className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 border rounded-lg">
              <Upload className="w-3.5 h-3.5" />
              <span>{fu2.fileName || "Upload Follow-up 2 Excel"}</span>
            </button>
            {fu2.rows.length > 0 && <div className="text-xs text-slate-500">{fu2Mapped.valid.length} ready / {fu2.rows.length} rows</div>}
            <button type="button" disabled={importing} onClick={() => runFollowupImport(2, fu2Mapped, setFu2)} className="px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg disabled:opacity-50">
              Apply Follow-up 2 sheet
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-5 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between border-b">
          <h2 className="text-sm font-semibold">Recipients</h2>
          <div className="flex flex-wrap gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
              {["all", "pending", "sent", "failed", "bounced", "replied", "unsubscribed"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
              <option value="all">All campaigns</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                load();
              }}
              className="flex gap-2"
            >
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email" className="border rounded-lg px-2 py-1.5 text-xs" />
              <button className="px-2 py-1.5 text-xs border rounded-lg">Search</button>
            </form>
            {selected.size > 0 && (
              <button onClick={deleteSelected} className="inline-flex items-center space-x-1 px-2 py-1.5 text-xs text-rose-700 border border-rose-200 rounded-lg">
                <Trash2 className="w-3 h-3" /><span>Delete {selected.size}</span>
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Campaign</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Subject</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500 text-sm">Loading...</td></tr>
              ) : recipients.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500 text-sm">No recipients.</td></tr>
              ) : recipients.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="px-3 py-2 font-medium">{r.email}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{campaignName(r.campaign_id)}</td>
                  <td className="px-3 py-2 text-xs">{r.status}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 truncate max-w-xs">{r.subject}</td>
                  <td className="px-3 py-2 text-right">
                    {r.status === "sent" && (
                      <button
                        className="text-[11px] text-indigo-700"
                        onClick={async () => {
                          await api.simulateReply(r.id, "Thanks for following up! We would like to schedule a 15-minute call next week to review this.");
                          setNotice({ type: "success", message: `Reply simulated for ${r.email}` });
                          load();
                          onRefresh();
                        }}
                      >
                        Simulate reply
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-rose-100 p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center space-x-2"><Ban className="w-4 h-4 text-rose-600" /><span>Suppression list</span></h2>
        <textarea value={optText} onChange={(e) => setOptText(e.target.value)} rows={3} placeholder="one@company.com" className="w-full text-xs py-2 px-3 border rounded-xl font-mono" />
        <input value={optReason} onChange={(e) => setOptReason(e.target.value)} placeholder="Reason (optional)" className="w-full text-xs py-1.5 px-3 border rounded-lg" />
        <button type="button" onClick={applyOptOut} className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-bold text-white bg-rose-600 rounded-xl">Apply to Suppression List</button>
        <div className="text-xs text-slate-500">Current suppression records ({optOuts.length})</div>
        <ul className="text-xs divide-y">
          {optOuts.map((o) => (
            <li key={o.email} className="py-1.5 flex justify-between">
              <span>{o.email} {o.reason ? `· ${o.reason}` : ""}</span>
              <button className="text-rose-600" onClick={async () => { await api.resubscribeEmail(o.email); load(); }}>remove</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold">Activity logs</h2>
          <a href={api.getExportLogsCsvUrl()} className="text-xs font-semibold text-indigo-700">Export CSV</a>
        </div>
        <ul className="divide-y max-h-80 overflow-auto">
          {logs.map((l) => (
            <li key={l.id} className="px-4 py-2 text-xs flex justify-between gap-3">
              <span><span className="font-semibold uppercase text-slate-500 mr-2">{l.type}/{l.status}</span>{l.message}</span>
              <span className="text-slate-400 shrink-0">{l.created_at?.replace("T", " ").slice(0, 19)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
