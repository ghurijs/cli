import { inspect } from 'node:util'
import type { ArgumentParser, CommandIO, GhuriContext } from '@ghuri/core'
import { cliVersion, findPackageDir, readJson } from '../paths'
import type { Project } from '../project'
import { BuiltinCommand } from './base'

const IDENT = /^[A-Za-z_$][\w$]*$/

/** Names available in `ghuri shell`: apps, settings, env, core, orm, every model by class name. */
export async function shellScope(project: Project, ctx: GhuriContext): Promise<Record<string, unknown>> {
  const { apps } = project.core
  const scope: Record<string, unknown> = {
    apps,
    settings: ctx.settings,
    env: project.env,
    core: project.core,
    getModel: (label: string) => apps.getModel(label),
  }
  const orm = await project.tryImport('@ghuri/orm')
  if (orm) scope.orm = orm
  for (const model of apps.getModels() as any[]) {
    const name = model?.name || model?._meta?.objectName
    if (!name || !IDENT.test(name)) continue
    const key = name in scope ? `${model?._meta?.appLabel ?? 'app'}_${name}` : name
    scope[key] = model
  }
  return scope
}

/** Evaluate code with `scope` names in context; supports top-level await and returns the last expression. */
export async function evaluate(code: string, scope: Record<string, unknown>): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (...a: unknown[]) => Promise<unknown>
  const names = Object.keys(scope).filter((n) => IDENT.test(n))
  let fn: (...a: unknown[]) => Promise<unknown>
  try {
    fn = new AsyncFunction(...names, `return (${code}\n)`)
  } catch {
    fn = new AsyncFunction(...names, code)
  }
  return fn(...names.map((n) => scope[n]))
}

async function readStdin(stream: NodeJS.ReadableStream): Promise<string> {
  let data = ''
  for await (const chunk of stream as AsyncIterable<Buffer | string>) data += chunk.toString()
  return data
}

export class ShellCommand extends BuiltinCommand {
  static help =
    'Runs a REPL with the project loaded. Available: apps, settings, env, core, orm and every model by class name; top-level await works.'
  static project = 'setup' as const

  addArguments(parser: ArgumentParser): void {
    parser.option('-c, --command <code>', { help: 'Run code and exit instead of starting the REPL.' })
  }

  async handle(args: Record<string, unknown>, io: CommandIO): Promise<number> {
    const { project, ctx } = await this.cli.setup()
    const scope = await shellScope(project, ctx)
    const stdin = (this.cli.options.stdin ?? process.stdin) as NodeJS.ReadableStream & { isTTY?: boolean }
    const run = async (code: string) => {
      const result = await evaluate(code, scope)
      if (result !== undefined) io.stdout(inspect(result, { colors: (io as any).color, depth: 4 }))
    }
    if (typeof args.command === 'string') {
      await run(args.command)
      return 0
    }
    if (!stdin.isTTY) {
      const code = await readStdin(stdin)
      if (code.trim()) await run(code)
      return 0
    }
    const repl = await import('node:repl')
    const models = Object.keys(scope).filter(
      (k) => !['apps', 'settings', 'env', 'core', 'orm', 'getModel'].includes(k),
    )
    io.stdout(
      io.style.bold('Ghuri shell') + io.style.notice(' — top-level await is supported, .exit to quit.'),
    )
    io.stdout(`Available: apps, settings, env, core${scope.orm ? ', orm' : ''}, getModel()`)
    io.stdout(`Models: ${models.length ? models.join(', ') : '(none)'}`)
    const server = repl.start({ prompt: 'ghuri> ', useGlobal: false })
    Object.assign(server.context, scope)
    await new Promise<void>((resolve) => server.on('exit', () => resolve()))
    return 0
  }
}

export class CheckCommand extends BuiltinCommand {
  static help = 'Checks the entire Ghuri project for potential problems (system checks).'
  static project = 'setup' as const

  addArguments(parser: ArgumentParser): void {
    parser
      .option('--deploy', { help: 'Also run checks relevant to a production deployment.' })
      .option('-t, --tag <tag...>', { help: 'Run only checks labelled with this tag (repeatable).' })
      .option('--fail-level <level>', {
        help: 'Message level that makes the command exit with a non-zero status: CRITICAL, ERROR, WARNING, INFO or DEBUG.',
        default: 'ERROR',
      })
      .option('--list-tags', { help: 'List available tags.' })
  }

  async handle(args: Record<string, unknown>, io: CommandIO): Promise<number> {
    const { project, ctx } = await this.cli.setup()
    const { checks, runChecks, CheckLevel } = project.core
    if (args.listTags) {
      for (const t of checks.tags.sort()) io.stdout(t)
      return 0
    }
    const tags = (args.tag as string[] | undefined)?.length ? (args.tag as string[]) : undefined
    const messages = await runChecks({ deploy: !!args.deploy, tags, settings: ctx.settings })
    const failLevel = (CheckLevel as Record<string, number>)[String(args.failLevel).toUpperCase()]
    if (failLevel === undefined) {
      io.stderr(io.style.error(`Unknown --fail-level '${args.failLevel}'.`))
      return 2
    }
    const silenced = ((ctx.settings.SILENCED_SYSTEM_CHECKS as string[]) ?? []).length
    if (!messages.length) {
      io.stdout(`System check identified no issues (${silenced} silenced).`)
      return 0
    }
    const groups: Array<[string, (l: number) => boolean, (s: string) => string]> = [
      ['CRITICALS', (l) => l >= CheckLevel.CRITICAL, io.style.error],
      ['ERRORS', (l) => l >= CheckLevel.ERROR && l < CheckLevel.CRITICAL, io.style.error],
      ['WARNINGS', (l) => l >= CheckLevel.WARNING && l < CheckLevel.ERROR, io.style.warning],
      ['INFOS', (l) => l >= CheckLevel.INFO && l < CheckLevel.WARNING, (s) => s],
      ['DEBUGS', (l) => l < CheckLevel.INFO, (s) => s],
    ]
    const failed = messages.some((m) => m.level >= failLevel)
    const out: string[] = [
      failed
        ? io.style.error('SystemCheckError: System check identified some issues:')
        : 'System check identified some issues:',
    ]
    for (const [title, match, color] of groups) {
      const list = messages.filter((m) => match(m.level))
      if (!list.length) continue
      out.push('', `${title}:`)
      for (const m of list) out.push(color(m.toString()))
    }
    out.push(
      '',
      `System check identified ${messages.length} issue${messages.length === 1 ? '' : 's'} (${silenced} silenced).`,
    )
    ;(failed ? io.stderr : io.stdout)(out.join('\n'))
    return failed ? 1 : 0
  }
}

export interface RouteRow {
  pattern: string
  name: string
  methods: string
  view: string
}

/** URL patterns of the project's ROOT_URLCONF (used by `ghuri routes` and `ghuri mcp`). */
export function collectRoutes(project: Project, ctx: GhuriContext): RouteRow[] {
  const resolver = project.core.getResolver(ctx.settings.ROOT_URLCONF as any)
  return resolver.routes.map((r: any) => ({
    pattern: `/${r.pattern}`,
    name: r.fullName ?? '',
    methods: r.methods?.join(',') ?? (r.kind === 'app' ? '*' : 'ANY'),
    view: r.kind === 'app' ? '(Hono app)' : r.view?.viewClass?.name || r.view?.name || '(anonymous)',
  }))
}

export class RoutesCommand extends BuiltinCommand {
  static help = 'Lists URL patterns with their names, methods and views. Like django-extensions show_urls.'
  static project = 'setup' as const

  addArguments(parser: ArgumentParser): void {
    parser.option('--format <format>', { help: 'Output format: table or json.', default: 'table' })
  }

  async handle(args: Record<string, unknown>, io: CommandIO): Promise<number> {
    const { project, ctx } = await this.cli.setup()
    const rows = collectRoutes(project, ctx)
    if (args.format === 'json') {
      io.stdout(JSON.stringify(rows, null, 2))
      return 0
    }
    if (!rows.length) {
      io.stdout('No URL patterns.')
      return 0
    }
    const head: RouteRow = { pattern: 'PATTERN', name: 'NAME', methods: 'METHODS', view: 'VIEW' }
    const all = [head, ...rows]
    const w = (k: keyof RouteRow) => Math.max(...all.map((r) => r[k].length))
    const widths = { pattern: w('pattern'), name: w('name'), methods: w('methods') }
    const line = (r: RouteRow) =>
      `${r.pattern.padEnd(widths.pattern)}  ${r.name.padEnd(widths.name)}  ${r.methods.padEnd(widths.methods)}  ${r.view}`.trimEnd()
    io.stdout(io.style.bold(line(head)))
    for (const r of rows) io.stdout(line(r))
    return 0
  }
}

/** Defaults applied by `defineSettings` in @ghuri/core (kept in sync by hand; used by diffsettings). */
export const CORE_DEFAULTS: Record<string, unknown> = {
  DEBUG: false,
  ALLOWED_HOSTS: ['*'],
  MIDDLEWARE: [],
  APPEND_SLASH: true,
  TIME_ZONE: 'UTC',
  USE_TZ: true,
  CSRF_TRUSTED_ORIGINS: [],
  CORS: false,
}

const SECRET = /SECRET|PASSWORD|TOKEN|API_?KEY|PRIVATE/i

export class DiffSettingsCommand extends BuiltinCommand {
  static help = "Displays differences between the current settings and Ghuri's default settings."
  static project = 'setup' as const

  addArguments(parser: ArgumentParser): void {
    parser
      .option('--all', { help: 'Display all settings, marking non-defaults with "###".' })
      .option('--show-secrets', { help: 'Show SECRET_KEY and other secret-looking values.' })
  }

  async handle(args: Record<string, unknown>, io: CommandIO): Promise<number> {
    const { ctx } = await this.cli.setup()
    const settings = ctx.settings as Record<string, unknown>
    for (const key of Object.keys(settings).sort()) {
      const value = settings[key]
      const isDefault = key in CORE_DEFAULTS && inspect(CORE_DEFAULTS[key]) === inspect(value)
      if (isDefault && !args.all) continue
      const shown =
        SECRET.test(key) && !args.showSecrets && typeof value === 'string'
          ? value
            ? "'********'"
            : "''"
          : inspect(value, { depth: 3, breakLength: 100 })
      io.stdout(`${key} = ${shown}${args.all && !isDefault ? '  ###' : ''}`)
    }
    return 0
  }
}

export class VersionCommand extends BuiltinCommand {
  static help =
    'Shows version information. Includes the Ghuri packages, wrangler and Node.js used by the current project.'

  addArguments(parser: ArgumentParser): void {
    parser.option('--short', { help: 'Print only the CLI version.' })
  }

  async handle(args: Record<string, unknown>, io: CommandIO): Promise<number> {
    io.stdout(args.short ? cliVersion() : `ghuri ${cliVersion()}`)
    if (args.short) return 0
    let root: string | undefined
    try {
      root = this.cli.root().root
    } catch {}
    const base = root ?? this.cli.cwd
    for (const pkg of [
      '@ghuri/core',
      '@ghuri/orm',
      '@ghuri/auth',
      '@ghuri/rest',
      '@ghuri/admin',
      '@ghuri/storage',
      '@ghuri/agents',
      'hono',
      'wrangler',
    ]) {
      const dir = findPackageDir(pkg, base)
      if (dir) io.stdout(`${pkg.padEnd(16)} ${readJson(`${dir}/package.json`).version}`)
    }
    io.stdout(`${'node'.padEnd(16)} ${process.version}`)
    return 0
  }
}

export class HelpCommand extends BuiltinCommand {
  static help = 'Lists the available commands, or shows help for one: ghuri help <subcommand>.'

  addArguments(parser: ArgumentParser): void {
    parser.argument('subcommand', { help: 'Command to show help for.' })
  }

  async handle(args: Record<string, unknown>): Promise<number> {
    const { printHelp } = await import('../cli')
    return printHelp(this.cli, args.subcommand as string | undefined)
  }
}
