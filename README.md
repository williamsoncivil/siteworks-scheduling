# Williamson Scheduling

Construction scheduling web app for Williamson Civil Construction. Manages jobs, phases, team schedules, documents, messages, and production logs — with conflict detection for double-booked workers.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env file
cp .env.example .env

# 3. Run database migration
npx prisma migrate dev --name init

# 4. Seed the database
npm run db:seed

# 5. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Login Credentials

| Name | Email | Password | Role |
|------|-------|----------|------|
| Tom | tom@williamsoncivil.com | admin123 | Admin |
| Dan | dan@williamsoncivil.com | pass123 | Employee |
| Mike - Mike's Plumbing | mike@mikesplumbing.com | pass123 | Subcontractor |

## Features

### 📋 Jobs
- Create, edit, and archive jobs with color coding
- Copy a job (duplicates all phases) to quickly start similar projects
- Tabbed detail view per job

### 📐 Phases
- Add phases to jobs with descriptions
- Reorder with up/down buttons

### 📅 Schedule
- Assign team members to jobs/phases on specific dates and times
- **Conflict detection**: Hard block on exact time overlaps (409), soft warning for same-day different-time bookings
- Weekly and monthly calendar views with person filter

### 👥 People
- List all team members with role badges (Admin, Employee, Subcontractor)
- **Person detail page**: Full schedule across all jobs, grouped by week
- Double-bookings highlighted in RED with a conflict banner at the top

### 💬 Messages
- Per-job chat, filterable by phase
- Chat-style UI

### 📎 Files
- Upload files to jobs (image thumbnails, download links)
- Optionally associate with a phase

### 📊 Production Logs
- Log metrics (e.g., "Linear ft of pipe installed = 125 linear ft")
- Automatic totals and averages per metric

### ⚙️ Settings (Admin only)
- Add team members
- Edit name, email, role, phone

## Tech Stack

- **Next.js 14** — App Router, Server Components where applicable
- **Prisma + SQLite** — Local database, easy to swap for Postgres
- **Tailwind CSS** — Utility-first styling
- **next-auth** — Credentials-based authentication with JWT sessions
- **bcryptjs** — Password hashing
- **date-fns** — Date manipulation
- **TypeScript** — Full type safety

## Project Structure

```
src/
  app/
    api/          # REST API routes
    jobs/         # Job list, new job, job detail
    schedule/     # Weekly/monthly calendar
    people/       # Team list + person detail
    settings/     # Admin user management
    login/        # Auth page
  components/
    Layout.tsx    # Shell with sidebar + bottom nav
    Sidebar.tsx   # Desktop navigation
    BottomNav.tsx # Mobile navigation
    CopyJobModal.tsx
  lib/
    prisma.ts     # Prisma singleton
    auth.ts       # NextAuth config
prisma/
  schema.prisma
  seed.ts
```
