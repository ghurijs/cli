# @ghuri/cli

The `ghuri` command — Django's `django-admin` / `manage.py` for [Ghuri](https://github.com/ghurijs/ghuri),
Django for TypeScript on Cloudflare Workers (Hono + Drizzle + D1 + R2), portable to Postgres / Node.

> Status: alpha (`0.1.0-alpha.0`). APIs may change.

```bash
npm create ghuri@latest mysite        # or: npx @ghuri/cli@next startproject mysite
cd mysite
npx ghuri migrate
npx ghuri createsuperuser
npm run dev
```

Projects list `@ghuri/cli` as a dev dependency, so inside a project `npx ghuri …` (or the `ghuri`
package script: `npm run ghuri -- …`) uses the project's own copy.

## How it works

1. **Finds the project**: walks up from the current directory to the nearest `package.json` with a
   `ghuri` key or a `src/settings.ts`. The settings module is `package.json#ghuri.settings`
   (default `src/settings.ts`), or `--settings <path>`.
2. **Loads TypeScript** with [jiti](https://github.com/unjs/jiti) — no build step. Migration files are loaded
   the same way (`setMigrationImporter()` from `@ghuri/orm/commands`), and decorators (`@action`,
   `@admin.register`, `@display`, `@tool`) work (jiti compiles them as legacy decorators, which every Ghuri
   decorator supports; `wrangler` / esbuild compile them as standard ones).
3. **Builds `env`**, in precedence order (high → low):
   - Worker **bindings** (D1, R2, KV, Hyperdrive, …) from `wrangler.jsonc` / `wrangler.json` /
     `wrangler.toml` through wrangler's `getPlatformProxy()` — **local** (Miniflare, state in
     `.wrangler/state`, shared with `wrangler dev`) by default, **remote** with `--remote`;
   - `process.env`;
   - `.dev.vars` (or `.dev.vars.<env>` with `--env`), then `.env`, `.env.local`, `.env.<env>`;
   - wrangler `vars`.

   Without a wrangler config (or without wrangler installed) `env` is `process.env` + the files above.
4. Runs `createApp(settings).setup(env)` (populates `INSTALLED_APPS`, registers app commands),
   runs the command, then closes DB connections and disposes the bindings proxy.

`--remote`: wrangler 4 enables remote bindings per binding (`"remote": true`). The CLI writes a
temporary copy of your config next to the original with every D1 / R2 / KV binding marked remote,
calls `getPlatformProxy({ remoteBindings: true })` and deletes the copy afterwards. You need
`wrangler login` and real ids (e.g. `database_id`) in the config.

## Commands

Run `ghuri help` for the full list (grouped by source, like `manage.py help`) and
`ghuri <command> --help` for a command's arguments and options.

### Global options (every command)

| Option | |
|---|---|
| `--settings <path>` | Settings module (default `package.json#ghuri.settings` or `src/settings.ts`) |
| `--env <name>` | Wrangler environment for bindings / vars (`[env.<name>]`) |
| `--remote` | Use remote D1 / R2 / KV bindings |
| `--persist-to <dir>` | Local binding state directory, same meaning as `wrangler dev --persist-to` (default `.wrangler/state` next to the wrangler config; Miniflare data lives in `<dir>/v3`) |
| `--traceback` | Print full stack traces |
| `--no-color` | Plain output (also honours `NO_COLOR`) |
| `-h, --help` | Help |

### Built-in (`[ghuri]`)

| Command | Description |
|---|---|
| `startproject <name> [directory] [--db d1\|postgres\|sqlite] [--pm npm\|pnpm\|bun\|yarn] [--graphql] [--no-install]` | Create a project. `d1` (default): Cloudflare D1 + R2. `postgres`: Hyperdrive on Workers / `DATABASE_URL` elsewhere. `sqlite`: Node project (better-sqlite3, file storage, no wrangler). `--graphql`: add `@ghuri/graphql` (`GraphQLConfig`, `src/schema.ts`, `GRAPHQL.SCHEMA`, `GraphQLView` at `/graphql/`). Generates a random `SECRET_KEY` into `.dev.vars`. Works outside a project. |
| `startapp <name> [directory] [--no-register]` | Create `src/<name>/` (`app.ts`, `models.ts`, `views.ts`, `urls.ts`, `serializers.ts`, `schema.ts` (commented GraphQL example), `admin.ts`, `tests.ts`, `migrations/index.ts`) and add the `AppConfig` to `INSTALLED_APPS` (import + list entry) when the settings file has the usual shape. |
| `runserver [addrport] [-p, --port <port>] [--host <host>] [--node] [--remote]` | `wrangler dev` (default for projects with a wrangler config; extra args are forwarded). `--node` (or no wrangler config) serves the app with `@ghuri/core/node` on port 8000, still using local wrangler bindings when available. |
| `shell [-c, --command <code>]` | Node REPL with `apps`, `settings`, `env`, `core`, `orm`, `getModel()` and every model by class name; top-level `await` works. `-c` (or piped stdin) evaluates and prints the result. |
| `check [--deploy] [-t, --tag <tag>] [--fail-level <level>] [--list-tags]` | Run system checks (`runChecks()` from `@ghuri/core`). |
| `test [--watch] [vitest args…]` | `vitest run` (or watch mode) in the project. |
| `deploy [--migrate] [--skip-migrations] [--dry-run] [--no-input] [wrangler args…]` | Optionally run `ghuri migrate --remote` (asks; `--migrate` to skip the question), then `wrangler deploy`. |
| `routes [--format table\|json]` (alias `show_urls`) | List URL patterns with names, methods and views. |
| `diffsettings [--all] [--show-secrets]` | Settings that differ from core defaults (secrets masked). |
| `version [--short]` | CLI version plus the project's `@ghuri/*`, hono, wrangler and Node versions. `ghuri --version` prints just the CLI version. |
| `help [subcommand]` | List commands / show one command's help. |
| `mcp [--docs-url <url>]` | Run a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio for AI coding agents. See [AI coding agents (MCP)](#ai-coding-agents-mcp). |

### From `@ghuri/orm` (`[orm]`)

Discovered from `@ghuri/orm/commands` when the project has `@ghuri/orm` installed:
`makemigrations`, `migrate`, `showmigrations`, `sqlmigrate`, `dumpdata`, `loaddata`, `copydata`,
`flush` — all accept `--database <alias>`, and `--remote` to run against remote D1. See the
`@ghuri/orm` README for their options. The CLI calls `registerOrmCommands(commandRegistry)` when the
module exports it, else registers a `commands` map or exported `XxxCommand` classes
(named by `static commandName` or the lower-cased class name without `Command`).

### From apps (`[<app label>]`)

Every `AppConfig.commands` entry, e.g. `createsuperuser` and `changepassword` from `@ghuri/auth`.
App commands can override built-ins (except `help`).

## AI coding agents (MCP)

`ghuri mcp` is a development-time [Model Context Protocol](https://modelcontextprotocol.io) server over
stdio. Connect Claude Code, Codex, Cursor, VS Code or any MCP client to it and the agent can look at the
real project (instead of guessing) and run management commands:

| Tool | |
|---|---|
| `project_info` | Root, settings module, runtime (cloudflare/node), bindings, `DEBUG`, `INSTALLED_APPS`, `DATABASES` (engine/name), `STORAGES`, `CACHES`, `MIDDLEWARE`, other settings (secrets hidden), installed `@ghuri/*` versions |
| `list_apps` | Installed apps: label, name, path, models, commands, migrations |
| `list_models` | Every model (`app_label.ModelName`), its table and fields |
| `describe_model` | One model: fields and options, relations (target, `onDelete`, `relatedName`), reverse relations, Meta, managers |
| `list_routes` | URL patterns (like `ghuri routes`) |
| `openapi_schema` | The REST API as OpenAPI 3.1 (like `ghuri generateschema`): one line per operation (`GET /api/posts/ — listPosts [posts]`), or the JSON of the operations under a `path` prefix or with a `tag`, plus the components they use |
| `list_commands` | Every command, grouped like `ghuri help`; full usage of one command |
| `show_migrations` | Applied / unapplied migrations per app on the local database |
| `run_command` | Run a management command (`check`, `makemigrations`, `migrate`, `test`, `startapp`, app commands, …) and return its exit code and output |
| `search_docs`, `get_doc` | Search and read the Ghuri docs ([llms-full.txt](https://ghurijs.github.io/docs/llms-full.txt)) |

Every introspection call loads the project in a fresh child process (cached until a source file
changes), so models, routes and settings the agent just edited are picked up, and a syntax error comes
back as a tool error instead of stopping the server. Nothing but protocol messages is written to stdout;
anything the project prints goes to stderr. `run_command` refuses `runserver`, `shell`, `dbshell`,
`deploy`, `flush`, `startproject`, `mcp`, `createsuperuser` without `--no-input`, `test --watch` and
`--remote` (agents never touch production bindings). Commands run without prompts and are killed after
`timeoutSeconds` (default 300).

Run the server from the project directory (`npx` then uses the project's own `@ghuri/cli`).
New projects created with `ghuri startproject` already include a `.mcp.json`.

**Claude Code**

```bash
claude mcp add ghuri -- npx ghuri mcp            # just you
claude mcp add --scope project ghuri -- npx ghuri mcp   # writes .mcp.json for the team
```

or commit a `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "ghuri": { "command": "npx", "args": ["ghuri", "mcp"] }
  }
}
```

**Codex** (`~/.codex/config.toml`, or `.codex/config.toml` in a trusted project):

```toml
[mcp_servers.ghuri]
command = "npx"
args = ["ghuri", "mcp"]
```

**Cursor** (`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ghuri": { "command": "npx", "args": ["ghuri", "mcp"] }
  }
}
```

**VS Code** (`.vscode/mcp.json`; note the `servers` key):

```json
{
  "servers": {
    "ghuri": { "type": "stdio", "command": "npx", "args": ["ghuri", "mcp"] }
  }
}
```

**Any other client**: command `npx`, arguments `ghuri mcp`, transport stdio, working directory the
project root. Global options work as usual (`npx ghuri mcp --settings src/settings.ts --env staging`).
`--docs-url <url or file>` (or `GHURI_DOCS_URL`) reads the docs from somewhere else, e.g. a local
`llms-full.txt`.

## Writing a command

```ts
// src/blog/commands.ts
import { type ArgumentParser, BaseCommand, CommandError, type CommandIO } from '@ghuri/core'
import { Post } from './models'

export class PublishCommand extends BaseCommand {
  static help = 'Publishes posts by slug.'

  addArguments(parser: ArgumentParser) {
    parser
      .argument('slugs', { help: 'Post slugs.', variadic: true, required: true })
      .option('-n, --dry-run', { help: "Don't save." })
      .option('--limit <n>', { help: 'Max posts.', default: 10 })
      .option('--no-input', { help: 'Never prompt.' })
  }

  async handle(args: Record<string, unknown>, io: CommandIO) {
    const n = await Post.objects.filter({ slug__in: args.slugs }).update({ published: true })
    io.stdout(io.style.success(`Published ${n} posts.`))
  }
}
// src/blog/app.ts:  commands = { publish: PublishCommand }
```

Argument parsing rules:

- Positionals fill `.argument()`s in order; they are optional unless `required: true`;
  `variadic: true` collects the rest into an array.
- Option keys are the camel-cased long flag: `--dry-run` → `args.dryRun`. Boolean flags default to
  `false`. `<value>` options take a value (`--limit 5`, `--limit=5`, `-l5`); numbers are coerced
  when the default is a number. `<value...>` options are repeatable and collect an array.
- `--no-x` sets `args.noX = true` and `args.x = false` (defaults `false` / `true`). `--noinput` is
  accepted for `--no-input`. With `--no-input` (or when stdin isn't a TTY) `io.prompt` and
  `io.confirm` are `undefined`.
- Global options are also present in `args` (`args.settings`, `args.remote`, …).
- `handle()` may return an exit code; throw `CommandError(message, returncode)` for clean errors.
- Everything after `--` is in `args._`.

## Programmatic API

```ts
import { runCli, startProject, startApp } from '@ghuri/cli'

const code = await runCli(['migrate', '--database', 'pg'], { cwd: '/path/to/project' })
const { directory, nextSteps } = startProject({ name: 'mysite', db: 'd1', pm: 'npm' })
```

`runCli(argv, options)` returns the exit code; options include `cwd`, `stdout` / `stderr` sinks,
`interactive`, `color`, `env` (base environment instead of `process.env`), `spawn` (replace child
processes), `getPlatformProxy` and `ormCommandsModule` (tests).

## Templates

`startproject` / `startapp` render the files in `templates/project` and `templates/app` — they are
the single place the generated code lives. Syntax: `{{var}}` substitution and
`{{#if flag}}…{{else}}…{{/if}}` blocks (flags: `d1`, `postgres`, `sqlite`, `cloudflare`, `node`, `graphql`);
files named `_x` are written as `.x`, `x.tpl` as `x`; `template.json` can skip files per flag.

The `@ghuri/*` ranges in the generated `package.json` come from `src/versions.ts` (`GHURI_PACKAGE_VERSIONS`,
rendered as `{{coreRange}}`, `{{ormRange}}`, …): each is `^` + the package's current release, because npm
installs the `latest` dist-tag whenever it satisfies a range and `latest` can lag behind `next`. Bump an entry
when releasing that package; `test/versions.test.ts` compares the map with `packages/*/package.json` when the
sibling repos are checked out. Every project gets `better-sqlite3` (a devDependency for `d1` / `postgres`, a
dependency for `sqlite`) because `setupTestDatabase()` defaults to SQLite.

## License

MIT
