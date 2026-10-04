# Architecture

## Components

| Path | Role |
| --- | --- |
| `src/domain/` | CSV reading, validation, normalization and (later) statistics rules. Uses only web-standard APIs, with no Cloudflare APIs, so it runs and is tested in Node. |
| `src/worker/` | The Cloudflare Worker: the `/api/*` endpoints. `api.ts` holds the handlers; `index.ts` is the Worker entry. |
| `src/web/` | The React site, served as Workers Static Assets. |
| `migrations/` | D1 schema migrations (from milestone 2). |

The server decides whether data is accepted. The browser only displays what
the server returns.

## Submission lifecycle

```
upload → validate → preview → confirm → receipt → (withdraw)
```

**Status:** validate and preview (`POST /api/preview`) are built. Nothing is
stored yet.

### Preview and confirm are stateless

The preview stores nothing. To confirm, the browser sends the same file
again, and the server validates it again, then checks duplicates and
conflicts at that point. The original CSV is never kept, and there are no
staged rows to clean up. Re-validation also covers another submission
landing between preview and confirm.

### Atomic visibility on D1 (milestone 2)

A large import doesn't fit in one D1 batch, and separate batches aren't one
transaction. So:

1. Insert an `uploads` row with status `processing`.
2. Insert record versions and links in bounded batches. Each insert is
   idempotent (`INSERT … ON CONFLICT DO NOTHING` on unique keys), so a retry
   can't count anything twice.
3. Mark the upload `completed` in the final batch.
4. Statistics read only uploads that are `completed` and not withdrawn.
5. A scheduled job deletes `processing` uploads older than a timeout.

## Data model (milestone 2, proposed)

| Table | Holds |
| --- | --- |
| `uploads` | Status (`processing`, `completed`, `withdrawn`), times, counts, exporter build, the receipt secret's hash. |
| `record_versions` | One row per distinct `(record_id, content_hash)`: the record-level fields. |
| `panels`, `items` | A version's panels and items. |
| `upload_records` | Which upload supplied which version, and how it was classified. |
| `accepted_versions` | The single accepted version of each `record_id`, the upload that established it, and when. |

A version is never overwritten while any upload links to it.

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

### Acceptance is a recorded decision

Which version of a record counts is **recorded**, not recomputed from
whichever uploads happen to be active:

1. The first confirmed upload of a `record_id` establishes its accepted
   version.
2. Later copies are classified against that version. Duplicates link to it.
   Update candidates and conflicts are stored but don't count.
3. **Withdrawal never promotes anything.**
   - When an upload is withdrawn, its links stop supporting the accepted
     version.
   - If another active upload still supports that exact version, through a
     duplicate link, the record keeps counting.
   - Otherwise the record stops counting. A conflicting or candidate
     version doesn't take its place automatically.
   - Without this, someone could submit altered content under an existing
     id and see it become accepted once the original uploader withdrew.
4. Applying an update candidate is a separate, explicit operation. Whether a
   maintainer or a defined rule does it is to be decided before the pilot.

### Failure and retry

- **Retry.** Confirmation is idempotent. Retrying the same file creates no
  new samples.
- **Lost response.** If the commit succeeds but the receipt response is
  lost, the uploader can't recover the secret. The upload is either
  reachable through a retry that returns the same receipt, or else
  documented. This is to be designed and tested in milestone 2.
- **Concurrency.** Two uploads confirming the same new `record_id` at the
  same moment must leave exactly one accepted version. A uniqueness
  constraint on `accepted_versions.record_id` enforces this.
