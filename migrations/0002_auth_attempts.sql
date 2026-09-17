-- Fixed-window counters for login / registration throttling.
CREATE TABLE IF NOT EXISTS auth_attempts (
  key TEXT PRIMARY KEY,          -- "<action>:<ip>"
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL  -- ms epoch when the current window opened
);
