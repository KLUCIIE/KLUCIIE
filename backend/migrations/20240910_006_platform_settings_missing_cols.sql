-- Add remaining platform_settings columns used by the Settings page
-- (migrations 0062/0064/0065/0066 were never applied locally).
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS register_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stop_dynamic_qr boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS amtps_wings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS use_attendance_realtime boolean NOT NULL DEFAULT true;