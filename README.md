# Zoho Campaign Mailer

Local clone of the Zoho campaign mailer: CSV/XLSX outreach, timezone windows, Zoho SMTP sending, IMAP reply polling, suppressions, and an on-demand copy assistant.

## What it does

- Upload Excel with columns **Business Name**, **Email Address**, **Body**
- Sends Email 1 one recipient after another, using each row's pre-written body
- Upload Email 2 / Email 3 the same way for Follow-up 1 and Follow-up 2 (matched by email)
- Send through Zoho Mail SMTP (`smtppro.zoho.com:465`) with an app password
- Daily send cap, seconds-between-emails interval, suppression list
- **Recent activity** on the dashboard: download the log as CSV, delete a single entry, or clear all

The original hosted app at `zoho-campaign-mailer.onrender.com` exposed live SMTP secrets on `/api/settings`. This clone stores credentials only in your local `data/campaigns.db`. Do not reuse anyone else's mailbox password.

## Quick start

```bash
# Backend
cd backend
npm install
npm start

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Or from the repo root:

```bash
chmod +x start.sh
./start.sh
```

Frontend: http://localhost:5173 (proxies `/api` to the backend on port 3001).

## Send mail for real

1. Open **Settings**
2. From email + SMTP user = your Zoho mailbox
3. Host `smtppro.zoho.com`, port `465`
4. Password = Zoho **app password** (Mail > Security), not the account password
5. **Save Settings**, then **Test SMTP**
6. **New Campaign** → upload Excel (Business Name, Email Address, Body) → create. Sending starts immediately, one row after another.
7. Optionally upload Follow-up 1 and Follow-up 2 sheets with the same three columns.

### Daily pacing
Set **Emails per day** (new Email 1 sends only) and a window (default 08:00–10:00). Follow-ups send in the same window and do not count against the daily new cap. Use the timer icon on a Dashboard campaign to change the seconds-between-emails interval while it runs.

## Bounces and replies (automatic)

Every 15 minutes the backend polls Zoho IMAP (`INBOX` + `Trash`) and:

- **Hard bounces** (`mailer-daemon`, `5.x.x`) → recipient marked `bounced`, follow-ups cancelled, email added to the suppression list.
- **Soft bounces** (`4.x.x`) → recipient marked `bounced`, follow-ups cancelled, not suppressed (retryable).
- **Replies** → recipient marked `replied` and all pending follow-ups cancelled.
- **Reply STOP / unsubscribe** → recipient suppressed as well.

Polling never crashes the server on IMAP errors; failures are logged as `imap/error`. Set `IMAP_POLL_MINUTES` to change the interval.

## Zoho DNS (inbox placement)

Open **Settings → Email deliverability (SPF / DKIM / DMARC)** and click **Run check**. It looks up the domain of your From address (or one you type) and reports:

- **SPF** — present and authorized for Zoho (`include:zoho.com` / `zohomail.com`)
- **DKIM** — a valid key at a common selector (Zoho's default is `zoho`); it tries several selectors, and you can supply your own
- **DMARC** — present at `_dmarc`, with the policy and `rua` report address parsed
- **MX** — Zoho MX records so replies reach your mailbox

Each row is Pass / Warning / Missing with the detected record and a fix hint.

- SPF includes Zoho
- DKIM enabled in Zoho Mail Control Panel
- DMARC start with `p=none`
- Warm up: ~20/day week 1, then raise the daily cap
- Keep 8:00–10:00 AM recipient-local and 10–30s between messages

## Optional env

```text
PORT=3001
PUBLIC_BASE_URL=http://localhost:5173
USER_LLM_API_KEY=
USER_LLM_BASE_URL=
USER_LLM_MODEL=
```

Without LLM env vars, the AI tab still returns local copy/deliverability templates.

## Deploy to GitHub + Render

This is a two-part app: an Express backend (sending, scheduler, IMAP polling, SQLite) and a static React frontend. They deploy as two services.

### 1. Push to GitHub

```bash
cd /workspace
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/zoho-campaign-mailer.git
git push -u origin main
```

`data/*.db`, `node_modules`, `dist`, and `.env` are already in `.gitignore`, so no credentials are committed.

### 2. Deploy on Render

The included `render.yaml` defines both services. In Render: **New > Blueprint**, connect the repo, and Render reads `render.yaml`.

Or create the two services manually:

**Backend (Web Service)**
- Root directory: `backend`
- Build: `npm install`  Start: `npm start`
- Health check path: `/api/health`
- Add a **Disk** mounted at `/var/data` (required - SQLite lives there)
- Env: `DATABASE_PATH=/var/data/campaigns.db`, `IMAP_POLL_MINUTES=15`, `PUBLIC_BASE_URL=https://<backend-url>`

**Frontend (Static Site)**
- Root directory: `frontend`
- Build: `npm install && npm run build`  Publish: `dist`
- Add rewrite `/*` -> `/index.html` (SPA)
- Env: `VITE_BACKEND_URL=https://<backend-url>` (set at build time)

### 3. Important notes

- **Do not use Render's free instance for the backend.** Free web services sleep after ~15 minutes of inactivity, which stops the scheduler and IMAP poller. Use a paid instance (Starter) plus a persistent disk.
- After deploying, open the app's **Settings**, enter your Zoho credentials, and **Test SMTP** before your first send.
- Set DNS (SPF/DKIM/DMARC) for your sending domain; the in-app check verifies it.
- The Settings page stores live mailbox credentials and is currently unauthenticated. Add authentication and HTTPS before exposing it to real traffic.
