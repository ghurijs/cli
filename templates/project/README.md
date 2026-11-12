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
  urls.ts       URL patterns (admin at /admin/, REST API at /api/, API docs at /api/docs/{{#if graphql}}, GraphQL at /graphql/{{/if}})
{{#if graphql}}
  schema.ts     GraphQL schema (GRAPHQL.SCHEMA): merge your apps' Query / Mutation classes here
{{/if}}
```

Create an app with `{{exec}} ghuri startapp blog` — it is added to `INSTALLED_APPS` for you.
Then define models in `src/blog/models.ts` and run:

```bash
{{exec}} ghuri makemigrations
{{exec}} ghuri migrate
```

## REST API and OpenAPI

Register viewsets on the `router` in `src/urls.ts` (mounted at `/api/`). The API describes itself as OpenAPI 3.1:

| URL | What it serves |
|---|---|
| `/api/schema/` | The OpenAPI document (JSON) — import it into Postman, Insomnia or a client generator |
| `/api/docs/` | Swagger UI |
| `/api/reference/` | Scalar API reference |

`{{exec}} ghuri generateschema --file openapi.yaml` writes the same document to a file (`openapi.json` for JSON).
Adjust an operation with `@extendSchema({ summary, request, responses, tags })`, or set `schema = null` on a view to
leave it out.

{{#if graphql}}
## GraphQL

`/graphql/` serves `src/schema.ts` with `@ghuri/graphql` (GraphiQL in the browser when `DEBUG=true`). Each app
created with `ghuri startapp` has a commented `schema.ts` with a `ModelType`, a Relay connection with filters and
mutations that reuse your REST serializers — uncomment it and add its classes to `src/schema.ts`.
`{{exec}} ghuri graphql_schema --out schema.graphql` writes the SDL.

{{else}}
## GraphQL

To add a GraphQL API later: `npm install @ghuri/graphql graphql`, add `GraphQLConfig` to `INSTALLED_APPS`, create
`src/schema.ts` (`new Schema({ query: [...] })`), set `GRAPHQL: { SCHEMA: schema }` and route
`path('graphql/', GraphQLView.asView())` — or start with `ghuri startproject --graphql`. Each app's `schema.ts`
has a commented example.

{{/if}}
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
| `{{exec}} ghuri generateschema --file openapi.yaml` | Write the OpenAPI schema of the REST API |
{{#if cloudflare}}
| `{{exec}} ghuri deploy` | Apply remote migrations and `wrangler deploy` |
{{/if}}

## Working with AI coding agents

Ghuri is new, so coding agents tend to write Django, Prisma or plain Hono code instead. This project ships with:

- `AGENTS.md` — project instructions and a Ghuri API cheat-sheet, read by Codex, Cursor, Copilot, Gemini CLI and
  others; `CLAUDE.md` imports it for Claude Code.
- `.mcp.json` — registers the Ghuri MCP server (`{{exec}} ghuri mcp`) so Claude Code and other MCP clients can
  inspect the project.
- The Ghuri skill: `/plugin marketplace add ghurijs/ghuri` then `/plugin install ghuri@ghuri` in Claude Code, or
  `npx skills add ghurijs/ghuri` for other agents.
- Docs for LLMs: [llms.txt](https://ghurijs.github.io/docs/llms.txt) and
  [llms-full.txt](https://ghurijs.github.io/docs/llms-full.txt).

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
