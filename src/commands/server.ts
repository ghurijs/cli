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
      if (this.cli.globals.persistTo) wargs.push('--persist-to', this.cli.globals.persistTo)
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
