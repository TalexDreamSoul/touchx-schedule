CREATE TABLE IF NOT EXISTS schedule_import_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  total_files INTEGER NOT NULL,
  processed_files INTEGER NOT NULL,
  success_count INTEGER NOT NULL,
  fail_count INTEGER NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS schedule_import_job_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  student_no TEXT NOT NULL,
  term TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  entry_count INTEGER NOT NULL DEFAULT 0,
  schedule_id TEXT NOT NULL DEFAULT '',
  version_no INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_import_job_items_job ON schedule_import_job_items(job_id);
CREATE INDEX IF NOT EXISTS idx_schedule_import_job_items_status ON schedule_import_job_items(status);

