-- D1 schema for usage metrics: one row per page visit, the latest report of it (see src/usage.js)
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  seq INTEGER NOT NULL,
  record TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_day ON usage (day);

-- Electron Explorer kiosks that share their totals: the latest anonymous totals per kiosk and day (src/kiosk.js)
CREATE TABLE IF NOT EXISTS kiosk_days (
  kiosk TEXT NOT NULL,
  day TEXT NOT NULL,
  site TEXT,
  version TEXT,
  place TEXT,
  totals TEXT NOT NULL,
  updated TEXT NOT NULL,
  PRIMARY KEY (kiosk, day)
);
