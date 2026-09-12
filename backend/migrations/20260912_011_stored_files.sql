-- Stored files: Postgres-backed uploads so media survives ephemeral disk resets.

CREATE TABLE IF NOT EXISTS stored_files (
  bucket text NOT NULL,
  name text NOT NULL,
  data bytea NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  size bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, name)
);

CREATE INDEX IF NOT EXISTS stored_files_bucket_idx ON stored_files (bucket);

-- Admin events page: index the columns used by admin_get_event_stats() so the
-- aggregate subqueries run against an index scan instead of a seq scan.
CREATE INDEX IF NOT EXISTS event_registrations_event_id_idx ON event_registrations (event_id);
CREATE INDEX IF NOT EXISTS attendance_event_id_status_idx ON attendance (event_id, status);
CREATE INDEX IF NOT EXISTS event_team_members_event_id_idx ON event_team_members (event_id);
CREATE INDEX IF NOT EXISTS certificates_event_id_idx ON certificates (event_id);