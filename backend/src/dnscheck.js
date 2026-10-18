import dns from "node:dns/promises";

const ZOHO_SPF_HINTS = ["zoho.com", "zohomail.com", "zoho.eu", "zohomail.eu", "zoho.in", "zoho.jp", "zohocorp.com"];
const ZOHO_MX_HINT = "zoho";
const DEFAULT_DKIM_SELECTORS = ["zoho", "zmail", "zohomail", "default", "dkim", "mail", "s1", "selector1", "selector2", "google"];

export function normalizeDomain(input) {
  let value = String(input || "").trim().toLowerCase();
  if (!value) return "";
  value = value.replace(/^mailto:/, "");
  if (value.includes("@")) value = value.split("@").pop();
  value = value.replace(/^[a-z]+:\/\//, "");
  value = value.replace(/\/.*$/, "");
  value = value.replace(/:\d+$/, "");
  value = value.replace(/^\.+|\.+$/g, "");
  return value;
}

function cleanRecord(record) {
  return record.replace(/^"|"$/g, "").replace(/\\"/g, '"').trim();
}

async function resolveTxtJoin(name) {
  const chunks = await dns.resolveTxt(name);
  return chunks.map((parts) => cleanRecord(parts.join(""))).filter(Boolean);
}

async function lookupTxt(name) {
  try {
    return { records: await resolveTxtJoin(name), error: null };
  } catch (err) {
    if (["ENOTFOUND", "ENODATA", "NXDOMAIN"].includes(err.code)) return { records: [], error: null };
    return { records: [], error: err.code || err.message };
  }
}

async function lookupMx(name) {
  try {
    return { records: await dns.resolveMx(name), error: null };
  } catch (err) {
    return { records: [], error: ["ENOTFOUND", "ENODATA", "NXDOMAIN"].includes(err.code) ? null : err.code || err.message };
  }
}

function checkMx(records, error) {
  if (error) return { status: "warn", records: [], message: `MX lookup failed (${error}). Receiving replies may still work if mail is hosted elsewhere.` };
  if (!records.length) return { status: "warn", records: [], message: "No MX records found. Sending still works, but replies to your From address may not be deliverable." };
  const sorted = records.slice().sort((a, b) => a.priority - b.priority).map((r) => `${r.exchange} (${r.priority})`);
  const isZoho = records.some((r) => String(r.exchange).toLowerCase().includes(ZOHO_MX_HINT));
  if (isZoho) return { status: "ok", records: sorted, message: "Zoho MX records found. Replies to your mailbox will be received." };
  return { status: "warn", records: sorted, message: "MX records found, but none point to Zoho. Confirm you can receive replies at your From address." };
}

function checkSpf(records, error) {
  if (error) return { status: "warn", records: [], message: `SPF lookup failed (${error}).` };
  const spf = records.find((r) => /^v=spf1\b/i.test(r));
  if (!spf) return { status: "fail", records: [], message: "No SPF record (v=spf1) found. Add one so receivers can verify your sending host.", expected: "v=spf1 include:zoho.com ~all" };
  const lower = spf.toLowerCase();
  const includesZoho = ZOHO_SPF_HINTS.some((h) => lower.includes(`include:${h}`));
  if (includesZoho) return { status: "ok", record: spf, records: [spf], message: "SPF present and authorized for Zoho." };
  return { status: "warn", record: spf, records: [spf], message: "SPF present but does not include a Zoho sending host. Add include:zoho.com (or include:zohomail.com).", expected: `${spf.replace(/\s*~?all\s*$/i, "").trim()} include:zoho.com ~all` };
}

async function checkDkim(domain, selectors) {
  const tried = [];
  for (const selector of selectors) {
    const name = `${selector}._domainkey.${domain}`;
    const { records } = await lookupTxt(name);
    const dkim = records.find((r) => /v=dkim1/i.test(r) || /(^|;)\s*p=/i.test(r));
    tried.push({ selector, found: !!dkim });
    if (dkim) {
      return { status: "ok", selector, record: dkim, tried, message: `DKIM key found at ${name}.` };
    }
  }
  return {
    status: "fail",
    selector: null,
    record: null,
    tried,
    message: "No DKIM key found for common selectors. Enable DKIM in Zoho Mail Control Panel, then publish the TXT record it gives you (or pass its selector).",
  };
}

function checkDmarc(records, error) {
  if (error) return { status: "warn", records: [], message: `DMARC lookup failed (${error}).` };
  const dmarc = records.find((r) => /^v=dmarc1\b/i.test(r));
  if (!dmarc) return { status: "fail", records: [], message: "No DMARC record (_dmarc). Start with a monitor-only policy so you can watch reports before enforcing.", expected: "v=DMARC1; p=none; rua=mailto:dmarc@yourdomain" };
  const policy = (dmarc.match(/;\s*p\s*=\s*([a-z]+)/i) || dmarc.match(/^v=DMARC1\s*;\s*p\s*=\s*([a-z]+)/i) || [])[1];
  const rua = (dmarc.match(/;\s*rua\s*=\s*([^;]+)/i) || [])[1];
  const p = (policy || "").toLowerCase();
  if (p === "reject" || p === "quarantine") {
    return { status: "warn", policy: p, rua: rua || null, record: dmarc, records: [dmarc], message: `DMARC present with strict policy p=${p}. Ensure SPF/DKIM fully pass before enforcing.` };
  }
  return { status: "ok", policy: p || "none", rua: rua || null, record: dmarc, records: [dmarc], message: `DMARC present (p=${p || "none"}).` };
}

export async function checkDomainDeliverability(input, options = {}) {
  const domain = normalizeDomain(input);
  if (!domain || !domain.includes(".")) {
    return { domain, ok: false, error: "Enter a valid domain (for example yourdomain.com)." };
  }
  const selectors = Array.from(new Set([...(options.selectors || []), ...DEFAULT_DKIM_SELECTORS].map((s) => String(s).trim().toLowerCase()).filter(Boolean)));

  const [txtAll, mx, dmarcTxt, dkim] = await Promise.all([
    lookupTxt(domain),
    lookupMx(domain),
    lookupTxt(`_dmarc.${domain}`),
    checkDkim(domain, selectors)
  ]);

  const results = {
    domain,
    checkedAt: new Date().toISOString(),
    mx: checkMx(mx.records, mx.error),
    spf: checkSpf(txtAll.records, txtAll.error),
    dkim,
    dmarc: checkDmarc(dmarcTxt.records, dmarcTxt.error)
  };

  const checks = ["mx", "spf", "dkim", "dmarc"];
  const ok = checks.filter((k) => results[k].status === "ok").length;
  const warn = checks.filter((k) => results[k].status === "warn").length;
  const fail = checks.filter((k) => results[k].status === "fail").length;
  results.summary = {
    ok,
    warn,
    fail,
    total: checks.length,
    allGood: fail === 0 && warn <= 1
  };
  results.guidance = buildGuidance(results);
  return results;
}

function buildGuidance(results) {
  const tips = [];
  if (results.spf.status !== "ok") tips.push(results.spf.expected || "Publish an SPF record that includes your Zoho sending host.");
  if (results.dkim.status !== "ok") tips.push("Enable DKIM in Zoho Mail Control Panel and publish the selector TXT record it provides.");
  if (results.dmarc.status !== "ok" && results.dmarc.status !== "warn") tips.push(results.dmarc.expected);
  if (results.mx.status !== "ok") tips.push("Point your domain MX records at Zoho so replies reach your mailbox.");
  if (!tips.length) tips.push("All core records look good. Warm up slowly and keep sending inside your daily window.");
  return tips;
}
