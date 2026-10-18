const backend = (import.meta.env.VITE_BACKEND_URL || "").trim().replace(/\/$/, "");

export function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${backend}${p}`;
}

async function request(path, options = {}, retries = 2) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  try {
    const res = await fetch(apiUrl(path), { ...options, headers });
    if (!res.ok) {
      if ([502, 503, 504].includes(res.status) && retries > 0) {
        await new Promise((r) => setTimeout(r, 1500));
        return request(path, options, retries - 1);
      }
      let message = `Server returned status ${res.status}: ${res.statusText}`;
      try {
        const json = await res.json();
        if (json.error) message = json.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const json = await res.json();
    if (json.success === false) throw new Error(json.error || "Request failed");
    return json.data !== undefined ? json.data : json;
  } catch (err) {
    if (["Failed to fetch", "NetworkError", "502"].some((s) => String(err.message || "").includes(s)) && retries > 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return request(path, options, retries - 1);
    }
    throw err;
  }
}

export const api = {
  getStats: () => request("/api/stats"),
  getTimeZones: () => request("/api/timezones"),
  getCampaigns: () => request("/api/campaigns"),
  getCampaign: (id) => request(`/api/campaigns/${id}`),
  getExportCampaignsCsvUrl: () => apiUrl("/api/campaigns/export/csv"),
  createCampaign: (payload) => request("/api/campaigns", { method: "POST", body: JSON.stringify(payload) }),
  updateCampaignStatus: (id, status) =>
    request(`/api/campaigns/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  updateCampaignInterval: (id, sending_interval_sec) =>
    request(`/api/campaigns/${id}/interval`, { method: "PATCH", body: JSON.stringify({ sending_interval_sec }) }),
  updateCampaignSchedule: (id, payload) =>
    request(`/api/campaigns/${id}/schedule`, { method: "PATCH", body: JSON.stringify(payload) }),
  updateCampaignTags: (id, tags) =>
    request(`/api/campaigns/${id}/tags`, { method: "PATCH", body: JSON.stringify({ tags }) }),
  deleteCampaign: (id) => request(`/api/campaigns/${id}`, { method: "DELETE" }),
  uploadOptOutEmails: (emails, reason) =>
    request("/api/recipients/unsubscribe", { method: "POST", body: JSON.stringify({ emails, reason }) }),
  getOptOutList: () => request("/api/recipients/unsubscribed"),
  deleteOptOutEmail: (email) => request(`/api/recipients/unsubscribe/${encodeURIComponent(email)}`, { method: "DELETE" }),
  getRecipients: (q = {}) => {
    const t = new URLSearchParams();
    if (q.status) t.append("status", q.status);
    if (q.campaign_id) t.append("campaign_id", q.campaign_id);
    if (q.search) t.append("search", q.search);
    if (q.limit) t.append("limit", String(q.limit));
    return request(`/api/recipients?${t.toString()}`);
  },
  deleteRecipient: (id) => request(`/api/recipients/${id}`, { method: "DELETE" }),
  bulkDeleteRecipients: (ids) => request("/api/recipients/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),
  clearCampaignRecipients: (id, status) => {
    const q = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
    return request(`/api/campaigns/${id}/recipients${q}`, { method: "DELETE" });
  },
  importRecipients: (id, recipients) =>
    request(`/api/campaigns/${id}/recipients`, { method: "POST", body: JSON.stringify({ recipients }) }),
  importFollowups: (id, payload) =>
    request(`/api/campaigns/${id}/followups`, { method: "POST", body: JSON.stringify(payload) }),
  getUnsubscribedList: () => request("/api/recipients/unsubscribed"),
  unsubscribeEmails: (emails, reason) =>
    request("/api/recipients/unsubscribe", { method: "POST", body: JSON.stringify({ emails, reason }) }),
  resubscribeEmail: (email) => request(`/api/recipients/unsubscribe/${encodeURIComponent(email)}`, { method: "DELETE" }),
  clearAllProspectData: () => request("/api/database/clear-prospects", { method: "POST" }),
  getSettings: () => request("/api/settings"),
  updateSettings: (payload) => request("/api/settings", { method: "POST", body: JSON.stringify(payload) }),
  checkDns: (domain, selector) => {
    const t = new URLSearchParams();
    if (domain) t.append("domain", domain);
    if (selector) t.append("selector", selector);
    const s = t.toString();
    return request(`/api/dns/check${s ? `?${s}` : ""}`);
  },
  triggerScheduler: (forceWindow = false, campaignId) =>
    request("/api/scheduler/trigger", { method: "POST", body: JSON.stringify({ forceWindow, campaignId }) }),
  pollImapReplies: () => request("/api/imap/poll", { method: "POST" }),
  simulateReply: (recipientId, snippet) =>
    request("/api/imap/simulate-reply", { method: "POST", body: JSON.stringify({ recipientId, snippet }) }),
  testZoho: (payload) => request("/api/zoho/test", { method: "POST", body: payload ? JSON.stringify(payload) : undefined }),
  testZohoImap: (payload) =>
    request("/api/zoho/test-imap", { method: "POST", body: payload ? JSON.stringify(payload) : undefined }),
  exchangeZohoOAuthCode: (payload) =>
    request("/api/zoho/oauth/exchange", { method: "POST", body: JSON.stringify(payload) }),
  getZohoOAuthUrl: (q = {}) => {
    const t = new URLSearchParams();
    if (q.clientId) t.append("clientId", q.clientId);
    if (q.domain) t.append("domain", q.domain);
    if (q.redirectUri) t.append("redirectUri", q.redirectUri);
    const s = t.toString();
    return request(`/api/zoho/oauth/url${s ? `?${s}` : ""}`);
  },
  setZohoRefreshTokenDirect: (refreshToken) =>
    request("/api/zoho/oauth/set-token", { method: "POST", body: JSON.stringify({ refreshToken }) }),
  getLogs: () => request("/api/logs"),
  getAllLogs: () => request("/api/logs?limit=all"),
  deleteLog: (id) => request(`/api/logs/${id}`, { method: "DELETE" }),
  bulkDeleteLogs: (ids) => request("/api/logs/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),
  clearLogs: (q = {}) => {
    const t = new URLSearchParams();
    if (q.type) t.append("type", q.type);
    if (q.campaign_id) t.append("campaign_id", q.campaign_id);
    const s = t.toString();
    return request(`/api/logs${s ? `?${s}` : ""}`, { method: "DELETE" });
  },
  getExportLogsCsvUrl: (q = {}) => {
    const t = new URLSearchParams();
    if (q.type) t.append("type", q.type);
    if (q.campaign_id) t.append("campaign_id", q.campaign_id);
    const s = t.toString();
    return `/api/logs/export/csv${s ? `?${s}` : ""}`;
  },
  getReplyHeatmap: (campaignId) => {
    const t = new URLSearchParams();
    if (campaignId && campaignId !== "all") t.append("campaign_id", campaignId);
    const s = t.toString();
    return request(`/api/analytics/reply-heatmap${s ? `?${s}` : ""}`);
  },
  getClickAnalytics: (campaignId) => {
    const t = new URLSearchParams();
    if (campaignId && campaignId !== "all") t.append("campaign_id", campaignId);
    const s = t.toString();
    return request(`/api/analytics/clicks${s ? `?${s}` : ""}`);
  },
  simulateClick: (payload) => request("/api/track/simulate-click", { method: "POST", body: JSON.stringify(payload || {}) }),
  sendChatMessage: (payload) => request("/api/chat", { method: "POST", body: JSON.stringify(payload) })
};

export const TIME_ZONES = [
  { code: "LOCAL", iana: "LOCAL", label: "Local Device Time (Automatic)", abbr: "Local" },
  { code: "EST", iana: "America/New_York", label: "Eastern Time (EST/EDT) - New York", abbr: "ET" },
  { code: "CST", iana: "America/Chicago", label: "Central Time (CST/CDT) - Chicago", abbr: "CT" },
  { code: "MST", iana: "America/Denver", label: "Mountain Time (MST/MDT) - Denver", abbr: "MT" },
  { code: "PST", iana: "America/Los_Angeles", label: "Pacific Time (PST/PDT) - Los Angeles", abbr: "PT" },
  { code: "AKST", iana: "America/Anchorage", label: "Alaska Time (AKST/AKDT) - Anchorage", abbr: "AKT" },
  { code: "HST", iana: "Pacific/Honolulu", label: "Hawaii Time (HST) - Honolulu", abbr: "HT" },
  { code: "GMT", iana: "Europe/London", label: "London / UK Time (GMT/BST)", abbr: "GMT" },
  { code: "CET", iana: "Europe/Paris", label: "Central Europe (CET/CEST) - Paris, Berlin", abbr: "CET" },
  { code: "EET", iana: "Africa/Cairo", label: "Eastern Europe / Egypt (EET) - Cairo", abbr: "EET" },
  { code: "WAT", iana: "Africa/Lagos", label: "West Africa Time (WAT) - Lagos, Abuja", abbr: "WAT" },
  { code: "SAST", iana: "Africa/Johannesburg", label: "South Africa Time (SAST) - Johannesburg", abbr: "SAST" },
  { code: "EAT", iana: "Africa/Nairobi", label: "East Africa Time (EAT) - Nairobi", abbr: "EAT" },
  { code: "GST", iana: "Asia/Dubai", label: "Gulf Standard Time (GST) - Dubai", abbr: "GST" },
  { code: "IST", iana: "Asia/Kolkata", label: "India Standard Time (IST) - New Delhi, Mumbai", abbr: "IST" },
  { code: "SGT", iana: "Asia/Singapore", label: "Singapore / Hong Kong (SGT) - Singapore", abbr: "SGT" },
  { code: "JST", iana: "Asia/Tokyo", label: "Japan Standard Time (JST) - Tokyo", abbr: "JST" },
  { code: "AEST", iana: "Australia/Sydney", label: "Australian Eastern (AEST/AEDT) - Sydney", abbr: "AEST" },
  { code: "UTC", iana: "UTC", label: "Coordinated Universal Time (UTC)", abbr: "UTC" }
];

export function formatInterval(sec, longForm = false) {
  const r = Math.max(0, Math.round(sec));
  if (r < 60) return longForm ? `${r} second${r === 1 ? "" : "s"}` : `${r}s`;
  if (r < 3600) {
    const m = Math.floor(r / 60);
    const s = r % 60;
    if (s === 0) return longForm ? `${m} minute${m === 1 ? "" : "s"}` : `${m}m`;
    return longForm ? `${m} min ${s} sec` : `${m}m ${s}s`;
  }
  const h = Math.floor(r / 3600);
  const m = Math.floor((r % 3600) / 60);
  if (m === 0) return longForm ? `${h} hour${h === 1 ? "" : "s"}` : `${h}h`;
  return longForm ? `${h} hr ${m} min` : `${h}h ${m}m`;
}

export function interpolate(template, fields = {}) {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_\s-]+?)\s*\}\}|\{\s*([a-zA-Z0-9_\s-]+?)\s*\}/g, (raw, a, b) => {
    const key = (a || b || "").trim();
    if (!key) return raw;
    if (fields[key] != null) return String(fields[key]);
    const norm = key.toLowerCase().replace(/[\s_-]+/g, "");
    for (const k of Object.keys(fields)) {
      if (k.toLowerCase().replace(/[\s_-]+/g, "") === norm && fields[k] != null) return String(fields[k]);
    }
    return raw;
  });
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
