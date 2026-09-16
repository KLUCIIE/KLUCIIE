-- OAuth / sign-in method configuration for the login & user registration pages.
-- `mode` selects which sign-in method is shown:
--   'register'  -> only the existing email/password (Gmail SMTP) register flow
--   'microsoft' -> only Microsoft OAuth
--   'both'      -> both are offered
-- Secrets (Tenant ID / Client ID / Client Secret) are entered by a Super Admin
-- through Admin -> System -> OAuth. The table is ADMIN_READ-only (never public).
CREATE TABLE IF NOT EXISTS oauth_settings (
  id integer primary key default 1,
  enabled boolean not null default false,
  mode text not null default 'register',
  ms_tenant_id text,
  ms_client_id text,
  ms_client_secret text,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

INSERT INTO oauth_settings (id, enabled, mode)
VALUES (1, false, 'register')
ON CONFLICT (id) DO NOTHING;