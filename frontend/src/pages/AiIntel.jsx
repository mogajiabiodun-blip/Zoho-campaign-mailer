import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, RotateCcw, Copy, MapPin, Search, PenLine, ShieldCheck, Compass } from "lucide-react";
import { api } from "../api.js";

const ROLES = {
  maps_prospector: {
    title: "Maps Prospect Search Tool",
    description: "Structure local-business outreach lists. This clone does not scrape Google Maps automatically.",
    icon: MapPin,
    defaultGrounding: "maps",
    color: "rose",
    quickPrompts: [
      "Give me a CSV column plan for commercial solar installers in Austin, TX.",
      "How should I personalize emails using Google review count and address?",
      "Draft a first-line hook using {{Company}} and {{review_hook}}."
    ]
  },
  search_researcher: {
    title: "Search Grounding Intel Tool",
    description: "Company intel checklist for funding, news, and displacement angles.",
    icon: Search,
    defaultGrounding: "search",
    color: "blue",
    quickPrompts: [
      "What should I research before emailing a VP of Marketing at a B2B SaaS?",
      "Give Zoho Mail deliverability guidelines for 2026.",
      "Draft a displacement angle vs HubSpot for outbound."
    ]
  },
  copywriter: {
    title: "Outbound Copywriting Agent",
    description: "Cold email sequences, hooks, and subject lines with merge tags.",
    icon: PenLine,
    defaultGrounding: "none",
    color: "indigo",
    quickPrompts: [
      "Write a 3-touch cold email sequence for B2B SaaS VP of Marketing using {{Company}} and {{First_Name}}.",
      "Generate 5 high-open subject lines for commercial real estate brokers.",
      "Draft a gentle follow-up #1 after 3 days of no reply."
    ]
  },
  deliverability_advisor: {
    title: "Zoho Deliverability & DNS Advisor",
    description: "SPF, DKIM, DMARC, 8-10 AM windows, and warmup limits.",
    icon: ShieldCheck,
    defaultGrounding: "none",
    color: "emerald",
    quickPrompts: [
      "Audit checklist for Zoho SPF, DKIM, and DMARC.",
      "How should I warm up a fresh Zoho Mail account over 4 weeks?",
      "Why send between 8:00 AM and 10:00 AM recipient local time?"
    ]
  },
  general: {
    title: "Zoho Campaign Strategist",
    description: "Campaign configuration, list segmentation, and analytics.",
    icon: Compass,
    defaultGrounding: "none",
    color: "slate",
    quickPrompts: [
      "How should I segment a list across Eastern, Central, Mountain, and Pacific?",
      "What is an ideal reply rate for cold B2B outbound?",
      "Give me a checklist for launching 200 leads with this mailer."
    ]
  }
};

function mdLite(text) {
  const lines = String(text || "").split("\n");
  return lines.map((line, i) => {
    const html = line
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    if (line.startsWith("### ")) return <h3 key={i} className="text-sm font-bold mt-2" dangerouslySetInnerHTML={{ __html: html.slice(4) }} />;
    if (line.startsWith("## ")) return <h2 key={i} className="text-base font-bold mt-2" dangerouslySetInnerHTML={{ __html: html.slice(3) }} />;
    if (line.startsWith("- ")) return <li key={i} className="ml-4 list-disc" dangerouslySetInnerHTML={{ __html: html.slice(2) }} />;
    if (!line) return <div key={i} className="h-2" />;
    return <p key={i} className="text-sm leading-6" dangerouslySetInnerHTML={{ __html: html }} />;
  });
}

export default function AiIntel({ onApplyToCampaign }) {
  const [role, setRole] = useState("copywriter");
  const [grounding, setGrounding] = useState("none");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);
  const [messages, setMessages] = useState(() => [
    {
      id: "welcome",
      role: "assistant",
      content: "Welcome to the outbound AI & Intel suite. Tools run only when you send a prompt. Use Copywriter to draft a sequence, then Apply to campaign.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }
  ]);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = async (preset) => {
    const text = (preset || input).trim();
    if (!text || busy) return;
    const userMsg = {
      id: "u_" + Date.now(),
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setBusy(true);
    try {
      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const se = await api.sendChatMessage({
        message: text,
        history,
        role,
        model: "local-advisor",
        grounding
      });
      setMessages((m) => [
        ...m,
        {
          id: "a_" + Date.now(),
          role: "assistant",
          content: se.text,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          modelUsed: se.modelUsed,
          groundingUsed: se.groundingUsed
        }
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: "e_" + Date.now(),
          role: "assistant",
          content: `Error generating response: ${err.message}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          error: true
        }
      ]);
    } finally {
      setBusy(false);
    }
  };

  const current = ROLES[role];
  const Icon = current.icon;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start space-x-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 via-purple-600 to-blue-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">AI & Intel Suite (On-Demand Tools)</h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">Manual / On-Demand Only</span>
            </div>
            <p className="text-xs text-slate-600 mt-1">Copy, deliverability, and list-planning tools. They never harvest emails automatically.</p>
          </div>
        </div>
        <button
          onClick={() => {
            if (window.confirm("Reset conversation?")) {
              setMessages([{ id: "welcome_reset", role: "assistant", content: "Conversation reset. How can I help with your outbound campaign?", timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
            }
          }}
          className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold border rounded-lg"
        >
          <RotateCcw className="w-3.5 h-3.5" /><span>Reset</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {Object.entries(ROLES).map(([id, r]) => {
          const I = r.icon;
          return (
            <button
              key={id}
              onClick={() => {
                setRole(id);
                setGrounding(r.defaultGrounding);
              }}
              className={`text-left p-3 rounded-xl border ${role === id ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"}`}
            >
              <I className="w-4 h-4 text-indigo-600" />
              <div className="text-xs font-semibold mt-1">{r.title}</div>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center space-x-2 text-sm font-semibold">
          <Icon className="w-4 h-4 text-indigo-600" />
          <span>{current.title}</span>
        </div>
        <p className="text-xs text-slate-500 mt-1">{current.description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {current.quickPrompts.map((p) => (
            <button key={p} type="button" onClick={() => send(p)} className="text-[11px] px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 hover:bg-indigo-50">
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 space-y-3 max-h-[480px] overflow-auto">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "bg-indigo-600 text-white" : m.error ? "bg-rose-50 text-rose-800" : "bg-slate-50 text-slate-800"}`}>
                {m.role === "assistant" ? mdLite(m.content) : m.content}
                {m.role === "assistant" && !m.error && (
                  <div className="mt-2 flex items-center space-x-2">
                    <button
                      className="text-[11px] font-semibold text-indigo-700 inline-flex items-center space-x-1"
                      onClick={() => {
                        navigator.clipboard.writeText(m.content);
                        setCopied(m.id);
                        setTimeout(() => setCopied(null), 1500);
                      }}
                    >
                      <Copy className="w-3 h-3" /><span>{copied === m.id ? "Copied" : "Copy"}</span>
                    </button>
                    <button
                      className="text-[11px] font-semibold text-indigo-700"
                      onClick={() => {
                        const sub = m.content.match(/Subject:\s*([^\n\r]+)/i);
                        let body = m.content;
                        if (sub) body = m.content.replace(/Subject:\s*[^\n\r]+/i, "").trim();
                        onApplyToCampaign?.({ subject: sub ? sub[1].trim() : undefined, body });
                      }}
                    >
                      Apply to campaign
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="text-xs text-slate-500">Thinking...</div>}
          <div ref={endRef} />
        </div>
        <div className="border-t p-3 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Ask for a sequence, subject lines, or a Zoho warmup plan..."
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={() => send()} disabled={busy} className="p-2.5 bg-indigo-600 text-white rounded-lg disabled:opacity-50">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
