# Architecture

## Components

| Path | Role |
| --- | --- |
| `src/domain/` | CSV reading, validation, normalization, version comparison and receipts. Uses only web-standard APIs, with no Cloudflare APIs, so it runs and is tested in Node. |
| `src/worker/` | The Cloudflare Worker: `api.ts` (endpoints), `submissions.ts` (classification and confirmation), `rows.ts` (records ↔ tables), `db.ts` (the D1 subset used), `index.ts` (entry). |
| `src/web/` | The site, served as Workers Static Assets. See [The web page](#the-web-page). |
| `migrations/` | D1 schema migrations. |

The server decides whether data is accepted. The browser only displays what
the server returns.

## The web page

The interface is drawn into one `<canvas>` by [synth-ui](https://github.com/unixzii/synth-ui):
immediate-mode, at two CSS pixels per virtual pixel, with an optional CRT
effect (F8). WebGPU is used where there is one, WebGL2 otherwise.

| Path | Role |
| --- | --- |
| `src/web/app/store.ts` | All page state and actions, with no drawing. It enforces the rules: only the newest answer may update the page; a receipt belongs to the file whose preview is shown. Unit-tested. |
| `src/web/canvas/` | Draws the state each frame, and calls the store's actions. |
| `src/web/canvas/textLayer.ts` | Mirrors visible bitmap glyphs as transparent native text for selection and copying. |
| `src/web/app/mirror.ts` | The same state as plain HTML, visually hidden. |
| `src/web/main.ts` | Wiring: the store's network, storage and clipboard, the file input, and the view host. |

A canvas has no text for assistive technology or the browser's find, and
no native controls. So:

- **The accessible mirror** renders everything the canvas shows as
  semantic HTML, with a live region announcing results and the focused
  control. If the canvas can't start (no WebGPU or WebGL2), the mirror is
  shown in its place.
- **Keyboard:**
  - Tab moves between controls, and Enter or Space activates the focused
    one. synth-ui's own buttons don't take focus, so the site draws its own.
  - F1 shows statistics, F2 submitting, F3 the filters, F4 the guide, F8
    the CRT effect, F9 the text view.
- **Selecting and copying:** a transparent HTML text layer follows the
  canvas's glyph positions and clipping. Drag or double-click to select
  visible text, then copy normally; Mod+A selects the visible text. The
  layer leaves interactive controls with the canvas and preserves text
  nodes across redraws so hovering doesn't discard a selection. Modal
  backdrops exclude covered text, and wheel events over text still scroll
  the canvas.
  - **Receipts** are drawn in a read-only selectable widget: drag,
    double-click, Tab or Mod+A selects, and Mod+C copies through synth-ui's
    copy-event path, which works over plain HTTP.
  - **The COPY button** uses the clipboard API where the browser allows it
    (HTTPS, localhost), and a selected off-screen text area elsewhere.
  - **The text view** (TEXT VIEW, or F9) shows the accessible mirror on
    screen instead of the canvas, where any text can be selected, copied
    and searched. The choice is remembered per browser.
- **Files:** CHOOSE FILE opens a hidden native `<input type="file">`. A
  file can also be dropped anywhere on the page.
- **Receipts:** synth-ui's faces are capitals only, and receipts are case
  sensitive. Receipts and prose therefore use a mixed-case face converted
  from the public-domain X.org misc-fixed 5×7 font
  (`scripts/bdf-to-face.mjs`), and COPY puts the exact text on the
  clipboard.

## Submission lifecycle

```
upload → validate → preview → receipt → confirm → status → withdraw
```

**Status:** the whole lifecycle is built.

| Endpoint | Does |
| --- | --- |
| `POST /api/preview` | Validates the file and classifies its records against accepted data. Stores nothing. |
| `POST /api/submissions` | Confirms the file with `Authorization: Receipt <secret>`. Returns 201, 200 (`replayed`) or 409 (`receipt_in_use`). |
| `GET /api/submission` | Reports the submission for `Authorization: Receipt <secret>`. |
| `GET /api/statistics` | Descriptive statistics over `counted_records`, with optional filters. See [statistics](statistics.md). |
| `POST /api/submission/withdraw` | Withdraws it. Idempotent: again, it returns 200 with `alreadyWithdrawn: true` and changes nothing. A record id is never authorization. |

### Preview and confirm are stateless

The preview stores nothing. To confirm, the browser sends the same file
again, and the server validates and classifies it again. The original CSV
is never kept, and there are no staged rows to clean up. Re-validation also
covers another submission landing between preview and confirm.

The page submits the exact `File` its preview describes. Choosing another
file discards the preview, the receipt and any check still in flight.

### Receipts and lost responses

The receipt secret (`gds1_` plus 256 random bits) is made in the browser,
and the page has the player save it **before** confirming. The server
stores only its SHA-256.

- The receipt is the **idempotency key**. Confirming again with the same
  receipt and the same file returns the original result (`replayed`) and
  counts nothing twice. So when a confirmation commits but its response is
  lost, the page retries with the receipt it still holds, and the player
  still has a working receipt.
- The same receipt with a different file is refused (409), because the
  upload stores the SHA-256 of its bytes.
- Two simultaneous confirmations with one receipt produce one upload. The
  second hits the unique `secret_hash`, finds the first, and replays it.
- The secret travels only in the `Authorization` header, never in a URL,
  and is never logged.

### One transaction per confirmation

Confirmation builds a single D1 batch, which is one transaction. It holds
the upload row, the new versions with their panels and items, claims on
records nobody had accepted, and every link. Bulk rows go through one bound
JSON parameter per statement (`json_each`), chunked under 512 KB, so even a
maximum-size export is a handful of statements. The result:

- **No partial imports.** The batch applies completely or not at all, so an
  interrupted confirmation leaves nothing behind and needs no cleanup job.
- **Retries are safe.** The receipt's unique key stops a second commit, and
  versions are content-addressed, so re-inserting one changes nothing.
- **Concurrency is safe.** A record is claimed with a plain `INSERT` on
  `accepted_versions.record_id`. If a concurrent upload claimed it after
  this one classified, the batch fails on that key and rolls back.
  Confirmation then classifies again against the now-accepted version, up
  to four attempts.

Measured in local `wrangler dev` (2026-10-04), a maximum-size synthetic
export (2,000 records, 50,000 rows, 16.7 MB) commits in one batch in about
1.9 s. This must be measured again on deployed D1 before the pilot.

## Data model

See `migrations/0001_initial.sql`.

| Table | Holds |
| --- | --- |
| `uploads` | Status (`completed`, `withdrawn`), time, counts, exporter build, the receipt secret's hash, the file's hash. |
| `record_versions` | One immutable row per version, keyed by its content hash (which covers `record_id`). |
| `panels`, `items` | A version's panels and items. |
| `accepted_versions` | The single accepted version of each `record_id`, how it was decided, the upload, and when. |
| `upload_records` | Which version each upload supplied for each record, and its outcome. |
| `counted_records` (view) | Accepted versions still supported by a completed upload. Statistics read only this. |

## Equivalent copies and accepted versions

### Comparing copies

`src/domain/versions.ts` compares an incoming copy with the accepted version
(`compareVersions`):

| Outcome | Meaning | Effect |
| --- | --- | --- |
| `duplicate` | Same observation, same time. | Linked to the accepted version. |
| `duplicate_other_precision` | Same observation. One interval is the hour inside the other's day, at the same offset ("Include the hour" changed). | Linked to the accepted version. The accepted time is **not** replaced by the more precise one. |
| `update_candidate` | The accepted copy had no gear reading (`unavailable` or `unsupported`). The incoming copy is read, with the same hack result, a compatible time and a compatible origin. This is the expected late gear reading. | Stored and flagged. Not applied automatically. |
| `conflict` | Anything else, including incompatible times (other offset, other hour, an hour outside the day). | Stored and flagged. Not counted. |

The content hash identifies an exact version. The comparison decides
equivalence, so a change in time precision isn't mistaken for a conflict.
Excluding time from comparison altogether would hide real conflicts, so it
isn't excluded.

### Acceptance policy

Which version of a record counts is **recorded**, not recomputed from
whichever uploads happen to be active.

1. **The initial version is selected automatically, once.** The first
   confirmed upload of a `record_id` sets `accepted_versions`, with
   `decision = 'first_confirmed'`.
2. **Any later change needs an explicit, auditable review decision.**
   - Later copies are classified against the accepted version. Duplicates
     link to it. Update candidates and conflicts are stored with their
     upload links but don't count.
   - In the first release, a late gear reading is applied only with
     **explicit maintainer approval**. A matching id and more complete data
     don't show that an update is authentic, or that it comes from the
     original contributor.
   - When review is built, it will record who decided what and when (a new
     `decision` value and a log). No moderation interface exists yet. Until
     it does, accepted versions never change.
3. **Withdrawal never promotes anything.**
   - When an upload is withdrawn, its links stop supporting the accepted
     version.
   - If another completed upload still supports that version, through a
     duplicate link, the record keeps counting.
   - Otherwise the record stops counting, and no conflict or update
     candidate takes its place.
   - Without this, someone could submit altered content under an existing
     id and see it become accepted once the original uploader withdrew.

### Failure and retry

All of this is covered by `tests/d1/`, against a local D1:

- a failed commit leaves no rows;
- a stale prepared batch fails and is reclassified;
- simultaneous overlapping uploads leave exactly one accepted version per
  record;
- a duplicate receipt confirms once;
- a retry after a lost response returns the original result;
- withdrawal needs the receipt, is idempotent, keeps records another active
  submission supplied, and promotes nothing;
- retrying a confirmation after withdrawing replays it as withdrawn and
  doesn't reactivate it;
- a later submission of the accepted version makes the record count again.
