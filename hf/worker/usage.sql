-- D1 schema for usage metrics: one row per page visit, the latest report of it (see src/usage.js)
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  seq INTEGER NOT NULL,
  record TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_day ON usage (day);
