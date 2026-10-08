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
| 5. Pilot deployment | Next |

Today a player can check an export, see which records are usable and which
are already known, and submit it with a private receipt. With the receipt
they can later look the submission up or withdraw it. The statistics view
shows counts and item averages with their denominators and exclusions.

The interface is a pixel-art canvas drawn with synth-ui, with a text
version for screen readers and browsers without WebGPU or WebGL2. Press F1
for statistics, F2 to submit; Tab and Enter reach every control. The page
speaks English, Simplified and Traditional Chinese, Japanese and Korean (the
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
| [synth-ui](https://github.com/unixzii/synth-ui) (`@synth-ui/core`, `widgets`, `backend`) | MIT, © 2026 Cyandev | Draws the whole interface; its bitmap faces are part of it. |
| X.org misc-fixed 5×7 | Public domain | Converted by `scripts/bdf-to-face.mjs` into the mixed-case face used for receipts and prose. |
| [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font) 8px proportional | SIL OFL 1.1, © 2022 TakWolf, with its source fonts' licences (Galmuri and Miseki Bitmap: OFL 1.1; Misaki and BoutiqueBitmap7x7: free to use, modify and redistribute) | Subset by `scripts/cjk-faces.mjs` into the Chinese, Japanese and Korean faces. Those generated files (`src/web/canvas/fonts/cjk*.ts`) are a modified version of the font and remain under the OFL, not the MIT licence. Texts in `public/licenses/fusion-pixel/`. |

Glyph Drop Stats is not affiliated with Niantic. Ingress and its item names
are Niantic's.
