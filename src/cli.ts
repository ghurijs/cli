import { spawn as nodeSpawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { commandRegistry as cliCommandRegistry } from '@ghuri/core'
import { closest, parseArgv, parseOptionFlags, UsageError } from './argv'
import { BUILTIN_COMMANDS } from './commands/index'
import type { CliContext, CommandEntry, GlobalOptions, RunCliOptions, SpawnFn } from './context'
import {
  appCommandEntries,
  DEFAULT_ORM_COMMANDS,
  instantiateConfigs,
  mergeCommands,
  registerModuleCommands,
} from './discovery'
import { loadEnvFiles } from './dotenv'
import { commandSpec, formatCommandHelp, formatMainHelp, GLOBAL_OPTIONS, withGlobals } from './help'
import { type CliIO, createIO } from './io'
import { cliVersion, findProjectRoot, PACKAGE_ROOT, type ProjectRoot } from './paths'
import { loadProject, locateProject, type Project, ProjectError, type ProjectOptions } from './project'

/** Split argv into global options, the subcommand name and the subcommand's own argv. */
export function splitArgv(argv: string[]): { globals: GlobalOptions; command?: string; rest: string[] } {
  const globalSpecs = GLOBAL_OPTIONS.map(parseOptionFlags)
  const valueFlags = new Set(
    globalSpecs
      .filter((g) => g.value !== 'none')
      .flatMap((g) => [g.long && `--${g.long}`, g.short && `-${g.short}`]),
  )
  let command: string | undefined
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (tok === '--') {
      rest.push(...argv.slice(i))
      break
    }
    if (command === undefined && !tok.startsWith('-')) {
      command = tok
      continue
    }
    rest.push(tok)
    if (command === undefined && valueFlags.has(tok) && i + 1 < argv.length) rest.push(argv[++i])
  }
  // Pre-scan global options anywhere in argv (they're re-parsed with the command's spec later).
  let parsed: Record<string, unknown> = {}
  try {
    parsed = parseArgv(rest, { arguments: [], options: GLOBAL_OPTIONS }, { passthrough: true })
  } catch {}
  const globals: GlobalOptions = {
    settings: parsed.settings as string | undefined,
    env: parsed.env as string | undefined,
    remote: !!parsed.remote,
    persistTo: parsed.persistTo as string | undefined,
    traceback: !!parsed.traceback,
    noColor: !!parsed.noColor,
    help: !!parsed.help,
    version: rest.includes('--version') || rest.includes('-v'),
  }
  return { globals, command, rest }
}

const defaultSpawn: SpawnFn = (command, args, opts) =>
  new Promise((resolve, reject) => {
    const child = nodeSpawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) } as NodeJS.ProcessEnv,
      stdio: 'inherit',
      shell: process.platform === 'win32' && command !== process.execPath,
    })
    // Let the child handle Ctrl-C; we just wait for it.
    const ignore = () => {}
    process.on('SIGINT', ignore)
    child.on('error', (err) => {
      process.off('SIGINT', ignore)
      reject(err)
    })
    child.on('exit', (code, signal) => {
      process.off('SIGINT', ignore)
      resolve(code ?? (signal ? 1 : 0))
    })
  })

function builtinEntries(): CommandEntry[] {
  return Object.entries(BUILTIN_COMMANDS).map(([name, cls]) => ({
    name,
    cls,
    source: 'ghuri',
    builtin: true,
  }))
}

class Cli implements CliContext {
  cwd: string
  io: CliIO
  spawn: SpawnFn
  private project?: Project
  private setupResult?: { project: Project; ctx: any }
  private discovered?: CommandEntry[]
  /** Set when project commands could not be discovered (shown in `ghuri help`). */
  discoveryNote?: string

  constructor(
    public globals: GlobalOptions,
    public options: RunCliOptions,
  ) {
    this.cwd = options.cwd ?? process.cwd()
    this.io = createIO({
      stdout: options.stdout,
      stderr: options.stderr,
      stdin: options.stdin as any,
      interactive: options.interactive,
      color: globals.noColor ? false : options.color,
    })
    this.spawn = options.spawn ?? defaultSpawn
  }

  root(): ProjectRoot {
    const found = findProjectRoot(this.cwd, this.globals.settings)
    if (!found) {
      throw new ProjectError(
        `No Ghuri project found in ${this.cwd} or its parents (looked for package.json#ghuri.settings or src/settings.ts).`,
      )
    }
    return found
  }

  projectOptions(): ProjectOptions {
    return {
      cwd: this.cwd,
      settings: this.globals.settings,
      environment: this.globals.env,
      remote: this.globals.remote,
      persistTo: this.globals.persistTo,
      processEnv: this.options.env,
      getPlatformProxy: this.options.getPlatformProxy,
    }
  }

  async loadProject(extra: Partial<ProjectOptions> = {}): Promise<Project> {
    if (!this.project) this.project = await loadProject({ ...this.projectOptions(), ...extra })
    return this.project
  }

  async setup() {
    if (!this.setupResult) {
      const project = await this.loadProject()
      await this.registerOrm(project)
      const app = project.core.createApp(project.settingsFactory, { checks: false })
      const ctx = await app.setup(project.env)
      this.setupResult = { project, ctx }
      this.discovered = undefined
    }
    return this.setupResult
  }

  private ormNames?: Set<string>

  private async registerOrm(project: {
    jiti: { import(s: string): Promise<unknown> }
    core: typeof import('@ghuri/core')
  }) {
    if (this.ormNames) return
    this.ormNames = new Set()
    const specifier = this.options.ormCommandsModule ?? DEFAULT_ORM_COMMANDS
    let mod: any
    try {
      mod = await project.jiti.import(specifier)
    } catch (err) {
      const { isNotFound } = await import('./project')
      if (isNotFound(err, specifier)) return
      throw err
    }
    // Load migration files (`src/<app>/migrations/*.ts`) with the project's TypeScript loader, so they work
    // on every Node version and share module instances with the project (one @ghuri/orm).
    if (typeof mod?.setMigrationImporter === 'function') {
      mod.setMigrationImporter((file: string) => project.jiti.import(file))
    }
    this.ormNames = await registerModuleCommands(mod ?? {}, project.core.commandRegistry)
  }

  /** Commands from every source. Uses the populated app registry after setup, else a light discovery. */
  async commands(): Promise<CommandEntry[]> {
    if (this.discovered) return this.discovered
    const builtins = builtinEntries()
    let core: typeof import('@ghuri/core') | undefined
    let configs: any[] = []
    if (this.setupResult) {
      core = this.setupResult.project.core
      configs = core.apps.getAppConfigs()
    } else if (findProjectRoot(this.cwd, this.globals.settings)) {
      try {
        const located = await locateProject({ cwd: this.cwd, settings: this.globals.settings })
        core = located.core
        await this.registerOrm(located)
        // Resolve settings without bindings: enough to read INSTALLED_APPS.
        const env = { ...loadEnvFiles(located.root, this.globals.env), ...(this.options.env ?? process.env) }
        const settings = located.settingsFactory(env)
        configs = instantiateConfigs(settings.INSTALLED_APPS)
      } catch (err) {
        this.discoveryNote = `Note: only built-in commands are listed because the project could not be loaded (${firstLine(err)}).`
      }
    }
    const orm: CommandEntry[] = []
    const others: CommandEntry[] = []
    const apps = appCommandEntries(configs)
    const appNames = new Set(apps.map((a) => a.name))
    const registry = core?.commandRegistry ?? cliCommandRegistry
    for (const [name, cls] of registry.all()) {
      if (this.ormNames?.has(name)) orm.push({ name, cls, source: 'orm', builtin: false })
      else if (!appNames.has(name)) others.push({ name, cls, source: 'other', builtin: false })
    }
    this.discovered = mergeCommands(builtins, orm, others, apps)
    return this.discovered
  }

  runSelf(args: string[]): Promise<number> {
    const bin = join(PACKAGE_ROOT, 'dist', 'bin.js')
    const globals: string[] = []
    if (this.globals.settings) globals.push('--settings', this.globals.settings)
    if (this.globals.persistTo) globals.push('--persist-to', resolve(this.cwd, this.globals.persistTo))
    return this.spawn(process.execPath, [bin, ...args, ...globals], { cwd: this.cwd })
  }

  async dispose() {
    await this.project?.dispose()
  }
}

/**
 * A CLI context with project loading, setup and command discovery, without running a command (used by the
 * `ghuri mcp` worker). Call `dispose()` when done (closes DB connections and the bindings proxy).
 */
export function createCliContext(
  globals: GlobalOptions,
  options: RunCliOptions = {},
): CliContext & { dispose(): Promise<void> } {
  return new Cli(globals, options)
}

function firstLine(err: unknown): string {
  return String((err as Error)?.message ?? err).split('\n')[0]
}

/** Print `ghuri help` or `ghuri help <subcommand>`. */
export async function printHelp(cli: CliContext, subcommand?: string): Promise<number> {
  const entries = await cli.commands()
  const color = (cli.io as CliIO).color
  if (!subcommand) {
    cli.io.stdout(
      formatMainHelp(entries, { color, note: (cli as Cli).discoveryNote, version: cliVersion() }).trimEnd(),
    )
    return 0
  }
  const entry = entries.find((e) => e.name === subcommand)
  if (!entry) {
    const hint = closest(
      subcommand,
      entries.map((e) => e.name),
    )
    cli.io.stderr(
      `Unknown command: '${subcommand}'${hint ? `. Did you mean ${hint}?` : ''}\nType 'ghuri help' for usage.`,
    )
    return 1
  }
  cli.io.stdout(formatCommandHelp(subcommand, entry, commandSpec(entry, cli), { color }).trimEnd())
  return 0
}

/**
 * Run the CLI (what `bin.ts` calls). Returns the exit code instead of exiting, so it can be tested.
 *
 * ```ts
 * const code = await runCli(['startproject', 'mysite', '--no-install'], { cwd: '/tmp' })
 * ```
 */
export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const { globals, command, rest } = splitArgv(argv)
  const cli = new Cli(globals, options)
  const io = cli.io
  try {
    if (!command) {
      if (globals.version) {
        io.stdout(cliVersion())
        return 0
      }
      return await printHelp(cli)
    }
    let entry: CommandEntry | undefined = BUILTIN_COMMANDS[command]
      ? { name: command, cls: BUILTIN_COMMANDS[command], source: 'ghuri', builtin: true }
      : undefined
    const level = entry ? ((entry.cls as any).project ?? 'none') : 'setup'

    if (globals.help) {
      if (!entry) entry = (await cli.commands()).find((e) => e.name === command)
      if (!entry) return await printHelp(cli, command)
      io.stdout(formatCommandHelp(command, entry, commandSpec(entry, cli), { color: io.color }).trimEnd())
      return 0
    }

    if (!entry && !findProjectRoot(cli.cwd, globals.settings)) {
      const hint = closest(command, Object.keys(BUILTIN_COMMANDS))
      io.stderr(`Unknown command: '${command}'${hint ? `. Did you mean ${hint}?` : ''}`)
      io.stderr(
        "Type 'ghuri help' for usage. Project commands (migrate, createsuperuser, …) need a Ghuri project.",
      )
      return 1
    }
    if (level === 'setup') {
      await cli.setup()
      const found = (await cli.commands()).find((e) => e.name === command)
      if (!found) {
        const hint = closest(
          command,
          (await cli.commands()).map((e) => e.name),
        )
        io.stderr(
          `Unknown command: '${command}'${hint ? `. Did you mean ${hint}?` : ''}\nType 'ghuri help' for usage.`,
        )
        return 1
      }
      entry = found
    }
    if (!entry) throw new Error(`Unknown command: '${command}'`)

    const spec = withGlobals(commandSpec(entry, cli))
    const args = parseArgv(rest, spec, { passthrough: !!(entry.cls as any).passthrough })
    const cmdIO: CliIO = args.noInput
      ? { ...io, interactive: false, prompt: undefined, confirm: undefined }
      : io
    const inst = entry.builtin ? new (entry.cls as any)(cli) : new (entry.cls as any)()
    const result = await inst.handle(args, cmdIO)
    return typeof result === 'number' ? result : 0
  } catch (err) {
    return reportError(err, io, globals, command)
  } finally {
    try {
      await cli.dispose()
    } catch (err) {
      if (globals.traceback) io.stderr(String((err as Error)?.stack ?? err))
    }
  }
}

function reportError(err: unknown, io: CliIO, globals: GlobalOptions, command?: string): number {
  const e = err as any
  if (err instanceof UsageError) {
    io.stderr(`${io.style.bold(`ghuri ${command ?? ''}`.trim())}: error: ${e.message}`)
    io.stderr(`Type 'ghuri ${command ? `${command} --help` : 'help'}' for usage.`)
    return 2
  }
  const name = e?.constructor?.name ?? 'Error'
  const isCommandError = name === 'CommandError' || typeof e?.returncode === 'number'
  if (globals.traceback) io.stderr(String(e?.stack ?? err))
  else if (isCommandError || name === 'ProjectError' || name === 'ScaffoldError') {
    io.stderr(io.style.error(`${name === 'CommandError' ? 'CommandError: ' : ''}${e.message}`))
  } else {
    io.stderr(io.style.error(`${name}: ${e?.message ?? String(err)}`))
    if (e?.cause) io.stderr(io.style.error(`  caused by: ${firstLine(e.cause)}`))
    io.stderr('(run with --traceback for the full stack trace)')
  }
  return typeof e?.returncode === 'number' && e.returncode > 0 ? e.returncode : 1
}
