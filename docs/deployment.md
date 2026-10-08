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

Not configured yet. `wrangler.jsonc` binds D1 as `DB` without a
`database_id`, which local development doesn't need. Milestone 5 adds:

- separate development and production environments, each with its own D1
  database;
- migrations applied with `wrangler d1 migrations apply`;
- an explicitly triggered production deploy.
