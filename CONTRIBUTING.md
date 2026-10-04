# Contributing

1. `npm install`, then make your change.
2. Add or update tests. Every validation rule has a test in `tests/`.
3. Run `npm run typecheck && npm run lint && npm test && npm run build`;
   CI runs the same.

## Rules

- **Synthetic data only.** Never commit a real player's export, a receipt,
  or credentials. Build test files with `tests/helpers/export.ts`.
- **Keep `src/domain/` free of Cloudflare APIs.** Parsing, validation and
  statistics rules must run in plain Node.
- **The exporter's spec is the source of truth.** When DynamicGlyph's format
  changes, update `src/domain/format.ts`, the tests and
  `docs/import-format.md` together.
- **Blank means unknown.** Never turn a missing value into zero or false.
