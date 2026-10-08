# Privacy (draft)

This must be finished, and reviewed, before real submissions are accepted.

## What is stored

- Only validated v1 fields of accepted records. Columns outside the 49 v1
  columns are dropped, never stored.
- **One exception holds unverified text:** an item name not yet on the
  server's list. It is bounded to 40 characters from
  `[A-Za-z0-9 ().+-]`, but it could still hold anything a person types,
  even a name or address. It is never shown publicly, and its records stay
  out of item statistics until a maintainer reviews the name. Rejected
  names are deleted.
- **Never stored:**
  - the original CSV file (only its SHA-256, to recognize a retry of the
    same upload);
  - the file name;
  - `session` and `order`, which are file-local;
  - the receipt secret itself (only its SHA-256).
- **Kept with each upload:** its time, row count, rejected-record count and
  the exporting app's version and build.
- The export holds no exact times, portal names, notes, images, device
  details or storage keys.
- `record_id` is a hash of a key with a random number made at app launch.
  It doesn't identify a player. It is stable, though, so a player's uploads
  that overlap can be linked by their shared ids.

## In the visitor's browser

No cookies, analytics or tracking. The page keeps five preferences in
`localStorage`, each written only when the visitor chooses it, and never
sent to the server:

| Key | Holds |
| --- | --- |
| `glyph-drop-stats:locale` | The language picked in the language switch |
| `glyph-drop-stats:crt` | The CRT switch |
| `glyph-drop-stats:smooth-text` | The font switch |
| `glyph-drop-stats:text-view` | Whether the text view is shown |
| `glyph-drop-stats:disclaimer-seen` | That the first-visit note was dismissed |

These are interface settings the visitor asked for, so they need no
consent banner (they are "strictly necessary" under the ePrivacy rules).
Receipts are never stored by the page: the visitor downloads or copies
them. Adding cookies, analytics or anything that identifies a visitor
would change this and needs its own review.

## Withdrawal

**What it does now:**

- The submission is marked withdrawn, with the time, at once.
- Its links stop supporting accepted versions, so statistics, which read
  only `counted_records`, stop counting every record that no other active
  submission supplied.
- Nothing is promoted in its place.
- There are no cached aggregates yet, so nothing else needs refreshing.

**What it doesn't do yet:** delete rows.

- The upload row, its links and the versions it supplied stay in the
  database, marked withdrawn and no longer counted.
- Versions can't simply be deleted. An accepted version may also be
  supported by other submissions, and it is what later uploads of the same
  record are compared with.
- Withdrawn data also stays in D1 Time Travel backups for their retention
  window.

## Not yet decided

- **Deleting withdrawn data.** The current indefinite retention is for
  development only and must not become the production default. Before
  accepting real submissions, define and implement:
  - a bounded deletion period for observation payloads supported only by
    withdrawn submissions;
  - the minimal metadata kept after that, for retry handling and to keep
    a conflict from being promoted automatically;
  - backup retention, and what a restore does to withdrawals made since
    the backup.
- **Withdrawn records under review.** A maintainer review of update
  candidates and conflicts should ignore those from withdrawn submissions.
- **Operational logging.** What Cloudflare records about requests (IP
  addresses, user agents), and for how long. Having no accounts does not
  mean no connection metadata.
- **Terms.** The terms for submitting and publishing data, separate from
  the MIT code licence.

## Rules for the code

- Never log CSV contents or receipt secrets.
- The preview goes only to the uploader. It echoes record ids, line numbers
  and reasons. The one cell value it repeats is an item name not yet on the
  server's list, so the uploader can see what will be held for review.
- Never put a receipt secret in a URL. It travels only in the
  `Authorization: Receipt …` header.
- The receipt is made in the player's browser and never sent anywhere
  except to authorize their own requests. The server can't check that it
  is random; a player who picks a weak one only weakens their own
  submission.
