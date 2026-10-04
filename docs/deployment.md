# Development and deployment

## Requirements

- Node.js 22 or newer and npm.
- A Cloudflare account, for deployment only. Local development needs none.

## Local development

```sh
npm install
npm run dev        # Vite with the Worker in the local Workers runtime
npm test           # unit and API tests
npm run typecheck
npm run lint
npm run build      # client assets and Worker bundle in dist/
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

## Deployment

Not configured yet. Milestone 5 adds separate development and production
environments, a D1 database for each, and an explicitly triggered production
deploy.
