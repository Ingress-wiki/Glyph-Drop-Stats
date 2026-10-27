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
| 2. Submission lifecycle: D1, confirm, receipts, deduplication | Done |
| 3. Withdrawal | Done |
| 4. Basic statistics | Done |
| 5. Pilot deployment | Live at [stats.ingress.wiki](https://stats.ingress.wiki), open for a test period: everything submitted will be deleted before the public launch |

Today a player can check an export, see which records are usable and which
are already known, and submit it with a private receipt. With the receipt
they can later look the submission up or withdraw it. The statistics view
shows counts and item averages with their denominators and exclusions.

The interface is plain HTML built with React, in a PlasticList-inspired
style: lines and type do the layout, with one yellow accent. Charts are
drawn with TanStack Charts, light and dark follow the system, and every
control works from the keyboard (F1 statistics, F2 submit, F3 filters, F4
how to read the numbers). The page speaks English, Simplified and Traditional Chinese, Japanese and Korean (the
languages DynamicGlyph reads the game in); the translations await review by
native speakers.

## Quick start

```sh
npm install
npm run db:migrate:local
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

### Third-party notices

The full texts are served with the site under `/licenses/` (`public/licenses/`).

| Component | Licence | Notes |
| --- | --- | --- |
| [Departure Mono](https://github.com/rektdeckard/departure-mono) | SIL OFL 1.1, © Helena Zhang | Headings, labels and buttons. Self-hosted, unmodified. |
| [IBM Plex Mono](https://github.com/IBM/plex) (Latin, 400 and 700) | SIL OFL 1.1, © IBM Corp. | Figures and data. Latin subset from Fontsource. |
| [Inter](https://github.com/rsms/inter) (Latin, 400 and 700) | SIL OFL 1.1, © The Inter Project Authors | Prose. Latin subset from Fontsource. |
| [React](https://react.dev) (`react`, `react-dom`) | MIT, © Meta Platforms, Inc. and affiliates | Bundled into the page's script. |
| [TanStack Charts](https://tanstack.com/charts) (`@tanstack/charts`) | MIT, © Tanner Linsley | Bundled into the page's script. |
| The [D3](https://d3js.org) modules TanStack Charts uses | ISC, except `d3-hexbin` and `d3-sankey` (BSD-3-Clause); © Mike Bostock and contributors | Bundled into the page's script. Texts in `public/licenses/d3.txt`. |

The visual style is inspired by PlasticList (plasticlist.org). No
PlasticList code, styles or content is used.

Glyph Drop Stats is not affiliated with Niantic. Ingress and its item names
are Niantic's.
