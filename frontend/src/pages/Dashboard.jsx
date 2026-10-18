import { useMemo, useState } from "react";
import {
  Play,
  Pause,
  Trash2,
  Clock,
  Mail,
  MessageSquare,
  AlertTriangle,
  PlusCircle,
  Users,
  Sparkles,
  RefreshCw,
  Download,
  Zap,
  Timer,
  X
} from "lucide-react";
import { api, formatInterval } from "../api.js";

function StatCard({ label, value, hint, accent }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent || "text-slate-900"}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function statusBadge(status) {
  const map = {
    scheduled: "bg-indigo-50 text-indigo-700 border-indigo-200",
    sending: "bg-amber-50 text-amber-800 border-amber-200",
    paused: "bg-slate-100 text-slate-600 border-slate-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    draft: "bg-slate-50 text-slate-500 border-slate-200",
    active: "bg-indigo-50 text-indigo-700 border-indigo-200"
  };
  return map[status] || "bg-slate-50 text-slate-600 border-slate-200";
}

export default function Dashboard({
  stats,
  campaigns,
  logs,
  loading,
  onRefresh,
  onNavigateToCreator,
  onNavigateToRecipients,
  onNavigateToAiIntel,
  onToggleCampaignStatus,
  onDeleteCampaign,
  onTriggerCampaign,
  isDispatching
}) {
  const [intervalCampaign, setIntervalCampaign] = useState(null);
  const [intervalSec, setIntervalSec] = useState(10);
  const [error, setError] = useState(null);
  const [activityError, setActivityError] = useState(null);
  const [clearingActivity, setClearingActivity] = useState(false);

  const tz = stats?.timeZoneStatuses || [];
  const openWindows = tz.filter((z) => z.canDispatch).length;

  const bounceRate = useMemo(() => {
    const failed = (stats?.totalFailed || 0) + (stats?.totalBounced || 0);
    const sent = stats?.totalSent || 0;
    if (!sent && !failed) return 0;
    return Math.round((failed / Math.max(1, sent + failed)) * 1000) / 10;
  }, [stats]);

  const exportCampaigns = () => {
    window.open(api.getExportCampaignsCsvUrl(), "_blank");
  };

  const downloadActivity = () => {
    window.open(api.getExportLogsCsvUrl(), "_blank");
  };

  const deleteActivity = async (id) => {
    if (!window.confirm("Delete this activity entry?")) return;
    setActivityError(null);
    try {
      await api.deleteLog(id);
      await onRefresh();
    } catch (err) {
      setActivityError(err.message);
    }
  };

  const clearActivity = async () => {
    if (!window.confirm("Clear all activity logs? This cannot be undone.")) return;
    setActivityError(null);
    setClearingActivity(true);
    try {
      await api.clearLogs();
      await onRefresh();
    } catch (err) {
      setActivityError(err.message);
    } finally {
      setClearingActivity(false);
    }
  };

  if (loading && !stats) {
    return <div className="text-sm text-slate-500">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Campaign dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Dispatch happens in each recipient timezone window. Worker evaluates every 60 seconds.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={onRefresh} className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold border border-slate-200 rounded-lg bg-white">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          <button onClick={exportCampaigns} className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold border border-slate-200 rounded-lg bg-white">
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button onClick={onNavigateToCreator} className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg">
            <PlusCircle className="w-3.5 h-3.5" />
            <span>New campaign</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Sent today" value={stats?.sentToday ?? 0} hint={`${stats?.remainingDailyQuota ?? 0} remaining of ${stats?.dailyCap ?? 100}`} />
        <StatCard label="Pending queue" value={stats?.pendingQueueCount ?? 0} hint={`${stats?.activeCampaigns ?? 0} active campaigns`} />
        <StatCard label="Reply rate" value={`${stats?.replyRatePercent ?? 0}%`} hint={`${stats?.totalReplied ?? 0} replies / ${stats?.totalSent ?? 0} sent`} accent="text-emerald-700" />
        <StatCard label="Failed / bounce" value={`${bounceRate}%`} hint={`${stats?.totalFailed ?? 0} failed · ${stats?.totalBounced ?? 0} bounced`} accent={bounceRate >= 8 ? "text-rose-700" : "text-slate-900"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <button onClick={onNavigateToCreator} className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-indigo-200">
          <PlusCircle className="w-4 h-4 text-indigo-600" />
          <div className="mt-2 text-sm font-semibold">Create campaign</div>
          <div className="text-xs text-slate-500">Upload CSV and schedule a local 8-10 AM window.</div>
        </button>
        <button onClick={onNavigateToRecipients} className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-indigo-200">
          <Users className="w-4 h-4 text-indigo-600" />
          <div className="mt-2 text-sm font-semibold">Recipients & logs</div>
          <div className="text-xs text-slate-500">Import more leads, suppressions, and activity.</div>
        </button>
        <button onClick={onNavigateToAiIntel} className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-indigo-200">
          <Sparkles className="w-4 h-4 text-indigo-600" />
          <div className="mt-2 text-sm font-semibold">AI copy & intel</div>
          <div className="text-xs text-slate-500">Draft sequences and deliverability advice on demand.</div>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Timezone windows</h2>
            <p className="text-xs text-slate-500">{openWindows} zone{openWindows === 1 ? "" : "s"} currently inside the default dispatch window.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
          {tz.slice(0, 6).map((z) => (
            <div key={z.code} className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{z.abbr} · {z.code}</div>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${z.canDispatch ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {z.canDispatch ? "Open" : "Closed"}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1">{z.localTimeFormatted} · {z.localDateFormatted}</div>
              {!z.canDispatch && z.reasons?.[0] && <div className="text-[11px] text-amber-700 mt-2">{z.reasons[0]}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Campaigns</h2>
        </div>
        {campaigns.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No campaigns yet. Create one from a spreadsheet of opted-in or purchased leads you already have.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Campaign</th>
                  <th className="text-left px-4 py-2 font-semibold">Window</th>
                  <th className="text-left px-4 py-2 font-semibold">Queue</th>
                  <th className="text-left px-4 py-2 font-semibold">Status</th>
                  <th className="text-right px-4 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.target_timezone} · every {formatInterval(c.sending_interval_sec)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {c.time_window_start} – {c.time_window_end}
                      {c.workdays_only ? " · weekdays" : " · all days"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex items-center space-x-2 text-slate-600">
                        <span className="inline-flex items-center space-x-1"><Mail className="w-3 h-3" /><span>{c.sent_count}</span></span>
                        <span className="inline-flex items-center space-x-1"><Clock className="w-3 h-3" /><span>{c.pending_count}</span></span>
                        <span className="inline-flex items-center space-x-1"><MessageSquare className="w-3 h-3" /><span>{c.replied_count}</span></span>
                        {c.failed_count > 0 && <span className="inline-flex items-center space-x-1 text-rose-600"><AlertTriangle className="w-3 h-3" /><span>{c.failed_count}</span></span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${statusBadge(c.status)}`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end space-x-1">
                        <button
                          title="Dispatch now"
                          disabled={isDispatching}
                          onClick={() => onTriggerCampaign(c.id)}
                          className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-700"
                        >
                          <Zap className="w-4 h-4" />
                        </button>
                        <button
                          title="Set interval"
                          onClick={() => {
                            setIntervalSec(c.sending_interval_sec || 10);
                            setIntervalCampaign(c);
                          }}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
                        >
                          <Timer className="w-4 h-4" />
                        </button>
                        <button
                          title={c.status === "paused" ? "Resume" : "Pause"}
                          onClick={() => onToggleCampaignStatus(c.id, c.status === "paused" ? "scheduled" : "paused")}
                          className="p-1.5 rounded-lg hover:bg-slate-100"
                        >
                          {c.status === "paused" ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                        </button>
                        <button
                          title="Delete"
                          onClick={() => onDeleteCampaign(c.id)}
                          className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Recent activity</h2>
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={downloadActivity}
              disabled={logs.length === 0}
              className="inline-flex items-center space-x-1 text-xs font-semibold text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download CSV</span>
            </button>
            <button
              type="button"
              onClick={clearActivity}
              disabled={logs.length === 0 || clearingActivity}
              className="inline-flex items-center space-x-1 text-xs font-semibold text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{clearingActivity ? "Clearing..." : "Clear all"}</span>
            </button>
          </div>
        </div>
        {activityError && (
          <div className="px-4 py-2 text-xs text-rose-700 bg-rose-50 border-b border-rose-100">{activityError}</div>
        )}
        {logs.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No activity yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {logs.slice(0, 12).map((l) => (
              <li key={l.id} className="px-4 py-2.5 text-xs flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-semibold uppercase tracking-wider text-slate-500 mr-2">{l.type}</span>
                  <span className={l.status === "failed" ? "text-rose-700" : "text-slate-800"}>{l.message}</span>
                  {l.recipient_email && <div className="text-slate-500 mt-0.5">{l.recipient_email}</div>}
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <span className="text-slate-400">{l.created_at?.replace("T", " ").slice(0, 19)}</span>
                  <button
                    type="button"
                    title="Delete entry"
                    onClick={() => deleteActivity(l.id)}
                    className="p-0.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {intervalCampaign && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-sm">
            <h3 className="font-bold text-sm">Seconds between emails</h3>
            <p className="text-xs text-slate-500 mt-1">{intervalCampaign.name} · currently every {formatInterval(intervalCampaign.sending_interval_sec)}</p>
            <label className="block text-[11px] font-semibold uppercase text-slate-500 mt-3">
              New interval (seconds)
              <input
                type="number"
                min="1"
                autoFocus
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal"
                value={intervalSec}
                onChange={(e) => setIntervalSec(e.target.value)}
              />
            </label>
            <div className="text-[11px] text-slate-500 mt-2">This equals {formatInterval(Number(intervalSec) || 1, true)} between each email. Applies to this campaign's new sends and follow-ups.</div>
            {error && <div className="text-[11px] text-rose-700 mt-2">{error}</div>}
            <div className="mt-4 flex justify-end space-x-2">
              <button onClick={() => setIntervalCampaign(null)} className="text-xs px-3 py-1.5 border rounded-lg">Cancel</button>
              <button
                onClick={async () => {
                  setError(null);
                  try {
                    await api.updateCampaignInterval(intervalCampaign.id, Number(intervalSec));
                    setIntervalCampaign(null);
                    onRefresh();
                  } catch (err) {
                    setError(err.message);
                  }
                }}
                className="text-xs px-3 py-1.5 bg-slate-900 text-white rounded-lg"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
