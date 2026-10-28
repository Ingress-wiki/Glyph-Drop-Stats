# Development and deployment

## Requirements

- Node.js 22 or newer and npm.
- A Cloudflare account, for deployment only. Local development needs none.

## Local development

```sh
git clone --recurse-submodules https://github.com/Ingress-wiki/Glyph-Drop-Stats.git
# (or, in an existing clone: git submodule update --init)
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

### Submissions: test period

`SUBMISSIONS_OPEN` takes three values:

- `"false"` (or anything unknown): closed. Checking a file, statistics,
  lookups and withdrawal work; `POST /api/submissions` is refused
  (`submissions_closed`), and `GET /api/config` tells the page, which then
  shows why instead of offering a receipt.
- `"test"`: open for testing. `GET /api/config` returns `testPeriod: true`
  and the page says, above the statistics and before a receipt is made,
  that everything submitted will be deleted before the site opens to the
  public.
- `"true"`: open. Only once bounded retention and the data terms are
  published.

Production is `"test"`; locally it is `"true"`.

**Ending the test period** keeps that promise, in this order:

1. Set production to `"false"` and `npm run deploy`, so nothing arrives
   during the wipe.
2. `npm run db:wipe:production` deletes every submission and everything it
   supplied (`scripts/wipe-submissions.sql`; the tests reset their database
   with the same file). The schema stays.
3. Check that `/api/statistics` reports no records.
4. D1 Time Travel still holds the deleted rows until its retention window
   passes (7 days on Workers Free, 30 on Paid). Don't restore across the
   wipe.

Only then set `"true"`.

### Plan limits

The account is on Workers Free. Its 10 ms CPU limit per request is about
what checking a typical export takes, so larger files can fail with error
1102 until the account moves to Workers Paid (see [Plan](#plan)).

### CI and deploys

`.github/workflows/ci.yml` runs on every push and pull request:

- **check:** typecheck, lint, unit and D1 tests, build;
- **browser:** `npm run test:browser` in the runner's Chrome and
  Playwright's Firefox, with screenshots of each page and language uploaded
  as an artifact.

Deploys are Cloudflare's: the repository is connected to the Worker with
the Cloudflare GitHub app (Workers Builds), which builds and deploys each
push to `main` and reports the result as a check on the commit. GitHub
holds no Cloudflare token. In the Worker's *Settings → Build*:

- build command: none, as the deploy command builds;
- deploy command: `npm run db:migrate:production && npm run deploy`, so
  new D1 migrations, which are additive, are applied before the code that
  needs them. The build's API token needs *D1: Edit* for this.

Workers Builds doesn't wait for the GitHub checks, so a push to `main`
deploys even if they fail: merge only pull requests whose checks pass.

### By hand

```sh
npx wrangler login
npm run db:migrate:production   # apply new migrations to the production D1
npm run deploy                  # build for production and deploy
```
