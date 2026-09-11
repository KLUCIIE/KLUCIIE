# KL CIIE Platform V2

KL CIIE member portal + admin console (Super Admin MFA-protected).
Built with Vite + React 18 + TypeScript + Tailwind CSS v4, backed by a self-hosted
Fastify API (`backend/`) that exposes the Supabase-compatible surface the app was
built against (db, auth, storage, functions, realtime).

## Prerequisites

- Node.js 18+
- The Fastify backend running with its own PostgreSQL database (see `backend/.env`)

## Setup

```bash
npm install
cp .env.example .env
```

Development uses Vite's proxy (`/api`, `/storage`, `/ws` → localhost:3001), so
`.env` only needs `VITE_API_URL=/api`. Point it at your deployed backend if the
frontend is hosted separately.

## Database Setup

Schema lives under `supabase/migrations/` (the original Supabase-era SQL) and
`backend/init.sql`. The backend does **not** apply migrations at startup — apply
them once against your PostgreSQL database (`backend/.env` → `DATABASE_URL`),
then keep only schema changes you make after that in `backend/migrations/`.

| File | Purpose |
| --- | --- |
| `0001_schema.sql` | Tables, enums, indexes, views (`profiles`, `events`, `event_registrations`, `event_team_members`, `attendance`, `point_rules`, `member_points_transactions`, `member_achievements`, `event_roles`, `gallery_items`, `announcements`, `posts`, `branding_settings`, `admin_audit_logs`, `admin_recovery_codes`, `member_qr_codes`, views) |
| `0002_functions.sql` | RPC functions: `is_admin`, `is_super_admin`, `admin_aal2`, `mark_attendance`, `award_points`, `get_points_stats`, `get_member_rank`, `fetch_leaderboard`, `reset_admin_mfa`, `get_public_member`, MFA helpers, etc. |
| `0003_triggers.sql` | Auto `profiles` row + CIIE id on signup (new signups become `pending` recruits with an alternating interview batch), admin role restrictions, audit logging |
| `0004_policies.sql` | RLS policies (all tables). Restrictive MFA policies gate only `super_admin`; other admins need no MFA |
| `0005_seed.sql` | Default point rules, event roles, branding row, optional starter events |
| `0006_helpers.sql` | Client-facing helpers: `log_failed_admin_login`, `log_admin_login`, `log_admin_event`, ticket lookup, `get_admin_audit_logs` |
| `0007_recruitment_and_settings.sql` | `platform_settings` (single row), recruitment statuses + `interview_batch`, `event_team_members.hours_worked`, super-admin-only `admin_aal2()` |
| `0048_bulk_members_and_smtp_roundrobin.sql` | Lets the service role activate profiles for bulk import; adds `smtp_rotation_state` for round-robin SMTP rotation |
| `0049_force_register_bulk.sql` | Bulk `admin_force_register_event_users(event_id, member_ids[])` RPC for the admin Force Register panel |

> Existing databases that already ran `0004_policies.sql` before this change: after
> applying `0007`, re-run the updated `0004_policies.sql` — it is idempotent and
> rewrites the MFA-restrictive policies so only Super Admin is MFA-gated.

Then promote your admin account (run in SQL Editor after registering). New signups
are `pending` by default, so set `status` too:

```sql
update public.profiles
set role = 'super_admin', status = 'active', mfa_setup_required = true
where email = 'you@example.com';
```

The next login for that account will force MFA setup before the Admin Console is reachable.

## Registration & Recruitment

- The **Register** button only appears when `allow_public_signup` is ON (Admin →
  System → Settings, Super Admin only). When OFF, signups are blocked site-wide.
- With domain restriction ON, only the configured domains (default
  `@kluniversity.in`) can register; when OFF, every domain is allowed.
- New registrations become **pending** applicants. The Super Admin sets two
  GD/Interview dates in Settings; applicants are split by registration order —
  batch 1 attends on the first date, batch 2 on the second. The assigned date is
  shown right after registration and on the member dashboard.
- Approve applicants in Admin → People → Recruits: **Recruit to CIIE** (assigns a
  role, e.g. QR Code Scanner / `attendance_coordinator`) or **Now a member**
  (regular active member).
- **Bulk Add Members** (Admin → People, super admin): upload an Excel/CSV sheet
  (columns: Name, Id Number, Email, Department, Year, Mobile Number), review
  every row before anything is created, then the `bulk-create-members` Edge
  Function creates each login account with a random password (Student ID and
  phone must be exactly 10 digits; duplicates by email/ID are rejected) and a
  welcome email with name + email + password is sent automatically. Passwords
  are shown on the results screen and downloadable as Excel — they are not
  stored in plain text afterwards.
- **Force Register** (Admin Controls, super/main admin): pick an event, tick the
  members who are not registered yet, and register them in bulk — even after the
  deadline or once seats/deadline gates would normally block it. Each forced
  registration is a normal confirmed ticket with its own QR attendance code, so
  scanning works exactly like a manual registration. Duplicate and seat checks
  still apply; every batch is written to the audit log.

## Validation rules

- **Student ID and phone number are mandatory everywhere and must be exactly
  10 digits** — Join CIIE, role registration (`/register/:slug`), event
  registration, member profile edit, Add Member, AMTPS cards, and the bulk
  importer (client-side and re-validated server-side).

## SMTP rotation

Emails rotate across every active Gmail SMTP account round-robin
(mail #1 → account #1, mail #2 → account #2, … looping back after the last),
tracked in `smtp_rotation_state`, so no single account sends everything.
Failover to the remaining accounts still applies if one errors.

## Running

```bash
npm run dev       # local dev server
npm run build     # typecheck (tsc -b) + production build
npm run typecheck # typecheck only
```

## Notes

- **MFA** is required only for `super_admin`, enforced at the database layer via
  `admin_aal2()` (super admin + `aal2` JWT claim from a verified TOTP factor).
  Every other role signs in with just email + password.
- Attendance is keyed off the `attendance` table; certificates are generated for
  present members with linked registrations.
- The scanner distinguishes ticket QR codes (`ticket`) from attendance/member QR
  codes (`member`). Scanning a ticket only verifies the registration (shows the
  details, never marks attendance); scanning a member/attendance QR marks the
  round attendance.
- Members show their attendance QR under Dashboard → **Attendance**.
- Event team assignments (role + hours worked) appear in Dashboard → **My Events**.
- `Event.form_fields` is an opaque JSON array; cast to your form schema when editing.
