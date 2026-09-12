-- Ensure the singleton platform_settings row exists (id = 1). The Settings page
-- reads and writes this row; when it was missing, saves silently affected 0 rows
-- and reads fell back to "all ON" defaults (toggles appeared to not persist).
INSERT INTO platform_settings (id, allow_public_signup)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;