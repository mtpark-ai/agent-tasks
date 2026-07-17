CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  action TEXT,
  repository TEXT,
  issue_number INTEGER,
  sender TEXT,
  normalized_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'ignored', 'queued', 'delivered', 'failed')),
  response_status INTEGER,
  error_code TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS github_webhook_deliveries_status_idx
  ON github_webhook_deliveries(status, received_at DESC);

CREATE INDEX IF NOT EXISTS github_webhook_deliveries_issue_idx
  ON github_webhook_deliveries(repository, issue_number, received_at DESC);

CREATE INDEX IF NOT EXISTS github_webhook_deliveries_event_idx
  ON github_webhook_deliveries(event_type, received_at DESC);
