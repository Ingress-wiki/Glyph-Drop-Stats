-- Ingress events read from the activity board the game shows, refreshed
-- daily by the Worker's cron (src/worker/events.ts). Windows are UTC
-- seconds, start inclusive, end exclusive; an event run in local time is
-- held as the UTC window it covers in every time zone. Only the name, the
-- window and a note are kept, not Niantic's descriptions. Past events stay
-- after they leave the board; an upcoming one that leaves it is removed.
CREATE TABLE ingress_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_utc INTEGER NOT NULL,
  end_utc INTEGER NOT NULL,
  note TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  CHECK (start_utc < end_utc)
);
