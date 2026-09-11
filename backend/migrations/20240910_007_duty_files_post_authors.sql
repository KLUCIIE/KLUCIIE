-- duty_files / post_authors: tables listed in the admin-write allow-list but
-- never created locally (migrations 0062/0066 from the original schema were
-- never applied on this instance). Also ensure the duties tables that
-- db.routes references exist.
CREATE TABLE IF NOT EXISTS duty_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_id uuid NOT NULL REFERENCES duties(id) ON DELETE CASCADE,
  member_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  file_key text,
  file_name text,
  file_url text,
  file_type text,
  size_bytes bigint,
  uploaded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_authors_post_author_key UNIQUE (post_id, author_id)
);