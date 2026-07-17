CREATE TABLE IF NOT EXISTS task_requests (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  idempotency_key TEXT,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  device_kind TEXT NOT NULL CHECK (device_kind IN ('device', 'legacy')),
  method TEXT NOT NULL DEFAULT 'POST',
  content_type TEXT,
  task_text TEXT,
  raw_body TEXT,
  body_size INTEGER NOT NULL CHECK (body_size >= 0),
  payload_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'completed', 'rejected', 'failed')),
  response_status INTEGER,
  error_code TEXT,
  duplicate INTEGER NOT NULL DEFAULT 0 CHECK (duplicate IN (0, 1)),
  issue_number INTEGER,
  issue_url TEXT,
  received_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS task_requests_request_idx
  ON task_requests(request_id, received_at DESC);

CREATE INDEX IF NOT EXISTS task_requests_device_idx
  ON task_requests(device_id, received_at DESC);

CREATE INDEX IF NOT EXISTS task_requests_status_idx
  ON task_requests(status, received_at DESC);

CREATE INDEX IF NOT EXISTS task_requests_issue_idx
  ON task_requests(issue_number);
