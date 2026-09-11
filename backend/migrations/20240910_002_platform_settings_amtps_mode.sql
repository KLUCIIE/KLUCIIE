ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS amtps_mode boolean NOT NULL DEFAULT true;