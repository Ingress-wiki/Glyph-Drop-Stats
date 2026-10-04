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

## Not yet decided

- **Withdrawal.** What it removes from stored data, and how quickly. Also
  how cached aggregates and backups reflect it: D1 Time Travel keeps earlier
  database states for its retention window.
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
