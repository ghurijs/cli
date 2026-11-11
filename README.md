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
2. **Loads TypeScript** with [jiti](https://github.com/unjs/jiti) — no build step.
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
| `--persist-to <dir>` | Local binding state directory (default `.wrangler/state`) |
| `--traceback` | Print full stack traces |
| `--no-color` | Plain output (also honours `NO_COLOR`) |
| `-h, --help` | Help |

### Built-in (`[ghuri]`)

| Command | Description |
|---|---|
| `startproject <name> [directory] [--db d1\|postgres\|sqlite] [--pm npm\|pnpm\|bun\|yarn] [--no-install]` | Create a project. `d1` (default): Cloudflare D1 + R2. `postgres`: Hyperdrive on Workers / `DATABASE_URL` elsewhere. `sqlite`: Node project (better-sqlite3, file storage, no wrangler). Generates a random `SECRET_KEY` into `.dev.vars`. Works outside a project. |
| `startapp <name> [directory] [--no-register]` | Create `src/<name>/` (`app.ts`, `models.ts`, `views.ts`, `urls.ts`, `serializers.ts`, `admin.ts`, `tests.ts`, `migrations/index.ts`) and add the `AppConfig` to `INSTALLED_APPS` (import + list entry) when the settings file has the usual shape. |
| `runserver [addrport] [-p, --port <port>] [--host <host>] [--node] [--remote]` | `wrangler dev` (default for projects with a wrangler config; extra args are forwarded). `--node` (or no wrangler config) serves the app with `@ghuri/core/node` on port 8000, still using local wrangler bindings when available. |
| `shell [-c, --command <code>]` | Node REPL with `apps`, `settings`, `env`, `core`, `orm`, `getModel()` and every model by class name; top-level `await` works. `-c` (or piped stdin) evaluates and prints the result. |
| `check [--deploy] [-t, --tag <tag>] [--fail-level <level>] [--list-tags]` | Run system checks (`runChecks()` from `@ghuri/core`). |
| `test [--watch] [vitest args…]` | `vitest run` (or watch mode) in the project. |
| `deploy [--migrate] [--skip-migrations] [--dry-run] [--no-input] [wrangler args…]` | Optionally run `ghuri migrate --remote` (asks; `--migrate` to skip the question), then `wrangler deploy`. |
| `routes [--format table\|json]` (alias `show_urls`) | List URL patterns with names, methods and views. |
| `diffsettings [--all] [--show-secrets]` | Settings that differ from core defaults (secrets masked). |
| `version [--short]` | CLI version plus the project's `@ghuri/*`, hono, wrangler and Node versions. `ghuri --version` prints just the CLI version. |
| `help [subcommand]` | List commands / show one command's help. |

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
`{{#if flag}}…{{else}}…{{/if}}` blocks (flags: `d1`, `postgres`, `sqlite`, `cloudflare`, `node`);
files named `_x` are written as `.x`, `x.tpl` as `x`; `template.json` can skip files per flag.

## License

MIT
