import * as XLSX from "xlsx";
import { EMAIL_RE } from "./api.js";

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const EMAIL_KEYS = ["emailaddress", "email", "e-mail", "mail", "recipient", "to"];
const NAME_KEYS = ["businessname", "business", "company", "companyname", "name", "organization"];
const BODY_KEYS = ["prewrittenbodyemail", "prewrittenbody", "emailbody", "bodyemail", "body", "message", "content", "email"];
const SUBJECT_KEYS = ["subject", "emailsubject", "subjectline"];

export function guessColumn(headers, keys) {
  const scored = headers.map((h) => {
    const n = norm(h);
    let score = 0;
    keys.forEach((k, i) => {
      if (n === k) score = Math.max(score, 100 - i);
      else if (n.includes(k) || k.includes(n)) score = Math.max(score, 60 - i);
    });
    return { h, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].h : "";
}

export function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("The workbook contains no sheets.");
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  if (!rows.length) throw new Error("The uploaded file contains no data rows.");
  return { headers: Object.keys(rows[0]), rows };
}

export function readSpreadsheetFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        resolve(parseWorkbook(ev.target.result));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read spreadsheet file."));
    reader.readAsArrayBuffer(file);
  });
}

export function mapOutreachRows(headers, rows, cols = {}) {
  const emailCol = cols.emailCol || guessColumn(headers, EMAIL_KEYS) || headers[0];
  const nameCol = cols.nameCol || guessColumn(headers, NAME_KEYS);
  const bodyCol = cols.bodyCol || guessColumn(headers.filter((h) => h !== emailCol), BODY_KEYS);
  const subjectCol = cols.subjectCol || guessColumn(headers, SUBJECT_KEYS);
  const mapped = rows.map((row, index) => {
    const email = String(row[emailCol] || "").trim();
    const businessName = nameCol ? String(row[nameCol] || "").trim() : "";
    const body = bodyCol ? String(row[bodyCol] || "").trim() : "";
    const subject = subjectCol
      ? String(row[subjectCol] || "").trim()
      : businessName
        ? `Quick note for ${businessName}`
        : "Quick note";
    return {
      rowNumber: index + 1,
      email,
      businessName,
      subject,
      body,
      valid: EMAIL_RE.test(email) && !!body,
      invalidReason: !EMAIL_RE.test(email)
        ? "Missing or invalid email"
        : !body
          ? "Missing email body"
          : "",
      custom_fields: {
        ...row,
        "Business Name": businessName,
        Company: businessName,
        Email: email
      }
    };
  });
  return {
    emailCol,
    nameCol,
    bodyCol,
    subjectCol,
    mapped,
    valid: mapped.filter((r) => r.valid),
    invalid: mapped.filter((r) => !r.valid)
  };
}

export function downloadSampleSheet(filename = "outreach_template.xlsx") {
  const rows = [
    {
      "Business Name": "Example Plumbing Co",
      "Email Address": "owner@example.com",
      "Body": "Hi Example Plumbing Co,\n\nI wanted to share a short note about getting more booked jobs from your existing reviews.\n\nWould a 10-minute look this week be useful?"
    }
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recipients");
  XLSX.writeFile(wb, filename);
}
