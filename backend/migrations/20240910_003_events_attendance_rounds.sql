-- 0020_attendance_rounds.sql port — events N-round attendance (the app reads events.attendance_rounds on every event page)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS attendance_rounds integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_attendance_rounds_check' AND conrelid = 'events'::regclass
  ) THEN
    ALTER TABLE events ADD CONSTRAINT events_attendance_rounds_check CHECK (attendance_rounds >= 1 AND attendance_rounds <= 30);
  END IF;
END $$;