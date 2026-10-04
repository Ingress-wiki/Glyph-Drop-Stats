# Import format

Glyph Drop Stats accepts the DynamicGlyph gear export, **format version 1**.
The exporter's own specification is the source of truth:
DynamicGlyph `Docs/GEAR_EXPORT_FORMAT.md` and `GearExport.columns` in
`Apps/DynamicGlyph/Sources/Results/GearExport.swift`. This page records how
the server reads that format. The code is `src/domain/`.

## The file

- UTF-8. A byte-order mark added by another tool is ignored.
- RFC 4180 CSV. CRLF or LF line endings; blank lines are skipped.
- The header must begin with the 49 v1 columns, in order (`src/domain/format.ts`).
  - Within v1 the app may append columns. The server ignores any column after
    the 49 and **does not store it**, and the preview says so. This matters:
    later columns may hold data, such as portal names, that the site has not
    agreed to collect.
  - A renamed, missing or reordered column rejects the file.
- `format_version` must be `1` on every row.
- Every row must have the same `exporter_app_version` and
  `exporter_app_build`, because one export is one snapshot.

## Records

One record is every row sharing a `record_id`. The rows need not be
contiguous. The portal panel's rows must come before the bonus panel's,
because the app never writes them the other way. A record's panels are
`[portal]`, `[bonus]` or `[portal, bonus]`. Items are put in `slot` order,
so the order of a panel's item rows doesn't matter.

The server checks:

- **Cells.** Every cell holds a value of its column's type and range. A
  blank cell is read as *unknown* and stored as null: never as zero or
  false.
  - Panel effects must be on the app's list.
  - Version strings are limited to `[0-9A-Za-z._+-]`.
  - The app may add item names within v1. A name not yet on the server's
    list (`ITEM_NAMES`) is accepted if it matches `^[A-Za-z0-9 ().+-]{1,40}$`.
    - It is **bounded, untrusted text**. The pattern blocks formulas, URLs
      and long text, not short free text such as a name.
    - The preview lists it with the build that **captured** each record
      (`source_app_build`, not the exporter's), under `unlisted_items`.
    - It never appears in public output. Records containing it are left
      out of item statistics until the name is reviewed and added to the
      list.
- **Spreadsheet guard.** A text or id cell written as `'` followed by
  `= + - @`, a tab or a CR has the `'` removed, as the spec says.
- **Agreement.** Record-level columns are identical on every row of a record;
  panel columns are identical on every row of a panel.
- **Shape.**
  - `record_id` is `h` or `d` plus 32 lowercase hex digits, and the letter
    matches `kind`. `time_basis` matches `kind`.
  - Hack columns are blank on drops; drops are always `read`.
  - `notRead` has a `read_reason`; `unavailable`, `unsupported` and `notRead`
    are one row with panel and item columns blank.
  - A `read` record is one row with no panel, or rows grouped into at most
    one portal and one bonus panel. A panel is one empty-panel row or item
    rows with distinct slots, never both.
  - An item row has `slot`, `level_state` and `quantity`. `level` is set
    exactly when `level_state` is `known`; `rarity` and `rarity_source` are
    set together.
  - Paired columns are set together: a bonus and its `_final` flag, the four
    portal-level columns, and the command columns with `command_mode`. A
    command is set only when its status is `confirmed`.
- **Coverage flags.** `observed_panels_read_in_full` and `both_panels_read`
  must equal what the panels show, using the app's definitions
  (`GearDropSummary.panelsReadInFull` and `bothPanelsRead`).
  `both_panels_read` is true only for `[portal, bonus]` with neither
  partial.
- **Time.** The interval is exactly one hour or one day.
  - With `utc_offset_minutes`, the interval is aligned to that offset's hour
    or day (so +05:45 hours start at :15 UTC). `local_date` and, for an hour,
    `local_hour` must match it. A day interval has a blank `local_hour`.
  - Without an offset, the interval is a UTC hour or day, and the local
    columns are blank.
  - Intervals starting before 2025 or more than a day after the upload are
    rejected.

A problem with one record rejects that record only. The preview lists it by
id and line with the reason. Rows too broken to name a record are listed
with a null id.

## What counts as the same record

A record's **content hash** is the SHA-256 of its normalized form
(`src/domain/normalize.ts`). It leaves out everything export-only:
`format_version`, `session`, `order` and the exporter's version and build.
`session` is numbered per file and is never used as an identifier.

- Same `record_id`, same hash: the same version exported again.
- Same `record_id`, different hash: a different version.
  `compareVersions` then decides whether it is equivalent (only the time
  precision differs), a late gear reading, or a conflict. See
  [architecture](architecture.md#equivalent-copies-and-accepted-versions).
- Different `record_id`s with identical content: two observations. Identical
  drops are common.

## Limits

These are provisional, derived from the app's retention caps (1,000 hacks
and 1,000 drops, about 50,000 rows at most). They have not been measured on
Workers yet; see the pilot milestone.

| Limit | Value |
| --- | --- |
| File size | 20 MiB, counted while the body streams in. The server stops reading at the limit, with or without a Content-Length header. |
| Data rows | 60,000 |
| Records | 5,000 |
| Fields per row | 49 + 64 appended columns |
| Field length | 256 characters |

The row, field and length limits are enforced inside the CSV reader, so a
hostile file is refused before large structures are built.

### Measurements

These are wall times for `POST /api/preview` in local `wrangler dev`
(workerd) on an Apple-silicon Mac, measured 2026-10-04. Production CPU time
will differ; measure again on Cloudflare before the pilot.

| File | Rows | Size | Time |
| --- | --- | --- | --- |
| A real player export (not committed) | 957 | 244 KB | about 10 ms |
| Synthetic maximum: 2,000 hacks × 25 rows | 50,000 | 16.7 MB | about 1.4 s |

The Workers Free plan allows 10 ms of CPU per request, which a typical
export already reaches. Accepting real exports needs Workers Paid, or the
work must move to a queue.

## Issue codes

File-level (the whole file is rejected): `file_too_large` (HTTP 413),
`invalid_encoding`, `csv_syntax`, `too_many_rows`, `too_many_fields`,
`field_too_long`, `too_many_records`,
`empty_file`, `no_records`, `not_gear_export`, `unsupported_columns`,
`unsupported_version`, `mixed_exporters`.

Record-level (that record is rejected): `row_width`, `invalid_value`,
`missing_value`, `unexpected_value`, `inconsistent_record`,
`malformed_record`, `invalid_time`.

Warnings (the file is accepted): `ignored_columns`, `unlisted_items`.
