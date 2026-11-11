-- Optional passkey accounts (src/worker/accounts.ts, docs/accounts.md).
-- Anonymous submission stays the default: an account only groups
-- submissions its holder chose to claim with their receipts. There is no
-- email, username or password, and the passkey's private key never leaves
-- the player's device.

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  -- The WebAuthn user handle: random bytes as base64url, naming no one.
  user_handle TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE passkeys (
  -- The credential id the authenticator chose, as base64url.
  credential_id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts (id),
  -- The COSE public key, as base64url. It can verify, never sign.
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL CHECK (counter >= 0),
  -- JSON array of transport hints, passed back to the browser at sign-in.
  transports TEXT NOT NULL,
  -- Whether the passkey is synced (backed up) by its provider.
  backed_up INTEGER NOT NULL CHECK (backed_up IN (0, 1)),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX passkeys_by_account ON passkeys (account_id);

-- A submission belongs to at most one account, linked by its receipt holder.
CREATE TABLE account_uploads (
  upload_id INTEGER PRIMARY KEY REFERENCES uploads (id),
  account_id INTEGER NOT NULL REFERENCES accounts (id),
  linked_at INTEGER NOT NULL
);

CREATE INDEX account_uploads_by_account ON account_uploads (account_id);

CREATE TABLE sessions (
  -- SHA-256 of the cookie's random token; the token itself is never stored.
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  account_id INTEGER NOT NULL REFERENCES accounts (id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_by_account ON sessions (account_id);

-- WebAuthn challenges: single use, short-lived, and bound to what they are for.
CREATE TABLE passkey_challenges (
  challenge TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'sign_in', 'add_passkey')),
  -- The handle a new account will get (register), or the account adding a passkey.
  user_handle TEXT,
  account_id INTEGER REFERENCES accounts (id),
  expires_at INTEGER NOT NULL
);

-- An agent key made by an account reads all that account's submissions,
-- including ones claimed later. Anonymous keys keep this null.
ALTER TABLE agent_keys ADD COLUMN account_id INTEGER REFERENCES accounts (id);

CREATE INDEX agent_keys_by_account ON agent_keys (account_id);
