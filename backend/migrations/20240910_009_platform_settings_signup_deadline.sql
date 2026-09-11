-- Registrations are closed for new applicants once this timestamp passes.
ALTER TABLE platform_settings ADD COLUMN signup_deadline timestamptz;