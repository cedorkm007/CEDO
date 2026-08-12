# CEDO Website

A Figma Make–exported React + TypeScript task management app backed by Google Sheets and Google Drive.

---

## Tech Stack

- **React 18** + **TypeScript**
- **Vite 6** (dev server + build)
- **Tailwind CSS v4** (via `@tailwindcss/vite`)
- **shadcn/ui** component primitives (Radix UI)
- **Google Sheets v4** — data storage
- **Google Drive v3** — image/evidence storage
- **GIS (Google Identity Services)** — OAuth 2.0

---

## Prerequisites

1. Node.js ≥ 20 and [pnpm](https://pnpm.io) installed
2. A Google Cloud project with:
   - Sheets API enabled
   - Drive API enabled
   - OAuth 2.0 Client ID (Web application type)
   - `http://localhost:5173` added to Authorised JavaScript origins
3. A Google Spreadsheet created and its ID noted

---

## Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment variables
cp .env.example .env.local
# Edit .env.local and fill in your values:
#   VITE_GOOGLE_CLIENT_ID=...
#   VITE_GOOGLE_SPREADSHEET_ID=...
#   VITE_GOOGLE_DRIVE_FOLDER_ID=...   (optional)

# 3. Start the dev server
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Google Spreadsheet Schema

Create the following sheets (tabs) in your spreadsheet. Each column header must match exactly:

| Sheet | Columns (A → …) |
|-------|----------------|
| **Users** | id, username, lastName, firstName, middleName, suffix, nickname, designation, position, mobilePhone, email, password, isAdmin, profilePicture |
| **MonthlyTasks** | id, userId, title, month, year, status |
| **WeeklyTasks** | id, monthlyTaskId, title, weekNumber, month, year, status |
| **Deliverables** | id, weeklyTaskId, title, status |
| **DailyTasks** | id, weeklyTaskId, title, deliverable, date, status, images, submittedAt, adminNote |
| **Submissions** | id, userId, userName, dailyTaskId, weeklyTaskId, monthlyTaskId, taskTitle, deliverable, parentTitle, evidence, submittedAt, status, adminNote |
| **LeaveRequests** | id, userId, userName, type, date, timeFrom, timeTo, reason, submittedAt, status, adminNote |
| **Notifications** | id, type, userId, userName, title, message, timestamp, read, referenceId |

> **Tip:** The `insertRecord()` helper in `src/lib/sheets.ts` will auto-write the header row if a sheet is empty the first time a record is inserted.

---

## Project Structure

```
src/
├── app/
│   ├── App.tsx                  # Main application (Figma export)
│   └── components/
│       ├── figma/               # Figma-specific helpers
│       └── ui/                  # shadcn/ui component library
├── imports/                     # Static assets (logo, etc.)
├── lib/
│   ├── googleAuth.ts            # OAuth 2.0 via GIS token model
│   ├── googleTypes.d.ts         # Ambient type declarations for gapi
│   ├── useGoogleAuth.ts         # React hook for auth state
│   ├── sheets.ts                # Typed Google Sheets CRUD helpers
│   └── drive.ts                 # Google Drive upload helpers
└── styles/
    ├── index.css                # Entry stylesheet
    ├── tailwind.css             # Tailwind v4 setup
    ├── theme.css                # Design tokens
    ├── fonts.css                # Font imports
    └── globals.css              # Global overrides
```

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | Type-check + production build |
| `pnpm preview` | Preview the production build |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Auto-fix ESLint issues |
| `pnpm type-check` | TypeScript check without emitting |

---

## Connecting the UI to Google Sheets

The `src/lib/` helpers expose everything you need. Example pattern:

```tsx
import { useGoogleAuth } from '@/lib/useGoogleAuth'
import { getAll, insertRecord, updateRecord, SHEETS } from '@/lib/sheets'

function MyComponent() {
  const { isReady, isSignedIn, signIn } = useGoogleAuth()

  const loadUsers = async () => {
    const users = await getAll(SHEETS.USERS)
    console.log(users)
  }

  if (!isReady) return <p>Loading Google APIs…</p>
  if (!isSignedIn) return <button onClick={signIn}>Sign in with Google</button>
  return <button onClick={loadUsers}>Load Users</button>
}
```

---

## Authentication & Admin Accounts

Sign-in, registration, and password changes are handled entirely by
**Supabase Auth** — passwords are hashed and stored server-side by Supabase,
never in this app's own `users` table and never in plaintext anywhere.

### One-time setup (per Supabase project)

1. Run `supabase_migration_divisions.sql` (if you haven't already).
2. Run `supabase_migration_auth_and_admins.sql` in the Supabase SQL editor.
   This drops the old plaintext `password` column and turns on Row Level
   Security. Read the comments at the top of that file first — it deletes
   any leftover demo/seed rows that aren't backed by a real Supabase Auth
   account.
3. Provision admin accounts:
   ```bash
   cp .env.scripts.example .env.scripts
   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Settings → API)
   npm run seed:admins
   ```
   This creates 9 admin accounts — 1 department-wide Super Admin and 2
   Division Admins each for LITM, SEAD, Administrative & Finance, and
   EPDPM — and prints their generated passwords **once**, in your terminal.
   Save them to a password manager immediately; the script never writes
   them to a file. `.env.scripts` is git-ignored and must never be
   committed or shipped to the browser.
4. Everyone should change their password after first login: **Profile →
   Security → Change Password**.

Regular staff accounts are created by self-registration on the sign-in
screen and don't need the script.
