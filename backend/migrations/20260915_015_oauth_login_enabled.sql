-- Separate login-page OAuth toggle from the register-page toggle.
-- `enabled` continues to gate the Register page OAuth (and is the master switch).
-- `login_enabled` independently gates whether OAuth buttons appear on the Login page.
-- Credentials (MS/GH) are shared — entered once in the Register OAuth admin section.

ALTER TABLE oauth_settings
  ADD COLUMN IF NOT EXISTS login_enabled boolean NOT NULL DEFAULT false;
