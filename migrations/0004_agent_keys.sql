-- Read-only agent keys, so a player's AI agent can read their own submitted
-- records over MCP (src/worker/agentKeys.ts, docs/mcp.md). A key is linked
-- to submissions only by the holder of each one's receipt, so the links say
-- which submissions one player chose to group: they are deleted with the key.

CREATE TABLE agent_keys (
  id INTEGER PRIMARY KEY,
  -- SHA-256 of the key; the key itself is never stored or sent to be linked.
  key_hash TEXT NOT NULL UNIQUE CHECK (length(key_hash) = 64),
  created_at INTEGER NOT NULL
);

CREATE TABLE agent_key_uploads (
  key_id INTEGER NOT NULL REFERENCES agent_keys (id),
  upload_id INTEGER NOT NULL REFERENCES uploads (id),
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (key_id, upload_id)
);

CREATE INDEX agent_key_uploads_by_upload ON agent_key_uploads (upload_id);
