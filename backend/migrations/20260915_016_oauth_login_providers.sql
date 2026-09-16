-- Per-provider toggles for the login page OAuth section.
-- Register page providers are still controlled by the `mode` column.
-- Login page providers are independently selectable via these two booleans.

ALTER TABLE oauth_settings
  ADD COLUMN IF NOT EXISTS login_microsoft boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS login_github  boolean NOT NULL DEFAULT false;
