# Changelog

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
