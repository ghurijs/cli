import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ArgumentParser, CommandIO } from '@ghuri/core'
import { findBin, findWranglerConfig } from '../paths'
import { BuiltinCommand, CommandError } from './base'

function wranglerBin(root: string): string {
  const bin = findBin('wrangler', root)
  if (!bin)
    throw new CommandError(
      'wrangler is not installed in this project. Install it with: npm install -D wrangler',
    )
  return bin
}

/** `8000`, `0.0.0.0:8000`, `[::1]:8000` → { host, port }. */
export function parseAddrPort(value: string | undefined): { host?: string; port?: number } {
  if (!value) return {}
  const m = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(value)
  if (m) return { host: m[1] ?? m[2], port: Number(m[3]) }
  if (/^\d+$/.test(value)) return { port: Number(value) }
  throw new CommandError(`"${value}" is not a valid port number or address:port pair.`)
}

export class RunServerCommand extends BuiltinCommand {
  static help =
    'Starts a development server. Uses `wrangler dev` for Cloudflare projects, or a Node.js server (@ghuri/core/node) with --node or when the project has no wrangler config.'
  static project = 'root' as const
  static passthrough = true

  addArguments(parser: ArgumentParser): void {
    parser
      .argument('addrport', { help: 'Optional port number, or ipaddr:port.' })
      .option('-p, --port <port>', { help: 'Port (default: 8787 for wrangler, 8000 for Node).' })
      .option('--host <host>', { help: 'Interface to bind (default: localhost).' })
      .option('--node', {
        help: 'Serve with Node.js instead of wrangler dev (bindings still come from wrangler locally).',
      })
      .option('--remote', {
        help: 'wrangler dev --remote (run on Cloudflare with remote bindings); with --node, use remote D1/R2/KV.',
      })
  }

  async handle(args: Record<string, unknown>, io: CommandIO): Promise<number> {
    const { root } = this.cli.root()
    const addr = parseAddrPort(args.addrport as string | undefined)
    const port = args.port !== undefined && args.port !== false ? Number(args.port) : addr.port
    const host = (args.host as string | undefined) ?? addr.host
    const wranglerConfig = findWranglerConfig(root)
    const extra = (args._ as string[]) ?? []
    if (!args.node && wranglerConfig) {
      const wargs = ['dev']
      if (port) wargs.push('--port', String(port))
      if (host) wargs.push('--ip', host)
      if (args.remote) wargs.push('--remote')
      if (this.cli.globals.env) wargs.push('--env', this.cli.globals.env)
      if (this.cli.globals.persistTo)
        wargs.push('--persist-to', resolve(this.cli.cwd, this.cli.globals.persistTo))
      wargs.push(...extra)
      return this.cli.spawn(process.execPath, [wranglerBin(root), ...wargs], { cwd: root })
    }
    return this.serveNode(io, port ?? 8000, host ?? '127.0.0.1')
  }

  private async serveNode(io: CommandIO, port: number, hostname: string): Promise<number> {
    const project = await this.cli.loadProject()
    let nodeMod: any
    try {
      nodeMod = await project.import('@ghuri/core/node')
    } catch (err) {
      throw new CommandError(
        `Could not load @ghuri/core/node (${(err as Error).message}). Install @hono/node-server: npm install @hono/node-server`,
      )
    }
    const app = project.core.createApp(project.settingsFactory)
    // Build once up front so configuration errors surface before we listen (and checks run with DEBUG).
    await app.hono(project.env)
    const server = await nodeMod.serve(app, {
      port,
      hostname,
      env: project.env,
      handleSignals: false,
      onListen: (info: { port: number }) => {
        io.stdout(
          `Ghuri ${project.hasBindings ? '(Node.js, wrangler bindings) ' : '(Node.js) '}development server`,
        )
        io.stdout(`Starting development server at ${io.style.bold(`http://${hostname}:${info.port}/`)}`)
        io.stdout('Quit the server with CONTROL-C.')
      },
    })
    await new Promise<void>((resolve) => {
      const stop = () => resolve()
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return 0
  }
}

export class TestCommand extends BuiltinCommand {
  static help =
    'Runs the project tests with vitest (`vitest run`; --watch for watch mode). Extra arguments go to vitest.'
  static project = 'root' as const
  static passthrough = true

  addArguments(parser: ArgumentParser): void {
    parser.option('--watch', { help: 'Run vitest in watch mode.' })
  }

  async handle(args: Record<string, unknown>): Promise<number> {
    const { root } = this.cli.root()
    const bin = findBin('vitest', root)
    if (!bin)
      throw new CommandError(
        'vitest is not installed in this project. Install it with: npm install -D vitest',
      )
    const vargs = args.watch ? [] : ['run']
    vargs.push(...((args._ as string[]) ?? []))
    return this.cli.spawn(process.execPath, [bin, ...vargs], { cwd: root })
  }
}

/** Files `ghuri eval` runs: agent eval suites, next to the apps or in `evals/`. */
export const EVAL_INCLUDE = ['src/**/evals.ts', 'src/**/*.eval.ts', 'evals/**/*.eval.ts']

const VITEST_CONFIGS = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
]

/** A vitest config that reuses the project's own (aliases, decorators…) with only the eval files as tests. */
export function evalVitestConfig(root: string): string {
  const base = VITEST_CONFIGS.map((f) => join(root, f)).find((f) => existsSync(f))
  return [
    '// Generated by `ghuri eval`: the project vitest config, running only the agent eval files.',
    base ? `import base from ${JSON.stringify(base)}` : 'const base = {}',
    '',
    'export default async (env) => {',
    "  const resolved = typeof base === 'function' ? await base(env) : await base",
    '  return {',
    '    ...resolved,',
    `    root: ${JSON.stringify(root)},`,
    '    test: {',
    '      ...(resolved?.test ?? {}),',
    `      include: ${JSON.stringify(EVAL_INCLUDE)},`,
    '      // Real model calls are slow, and evals share one test database: one file at a time, long timeouts.',
    '      fileParallelism: false,',
    '      // The model comparison tables are printed by passing tests: always show console output.',
    '      silent: false,',
    '      testTimeout: 30 * 60_000,',
    '      hookTimeout: 120_000,',
    '    },',
    '  }',
    '}',
    '',
  ].join('\n')
}

export class EvalCommand extends BuiltinCommand {
  static help =
    "Runs agent evals (src/**/evals.ts, src/**/*.eval.ts, evals/**/*.eval.ts) with vitest and prints each model's pass rate, tokens and cost. Calls real models unless the suites use mocks. Extra arguments go to vitest."
  static project = 'root' as const
  static passthrough = true

  addArguments(parser: ArgumentParser): void {
    parser
      .option('--models <list>', {
        help: 'Comma-separated models to compare, e.g. anthropic:claude-haiku-5-5,anthropic:claude-opus-5-5 (overrides the suites).',
      })
      .option('--repeat <n>', { help: 'Runs per case and model (overrides the suites).' })
      .option('--case <text>', { help: 'Only cases whose name contains this text.' })
      .option('--report <dir>', { help: 'Also write one JSON report per suite to this directory.' })
  }

  async handle(args: Record<string, unknown>): Promise<number> {
    const { root } = this.cli.root()
    const bin = findBin('vitest', root)
    if (!bin)
      throw new CommandError(
        'vitest is not installed in this project. Install it with: npm install -D vitest',
      )
    if (args.repeat !== undefined && !/^[1-9]\d*$/.test(String(args.repeat)))
      throw new CommandError(`--repeat must be a positive whole number, got "${String(args.repeat)}".`)
    const dir = join(root, 'node_modules', '.ghuri')
    mkdirSync(dir, { recursive: true })
    const config = join(dir, 'vitest.eval.config.mjs')
    writeFileSync(config, evalVitestConfig(root))
    const env: Record<string, string> = {}
    if (args.models) env.GHURI_EVAL_MODELS = String(args.models)
    if (args.repeat) env.GHURI_EVAL_REPEAT = String(args.repeat)
    if (args.case) env.GHURI_EVAL_CASE = String(args.case)
    if (args.report) env.GHURI_EVAL_REPORT_DIR = resolve(this.cli.cwd, String(args.report))
    const vargs = ['run', '--config', config, '--passWithNoTests', ...((args._ as string[]) ?? [])]
    return this.cli.spawn(process.execPath, [bin, ...vargs], { cwd: root, env })
  }
}

export class DeployCommand extends BuiltinCommand {
  static help =
    'Deploys the project to Cloudflare (wrangler deploy). Optionally applies migrations to the remote database first (ghuri migrate --remote).'
  static project = 'root' as const
  static passthrough = true

  addArguments(parser: ArgumentParser): void {
    parser
      .option('--migrate', { help: 'Apply migrations to the remote database first, without asking.' })
      .option('--skip-migrations', { help: "Don't apply migrations (and don't ask)." })
      .option('--dry-run', { help: 'Build without deploying (wrangler deploy --dry-run); skips migrations.' })
      .option('--no-input', { help: "Don't prompt; migrations run only with --migrate." })
  }

  async handle(args: Record<string, unknown>, io: CommandIO): Promise<number> {
    const { root } = this.cli.root()
    if (!findWranglerConfig(root)) {
      throw new CommandError(
        'No wrangler.jsonc / wrangler.json / wrangler.toml found: nothing to deploy to Cloudflare.',
      )
    }
    const bin = wranglerBin(root)
    const envArgs = this.cli.globals.env ? ['--env', this.cli.globals.env] : []
    let migrate = false
    if (args.dryRun || args.skipMigrations) migrate = false
    else if (args.migrate) migrate = true
    else if (!args.noInput && io.confirm) {
      migrate = await io.confirm('Apply migrations to the remote database first (ghuri migrate --remote)?', {
        default: true,
      })
    } else {
      io.stderr(
        io.style.warning('Skipping migrations (pass --migrate to run `ghuri migrate --remote` first).'),
      )
    }
    if (migrate) {
      io.stdout(io.style.notice('Applying migrations to the remote database…'))
      const code = await this.cli.runSelf(['migrate', '--remote', ...envArgs])
      if (code !== 0) {
        io.stderr(io.style.error(`Migrations failed (exit ${code}); not deploying.`))
        return code
      }
    }
    const wargs = ['deploy', ...envArgs]
    if (args.dryRun) wargs.push('--dry-run')
    wargs.push(...((args._ as string[]) ?? []))
    return this.cli.spawn(process.execPath, [bin, ...wargs], { cwd: root })
  }
}
