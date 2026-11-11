# {{name}}

A [Ghuri](https://github.com/ghurijs/ghuri) project — Django for TypeScript{{#if cloudflare}}, running on Cloudflare Workers{{else}}, running on Node.js{{/if}}.

## Getting started

```bash
{{install}}
{{#if d1}}
# Local development works right away (wrangler simulates D1 / R2 locally).
{{/if}}
{{#if postgres}}
# Point DATABASE_URL in .dev.vars at a running Postgres database first.
{{/if}}
{{exec}} ghuri migrate            # create the database tables
{{exec}} ghuri createsuperuser    # create an admin user
{{run}} dev                    # http://localhost:{{#if cloudflare}}8787{{else}}8000{{/if}}/admin/
```

## Project layout

```
src/
  index.ts      Worker entry (createApp(settings))
  server.ts     Node / VPS entry
  settings.ts   settings: INSTALLED_APPS, MIDDLEWARE, DATABASES, STORAGES, …
  urls.ts       URL patterns (admin at /admin/, REST API at /api/)
```

Create an app with `{{exec}} ghuri startapp blog` — it is added to `INSTALLED_APPS` for you.
Then define models in `src/blog/models.ts` and run:

```bash
{{exec}} ghuri makemigrations
{{exec}} ghuri migrate
```

## Useful commands

| Command | What it does |
|---|---|
| `{{exec}} ghuri help` | List every command (including those added by apps) |
| `{{exec}} ghuri runserver` | Development server ({{#if cloudflare}}`wrangler dev`; `--node` for Node{{else}}Node{{/if}}) |
| `{{exec}} ghuri shell` | REPL with your models and settings loaded |
| `{{exec}} ghuri routes` | List URL patterns and their names |
| `{{exec}} ghuri check` | System checks (`--deploy` for production checks) |
| `{{exec}} ghuri test` | Run the tests (vitest) |
| `{{exec}} ghuri dumpdata > data.json` | Export data as JSON fixtures |
{{#if cloudflare}}
| `{{exec}} ghuri deploy` | Apply remote migrations and `wrangler deploy` |
{{/if}}

{{#if cloudflare}}
## Deploying to Cloudflare

```bash
{{#if d1}}
{{exec}} wrangler d1 create {{pkgName}}-db        # paste database_id into wrangler.jsonc
{{/if}}
{{exec}} wrangler r2 bucket create {{pkgName}}-media
{{exec}} wrangler secret put SECRET_KEY
{{exec}} ghuri migrate --remote
{{exec}} ghuri deploy
```

{{/if}}
## Running on Node / a VPS

```bash
DATABASE_URL=postgres://… SECRET_KEY=… {{run}} start
```

`src/server.ts` serves the same app with `@ghuri/core/node`. With `DATABASE_URL` set, `DATABASES`
switches to Postgres — move existing data with `ghuri dumpdata` / `ghuri loaddata`.
