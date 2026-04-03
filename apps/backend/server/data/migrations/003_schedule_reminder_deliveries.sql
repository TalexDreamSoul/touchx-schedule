CREATE TABLE IF NOT EXISTS schedule_reminder_deliveries (
  id TEXT PRIMARY KEY,
  reminder_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  due_at TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  student_no TEXT NOT NULL,
  template_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  external_message_id TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_reminder_deliveries_status_due
  ON schedule_reminder_deliveries(status, due_at);

CREATE INDEX IF NOT EXISTS idx_schedule_reminder_deliveries_user_due
  ON schedule_reminder_deliveries(recipient_user_id, due_at);
