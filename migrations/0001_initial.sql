-- Glyph Drop Stats, initial schema. See docs/architecture.md.

-- One confirmed submission. A row exists only once its whole import has
-- committed: confirmation writes everything in a single transaction.
CREATE TABLE uploads (
  id INTEGER PRIMARY KEY,
  -- SHA-256 of the receipt secret; the secret itself is never stored.
  secret_hash TEXT NOT NULL UNIQUE CHECK (length(secret_hash) = 64),
  -- SHA-256 of the uploaded bytes, so a retry with the same receipt can be
  -- told apart from an attempt to reuse it for another file.
  file_hash TEXT NOT NULL CHECK (length(file_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('completed', 'withdrawn')),
  created_at INTEGER NOT NULL,
  withdrawn_at INTEGER,
  format_version INTEGER NOT NULL,
  exporter_app_version TEXT,
  exporter_app_build TEXT,
  row_count INTEGER NOT NULL,
  -- Records in the file that failed validation. They are not stored.
  rejected_count INTEGER NOT NULL
);

-- One exact version of a record, addressed by its content hash (which
-- covers record_id). Versions are immutable.
CREATE TABLE record_versions (
  version_hash TEXT PRIMARY KEY CHECK (length(version_hash) = 64),
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hack', 'drop')),
  time_basis TEXT NOT NULL CHECK (time_basis IN ('hack_first_seen', 'drop_closed')),
  bucket_start_utc INTEGER NOT NULL,
  bucket_end_utc INTEGER NOT NULL,
  time_precision TEXT NOT NULL CHECK (time_precision IN ('hour', 'day')),
  utc_offset_minutes INTEGER,
  local_date TEXT,
  local_hour INTEGER,
  read_status TEXT NOT NULL CHECK (read_status IN ('read', 'notRead', 'unavailable', 'unsupported')),
  read_reason TEXT,
  association TEXT,
  observed_panels_read_in_full INTEGER CHECK (observed_panels_read_in_full IN (0, 1)),
  both_panels_read INTEGER CHECK (both_panels_read IN (0, 1)),
  hack_state TEXT,
  hack_glyph_count INTEGER,
  hacking_bonus INTEGER,
  hacking_bonus_final INTEGER CHECK (hacking_bonus_final IN (0, 1)),
  speed_bonus INTEGER,
  speed_bonus_final INTEGER CHECK (speed_bonus_final IN (0, 1)),
  command_mode TEXT,
  speed_command TEXT,
  speed_command_status TEXT,
  key_command TEXT,
  key_command_status TEXT,
  portal_level_low INTEGER,
  portal_level_high INTEGER,
  portal_level_confidence TEXT,
  portal_level_conflict INTEGER CHECK (portal_level_conflict IN (0, 1)),
  capture_mode TEXT,
  game_language TEXT,
  game_language_source TEXT,
  source_app_version TEXT,
  source_app_build TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX record_versions_by_record ON record_versions (record_id);

CREATE TABLE panels (
  version_hash TEXT NOT NULL REFERENCES record_versions (version_hash),
  stage TEXT NOT NULL CHECK (stage IN ('portal', 'bonus')),
  partial INTEGER NOT NULL CHECK (partial IN (0, 1)),
  -- JSON array of effect names, or NULL when the export left it blank.
  effects TEXT,
  PRIMARY KEY (version_hash, stage)
);

CREATE TABLE items (
  version_hash TEXT NOT NULL,
  stage TEXT NOT NULL,
  slot INTEGER NOT NULL,
  -- NULL: read but not recognized. A name not on the server's list is
  -- unverified text and must stay out of public output until reviewed.
  item TEXT,
  level INTEGER,
  level_state TEXT NOT NULL CHECK (level_state IN ('known', 'notApplicable', 'unreadable')),
  rarity TEXT,
  rarity_source TEXT,
  quantity INTEGER NOT NULL,
  multiplied INTEGER CHECK (multiplied IN (0, 1)),
  PRIMARY KEY (version_hash, stage, slot),
  FOREIGN KEY (version_hash, stage) REFERENCES panels (version_hash, stage)
);

-- The one accepted version of each record. The first confirmed upload sets
-- it automatically; any later change needs an explicit, auditable review
-- decision (not yet implemented). Withdrawal never changes this table.
CREATE TABLE accepted_versions (
  record_id TEXT PRIMARY KEY,
  version_hash TEXT NOT NULL REFERENCES record_versions (version_hash),
  upload_id INTEGER NOT NULL REFERENCES uploads (id),
  decision TEXT NOT NULL CHECK (decision IN ('first_confirmed')),
  decided_at INTEGER NOT NULL
);

-- What each upload supplied for each record, classified against the
-- accepted version at confirmation.
CREATE TABLE upload_records (
  upload_id INTEGER NOT NULL REFERENCES uploads (id),
  record_id TEXT NOT NULL,
  version_hash TEXT NOT NULL REFERENCES record_versions (version_hash),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('new', 'duplicate', 'duplicate_other_precision', 'update_candidate', 'conflict')
  ),
  PRIMARY KEY (upload_id, record_id)
);

CREATE INDEX upload_records_by_record ON upload_records (record_id, outcome);

-- Records that count in statistics: an accepted version still supported by
-- at least one completed (not withdrawn) upload, through the link that
-- established it or an equivalent duplicate. Update candidates and
-- conflicts never support it.
CREATE VIEW counted_records AS
SELECT accepted.record_id, accepted.version_hash
FROM accepted_versions AS accepted
WHERE EXISTS (
  SELECT 1
  FROM upload_records AS link
  JOIN uploads AS upload ON upload.id = link.upload_id
  WHERE link.record_id = accepted.record_id
    AND link.outcome IN ('new', 'duplicate', 'duplicate_other_precision')
    AND upload.status = 'completed'
);
