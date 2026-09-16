-- GitHub OAuth support: add provider secrets to the singleton oauth_settings row.

ALTER TABLE oauth_settings
  ADD COLUMN IF NOT EXISTS gh_client_id text,
  ADD COLUMN IF NOT EXISTS gh_client_secret text;
