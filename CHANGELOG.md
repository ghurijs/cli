# Changelog

## 0.1.0-alpha.5

- `startproject` adds `better-sqlite3` (`^13.1.0`) to the devDependencies of `d1` and `postgres` projects
  (`sqlite` projects already depend on it): `setupTestDatabase()` defaults to SQLite, so `ghuri test` failed in
  new projects with "Cannot find package 'better-sqlite3'".
- `startproject` writes `@ghuri/*` ranges from one versions map (`src/versions.ts`, exported as
  `GHURI_PACKAGE_VERSIONS` / `ghuriRange()`) instead of hard-coded `^0.1.0-alpha.0` ranges, which let npm install
  the stale `latest` releases. New projects now start at `@ghuri/core ^0.1.0-alpha.1`, `@ghuri/orm ^0.1.0-alpha.3`,
  `@ghuri/auth ^0.1.0-alpha.4`, `@ghuri/graphql ^0.1.0-alpha.1`, `@ghuri/rest ^0.1.0-alpha.1`,
  `@ghuri/cli ^0.1.0-alpha.4`, `@ghuri/admin` / `@ghuri/storage ^0.1.0-alpha.0`. A test keeps the map in sync with
  the workspace's `packages/*/package.json`.

## 0.1.0-alpha.4

- `ghuri mcp`: new read-only `openapi_schema` tool: the project's OpenAPI document (via `@ghuri/rest` `generateschema`), as a list of operations by default or JSON filtered by `path` prefix or `tag`.
- The project `AGENTS.md` lists `openapi_schema`.
- Tests: the packages generated projects import are devDependencies, so CI typechecks generated code against them.

## 0.1.0-alpha.3

- The `AGENTS.md` written by `startproject` covers social login (`@ghuri/socialauth`) and login strategies (`@ghuri/oauth`).

## 0.1.0-alpha.2

- `ghuri mcp` runs project processes one at a time, so parallel tool calls no longer fail with "database is locked" from wrangler's local D1.

## 0.1.0-alpha.1

- `ghuri mcp`: a Model Context Protocol server over stdio for AI coding agents (Claude Code, Codex, Cursor, VS Code) with `project_info`, `list_apps`, `list_models`, `describe_model`, `list_routes`, `list_commands`, `show_migrations`, `run_command`, `search_docs` and `get_doc`.
- `startproject` writes `AGENTS.md`, `CLAUDE.md` (importing it) and `.mcp.json` (runs `ghuri mcp` through the chosen package manager).
- `startproject` routes the OpenAPI schema (`api/schema/`), Swagger UI (`api/docs/`) and Scalar (`api/reference/`), adds `RestFrameworkConfig` (the `generateschema` command) to `INSTALLED_APPS`, and documents both in the project README.
- `startproject --graphql` adds `@ghuri/graphql` + `graphql` to the dependencies, `GraphQLConfig` to `INSTALLED_APPS`, `src/schema.ts` (`GRAPHQL.SCHEMA`) and `GraphQLView` at `/graphql/`; the project README explains how to add GraphQL later otherwise. `startapp` writes a commented `schema.ts` (`ModelType` with Relay filters / ordering, `Query`, `SerializerMutation`, `ModelMutation`). `graphql` is a reserved app name. The strict typecheck test covers a `--graphql` project with the app schema uncommented.
- Migration files are imported with the project's TypeScript loader (jiti) through `setMigrationImporter()`.
- `--persist-to <dir>` and the default state directory now match `wrangler dev` (`<dir>/v3`, `.wrangler/state/v3` next to the wrangler config, absolute paths), so CLI commands and `wrangler dev` share local D1/R2/KV data from any working directory.
- Generated `vitest.config.ts` enables oxc legacy decorators so `@action`, `@admin.register`, `@display` and `@tool` work in tests; longer test timeouts for D1/PGlite.
- The typecheck test no longer tolerates missing `@ghuri/*` modules: generated projects typecheck strictly against the real packages.

## 0.1.0-alpha.0

- `ghuri` binary and programmatic `runCli(argv, options)`.
- Argv parsing driven by `@ghuri/core` `ArgumentParser` specs (positionals incl. variadic, `-n, --name <value>`,
  `--no-x` negation, repeatable `<value...>` options, `--` passthrough), with "did you mean" suggestions.
- Project loading: project root discovery, `package.json#ghuri.settings`, TypeScript via jiti, `env` from wrangler's
  `getPlatformProxy()` (local by default, `--remote` for remote D1/R2/KV) merged with `.dev.vars` / `.env` /
  `process.env`.
- Command discovery: built-ins, `@ghuri/orm/commands` (`registerOrmCommands()`), `AppConfig.commands`; grouped
  `ghuri help` and per-command `--help`.
- Built-ins: `startproject`, `startapp`, `runserver` (wrangler dev / `--node`), `shell`, `check`, `test`, `deploy`,
  `routes` / `show_urls`, `diffsettings`, `version`, `help`.
- Project template (D1 / Postgres / SQLite) and app template under `templates/`.
