# Glyph Drop Stats

An open platform for collecting and analyzing gear-drop observations exported
by DynamicGlyph. Players export the records they
choose, check the file here, and explicitly submit it. The server validates
submissions, counts repeated exports of a record once, and publishes
aggregate statistics with their sample sizes and limits.

The code is public. Individual submissions and private receipts are not.

## Status

| Milestone | State |
| --- | --- |
| 1. Format contract: parsing, validation, normalization, tests | Done |
| 2. Submission lifecycle: D1, confirm, receipts, deduplication | Next |
| 3. Withdrawal | Planned |
| 4. Basic statistics | Planned |
| 5. Pilot deployment | Planned |

Today the site can **check** an export (`POST /api/preview`) and explain
which records are usable. It stores nothing.

## Quick start

```sh
npm install
npm run dev
```

See [docs/deployment.md](docs/deployment.md) for every command.

## Documentation

- [Architecture](docs/architecture.md): components, lifecycle, data model
- [Import format](docs/import-format.md): what is accepted and why
- [Statistics](docs/statistics.md): what the numbers mean
- [Privacy](docs/privacy.md): what is and isn't stored
- [Deployment](docs/deployment.md)

## Licence

Code: [MIT](LICENSE). Terms for submitted data will be published separately.
