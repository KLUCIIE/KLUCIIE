-- Rebuild registration_roles to the canonical (current app) schema + seed.
-- The live table held a pre-refactor shape (name/description/is_active/
-- require_static_key/static_key/require_otp/allowed_domains) and 0 rows; the app
-- and migration 0008 expect role/slug/label/secret/signing_secret/enabled/
-- requires_keys/fields. allowed_domains is kept for the backend domain checks.

drop table if exists public.registration_roles;

create table public.registration_roles (
  id uuid primary key default gen_random_uuid(),
  role text not null unique,
  slug text not null unique,
  label text not null,
  secret text not null,
  signing_secret text not null,
  enabled boolean not null default true,
  requires_keys boolean not null default true,
  fields jsonb not null default '[]'::jsonb,
  allowed_domains text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.registration_roles (role, slug, label, secret, signing_secret, enabled, requires_keys)
values
  ('user', 'user', 'CIIE User', '', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), true, false),
  ('member_ciie', 'member-ciie', 'CIIE Member', 'CIIE-2026-MEMBER', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), true, true),
  ('super_admin', 'super_admin-ciie', 'Super Admin', 'CIIE-2026-SUPER-ADMIN', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), true, true),
  ('main_admin', 'main_admin-ciie', 'Main Admin', 'CIIE-2026-MAIN-ADMIN', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), true, true),
  ('event_admin', 'event_admin-ciie', 'Event Admin', 'CIIE-2026-EVENT-ADMIN', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), true, true),
  ('member_admin', 'member_admin-ciie', 'Member Admin', 'CIIE-2026-MEMBER-ADMIN', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), true, true),
  ('content_admin', 'content_admin-ciie', 'Content Admin', 'CIIE-2026-CONTENT-ADMIN', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), true, true),
  ('gallery_admin', 'gallery_admin-ciie', 'Gallery Admin', 'CIIE-2026-GALLERY-ADMIN', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), true, true),
  ('reports_admin', 'reports_admin-ciie', 'Reports Admin', 'CIIE-2026-REPORTS-ADMIN', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), true, true),
  ('attendance_coordinator', 'attendance_coordinator-ciie', 'Attendance Coordinator', 'CIIE-2026-ATTENDANCE-ADMIN', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), true, true),
  ('mail_admin', 'mail_admin-ciie', 'Mail Admin', 'CIIE-2026-MAIL-ADMIN', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), true, true)
on conflict (slug) do update
  set role = excluded.role, label = excluded.label, requires_keys = excluded.requires_keys;