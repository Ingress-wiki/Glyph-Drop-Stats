# Development and deployment

## Requirements

- Node.js 22 or newer and npm.
- A Cloudflare account, for deployment only. Local development needs none.

## Local development

```sh
npm install
npm run db:migrate:local   # create the local D1 tables (once, and after new migrations)
npm run dev        # Vite with the Worker in the local Workers runtime
npm test           # unit and API tests
npm run typecheck
npm run lint
npm run build      # client assets and Worker bundle in dist/
npm run test:browser   # build, then drive the real site in Chrome (needs Google Chrome)
```

To run the production build in the local Workers runtime:

```sh
npm run build
npx wrangler dev -c dist/glyph_drop_stats/wrangler.json
```

Stop either server with Ctrl-C.

## Plan

Validation of a real export takes about 10 ms, and of a maximum-size export
over a second (see [import format](import-format.md#measurements)). Both
exceed the Workers Free CPU limit, so deployment assumes **Workers Paid**.

Before the pilot, repeat the measurements in the deployed environment:

- preview and confirmation of a typical and a maximum-size export;
- the CPU time used, against a deliberately set CPU limit;
- the single-batch commit on deployed D1;
- `GET /api/statistics` against an accumulated database of tens of
  thousands of records (see [statistics](statistics.md#scale)), within
  the CPU and 128 MB memory limits;
- the upload limits (`DEFAULT_LIMITS` in `src/domain/importer.ts`).

## Deployment

Production is the Worker `glyph-drop-stats` at **https://stats.ingress.wiki**
(a Cloudflare custom domain; the `workers.dev` address is off, so receipts
always name one site), with its own D1 database. Both are the `production`
environment in `wrangler.jsonc`; the top level is for local development.

### Submissions are closed

`SUBMISSIONS_OPEN` is `"false"` in production. Checking a file, statistics,
lookups and withdrawal work; `POST /api/submissions` is refused
(`submissions_closed`), and `GET /api/config` tells the page, which then
shows why instead of offering a receipt. Open them by setting the variable
to `"true"` once bounded retention and the data terms are published.
Locally it is `"true"`.

### Plan limits

The account is on Workers Free. Its 10 ms CPU limit per request is about
what checking a typical export takes, so larger files can fail with error
1102 until the account moves to Workers Paid (see [Plan](#plan)).

### CI/CD

`.github/workflows/ci.yml` runs on every push and pull request:

- **check:** typecheck, lint, unit and D1 tests, build;
- **browser:** `npm run test:browser` in the runner's Chrome (WebGL2 through
  SwiftShader), with each language's screenshot uploaded as an artifact;
- **deploy:** on `main` only, after both pass (or by running the workflow
  by hand): applies new D1 migrations to production, deploys, and checks
  the live site. It runs in the GitHub `production` environment; add
  required reviewers there to approve each deploy.

The deploy job needs, in the `production` environment:

- the secret `CLOUDFLARE_API_TOKEN`: an API token with *Workers Scripts:
  Edit*, *D1: Edit* (account) and *Workers Routes: Edit* plus *Zone: Read*
  for `ingress.wiki` (the "Edit Cloudflare Workers" template, plus D1);
- the variable `CLOUDFLARE_ACCOUNT_ID`.

### By hand

```sh
npx wrangler login
npm run db:migrate:production   # apply new migrations to the production D1
npm run deploy                  # build for production and deploy
```
