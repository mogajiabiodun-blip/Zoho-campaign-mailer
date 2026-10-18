export const TIME_ZONES = [
  { code: "LOCAL", iana: "LOCAL", label: "Local Device Time (Automatic)", abbr: "Local", utcOffset: "Device", region: "Local" },
  { code: "EST", iana: "America/New_York", label: "Eastern Time (EST/EDT) - New York", abbr: "ET", utcOffset: "UTC-5 / UTC-4", region: "US" },
  { code: "CST", iana: "America/Chicago", label: "Central Time (CST/CDT) - Chicago", abbr: "CT", utcOffset: "UTC-6 / UTC-5", region: "US" },
  { code: "MST", iana: "America/Denver", label: "Mountain Time (MST/MDT) - Denver", abbr: "MT", utcOffset: "UTC-7 / UTC-6", region: "US" },
  { code: "PST", iana: "America/Los_Angeles", label: "Pacific Time (PST/PDT) - Los Angeles", abbr: "PT", utcOffset: "UTC-8 / UTC-7", region: "US" },
  { code: "AKST", iana: "America/Anchorage", label: "Alaska Time (AKST/AKDT) - Anchorage", abbr: "AKT", utcOffset: "UTC-9 / UTC-8", region: "US" },
  { code: "HST", iana: "Pacific/Honolulu", label: "Hawaii Time (HST) - Honolulu", abbr: "HT", utcOffset: "UTC-10", region: "US" },
  { code: "GMT", iana: "Europe/London", label: "London / UK Time (GMT/BST)", abbr: "GMT", utcOffset: "UTC+0 / UTC+1", region: "Europe" },
  { code: "CET", iana: "Europe/Paris", label: "Central Europe (CET/CEST) - Paris, Berlin", abbr: "CET", utcOffset: "UTC+1 / UTC+2", region: "Europe" },
  { code: "EET", iana: "Africa/Cairo", label: "Eastern Europe / Egypt (EET) - Cairo", abbr: "EET", utcOffset: "UTC+2 / UTC+3", region: "Africa/Middle East" },
  { code: "WAT", iana: "Africa/Lagos", label: "West Africa Time (WAT) - Lagos, Abuja", abbr: "WAT", utcOffset: "UTC+1", region: "Africa" },
  { code: "SAST", iana: "Africa/Johannesburg", label: "South Africa Time (SAST) - Johannesburg", abbr: "SAST", utcOffset: "UTC+2", region: "Africa" },
  { code: "EAT", iana: "Africa/Nairobi", label: "East Africa Time (EAT) - Nairobi", abbr: "EAT", utcOffset: "UTC+3", region: "Africa" },
  { code: "GST", iana: "Asia/Dubai", label: "Gulf Standard Time (GST) - Dubai", abbr: "GST", utcOffset: "UTC+4", region: "Middle East" },
  { code: "IST", iana: "Asia/Kolkata", label: "India Standard Time (IST) - New Delhi, Mumbai", abbr: "IST", utcOffset: "UTC+5:30", region: "Asia" },
  { code: "SGT", iana: "Asia/Singapore", label: "Singapore / Hong Kong (SGT) - Singapore", abbr: "SGT", utcOffset: "UTC+8", region: "Asia" },
  { code: "JST", iana: "Asia/Tokyo", label: "Japan Standard Time (JST) - Tokyo", abbr: "JST", utcOffset: "UTC+9", region: "Asia" },
  { code: "AEST", iana: "Australia/Sydney", label: "Australian Eastern (AEST/AEDT) - Sydney", abbr: "AEST", utcOffset: "UTC+10 / UTC+11", region: "Australia" },
  { code: "UTC", iana: "UTC", label: "Coordinated Universal Time (UTC)", abbr: "UTC", utcOffset: "UTC+0", region: "Global" }
];

export function resolveIana(tz) {
  if (!tz || tz === "LOCAL") {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
    } catch {
      return "America/New_York";
    }
  }
  const match = TIME_ZONES.find((z) => z.code === tz || z.iana === tz);
  return match && match.iana !== "LOCAL" ? match.iana : tz;
}

function partsInZone(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const bag = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return bag;
}

function parseHm(value) {
  const [h, m] = String(value || "08:00").split(":").map((n) => Number(n) || 0);
  return h * 60 + m;
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function isAllDayWindow(start, end) {
  const s = String(start || "").trim().toLowerCase();
  const e = String(end || "").trim().toLowerCase();
  return s === "all" || s === "anytime" || s === "24/7" || s === "none" || s === "24h" || s === e || (s === "00:00" && (e === "23:59" || e === "24:00" || e === "00:00"));
}

export function evaluateWindow({
  timeZone,
  windowStart = "08:00",
  windowEnd = "10:00",
  workdaysOnly = true,
  allDay = false
} = {}) {
  const iana = resolveIana(timeZone);
  const now = new Date();
  const bag = partsInZone(now, iana);
  const hour = Number(bag.hour === "24" ? 0 : bag.hour);
  const minute = Number(bag.minute);
  const second = Number(bag.second);
  const currentMinutes = hour * 60 + minute;
  const dayName = bag.weekday;
  const isWorkday = dayName !== "Sat" && dayName !== "Sun";
  const startMin = parseHm(windowStart);
  const endMin = parseHm(windowEnd);
  const allDayWindow = allDay || isAllDayWindow(windowStart, windowEnd);
  const isWithinTimeWindow = allDayWindow || (currentMinutes >= startMin && currentMinutes <= endMin);
  const reasons = [];
  if (workdaysOnly && !isWorkday) {
    reasons.push(`Local target day (${dayName}) is a weekend. Dispatch resumes next weekday at ${windowStart}.`);
  }
  if (!allDayWindow && currentMinutes < startMin) {
    reasons.push(
      `Local target time (${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${iana.split("/").pop()}) is before dispatch window (${windowStart} – ${windowEnd}). Opens in ${formatDuration(startMin - currentMinutes)} (or select "Anytime" to dispatch now).`
    );
  } else if (!allDayWindow && currentMinutes > endMin) {
    reasons.push(
      `Local target time (${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${iana}) has passed today's dispatch window (${windowStart} – ${windowEnd}). Next window opens next active day at ${windowStart} (or select "Anytime" to dispatch now).`
    );
  }
  const canDispatch = reasons.length === 0 && (allDayWindow || isWithinTimeWindow) && (!workdaysOnly || isWorkday);
  const localTimeFormatted = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  const localDateFormatted = new Intl.DateTimeFormat("en-US", {
    timeZone: iana,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(now);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dayName);
  return {
    timeZone: iana,
    localTimeFormatted,
    localDateFormatted,
    dayOfWeek: weekdayIndex,
    dayName,
    isWorkday,
    currentMinutes,
    windowStartMinutes: startMin,
    windowEndMinutes: endMin,
    isWithinTimeWindow,
    isAllDayWindow: allDayWindow,
    canDispatch,
    reasons
  };
}

export function timezoneStatuses(settings) {
  return TIME_ZONES.filter((z) => z.code !== "LOCAL").map((z) => {
    const evaluation = evaluateWindow({
      timeZone: z.iana,
      windowStart: settings.time_window_start,
      windowEnd: settings.time_window_end,
      workdaysOnly: !!settings.default_workdays_only,
      allDay: !!settings.all_day_dispatch
    });
    return { ...z, ...evaluation };
  });
}
