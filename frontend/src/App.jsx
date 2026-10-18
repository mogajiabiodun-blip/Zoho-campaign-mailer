import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  Mail,
  PlusCircle,
  Users,
  Settings as SettingsIcon,
  Sparkles,
  Zap,
  Inbox,
  Gauge
} from "lucide-react";
import { api } from "./api.js";
import Dashboard from "./pages/Dashboard.jsx";
import CampaignCreator from "./pages/CampaignCreator.jsx";
import Recipients from "./pages/Recipients.jsx";
import SettingsPage from "./pages/Settings.jsx";
import AiIntel from "./pages/AiIntel.jsx";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "creator", label: "New Campaign", icon: PlusCircle },
  { id: "recipients", label: "Recipients & Logs", icon: Users },
  { id: "settings", label: "Settings", icon: SettingsIcon },
  { id: "ai", label: "AI & Intel", icon: Sparkles }
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [stats, setStats] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [pollingImap, setPollingImap] = useState(false);
  const [toast, setToast] = useState(null);
  const [capOpen, setCapOpen] = useState(false);
  const [capValue, setCapValue] = useState(100);

  const refresh = useCallback(async () => {
    try {
      const [s, c, l, st] = await Promise.all([
        api.getStats(),
        api.getCampaigns(),
        api.getLogs(),
        api.getSettings()
      ]);
      setStats(s);
      setCampaigns(c);
      setLogs(l);
      setSettings(st);
      setCapValue(s.dailyCap || 100);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(id);
  }, [toast]);

  const triggerDispatch = async (force = true, campaignId) => {
    setDispatching(true);
    try {
      const result = await api.triggerScheduler(force, campaignId);
      setToast({
        type: "success",
        message: `Dispatch complete. Sent: ${result.dispatchedThisRun || 0}. Failed: ${result.failedThisRun || 0}.`
      });
      await refresh();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setDispatching(false);
    }
  };

  const pollImap = async () => {
    setPollingImap(true);
    try {
      const result = await api.pollImapReplies();
      setToast({
        type: "success",
        message: `Inbound poll: ${result.replies || 0} replies, ${result.bounces || 0} bounces, ${result.suppressed || 0} suppressed, ${result.cancelledFollowups || 0} follow-ups stopped.`
      });
      await refresh();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setPollingImap(false);
    }
  };

  const saveCap = async () => {
    try {
      await api.updateSettings({ daily_send_limit: Number(capValue) || 100 });
      setCapOpen(false);
      await refresh();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center text-white shadow-sm shadow-indigo-200">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-lg text-slate-900 tracking-tight">Zoho Campaign Mailer</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                    Active Worker
                  </span>
                  <button
                    type="button"
                    onClick={() => setCapOpen(true)}
                    className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                  >
                    <Gauge className="w-3 h-3" />
                    <span>Daily Cap: {stats?.dailyCap || 100}/day</span>
                  </button>
                </div>
                <div className="text-xs text-slate-500 flex items-center space-x-2">
                  <span>Vite + Express Architecture</span>
                  <span>•</span>
                  <span className="font-mono text-[11px] text-slate-600">API: /api (Local Proxy)</span>
                </div>
              </div>
            </div>
            <nav className="hidden md:flex items-center space-x-1">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? t.id === "creator"
                          ? "bg-indigo-50 text-indigo-700 font-semibold shadow-xs border border-indigo-100"
                          : "bg-slate-100 text-slate-900 font-semibold shadow-xs"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{t.label}</span>
                    {t.id === "recipients" && stats?.pendingQueueCount > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-800 rounded-full">
                        {stats.pendingQueueCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="flex items-center space-x-2">
              <button
                onClick={pollImap}
                disabled={pollingImap}
                className="hidden sm:inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                <Inbox className="w-3.5 h-3.5" />
                <span>{pollingImap ? "Polling..." : "Poll IMAP"}</span>
              </button>
              <button
                onClick={() => triggerDispatch(true)}
                disabled={dispatching}
                className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{dispatching ? "Dispatching..." : "Dispatch now"}</span>
              </button>
            </div>
          </div>
          <div className="md:hidden flex overflow-x-auto space-x-1 pb-3">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium ${
                  tab === t.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {toast && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div
            className={`p-3.5 border rounded-xl text-xs flex items-center justify-between ${
              toast.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}
          >
            <span className="font-medium">{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-3 font-bold">
              x
            </button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {tab === "dashboard" && (
          <Dashboard
            stats={stats}
            campaigns={campaigns}
            logs={logs}
            loading={loading}
            onRefresh={refresh}
            onNavigateToCreator={() => setTab("creator")}
            onNavigateToRecipients={() => setTab("recipients")}
            onNavigateToAiIntel={() => setTab("ai")}
            onToggleCampaignStatus={async (id, status) => {
              await api.updateCampaignStatus(id, status);
              refresh();
            }}
            onDeleteCampaign={async (id) => {
              if (!window.confirm("Delete this campaign and its recipients?")) return;
              await api.deleteCampaign(id);
              refresh();
            }}
            onTriggerCampaign={(id) => triggerDispatch(true, id)}
            isDispatching={dispatching}
          />
        )}
        {tab === "creator" && (
          <CampaignCreator
            settings={settings}
            onCreated={() => {
              refresh();
              setTab("dashboard");
            }}
          />
        )}
        {tab === "recipients" && (
          <Recipients campaigns={campaigns} onRefresh={refresh} />
        )}
        {tab === "settings" && (
          <SettingsPage
            settings={settings}
            onSaved={async () => {
              await refresh();
              setToast({ type: "success", message: "Settings saved." });
            }}
          />
        )}
        {tab === "ai" && (
          <AiIntel
            onApplyToCampaign={() => {
              setTab("creator");
            }}
            onNavigateToTab={setTab}
          />
        )}
      </main>

      {capOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm p-5">
            <h3 className="text-sm font-bold text-slate-900">Daily send limit</h3>
            <p className="text-xs text-slate-500 mt-1">Hard cap across all campaigns for UTC day.</p>
            <input
              type="number"
              min="1"
              value={capValue}
              onChange={(e) => setCapValue(e.target.value)}
              className="mt-3 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <div className="mt-4 flex justify-end space-x-2">
              <button onClick={() => setCapOpen(false)} className="px-3 py-1.5 text-xs rounded-lg border">
                Cancel
              </button>
              <button onClick={saveCap} className="px-3 py-1.5 text-xs rounded-lg bg-slate-900 text-white">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
