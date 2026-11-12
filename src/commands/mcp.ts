import { inspect } from 'node:util'
import type { ArgumentParser, CommandIO } from '@ghuri/core'
import { McpProtocol, serveStdio } from '../mcp/protocol'
import { createTools, ProjectBridge, serverInfo } from '../mcp/server'
import { BuiltinCommand, CommandError } from './base'

/**
 * While the server runs, stdout belongs to the protocol: route `process.stdout.write` and `console.log`
 * (anything a dependency prints) to stderr, and return a writer for protocol messages.
 */
export function guardStdout(): { write: (s: string) => void; flush(): Promise<void>; restore(): void } {
  const stdout = process.stdout
  const original = stdout.write
  const write = original.bind(stdout) as (s: string, cb?: (err?: Error | null) => void) => boolean
  const saved = { log: console.log, info: console.info, debug: console.debug, dir: console.dir }
  stdout.write = ((chunk: any, encoding?: any, cb?: any) =>
    (process.stderr.write as any)(chunk, encoding, cb)) as typeof stdout.write
  console.log = console.error
  console.info = console.error
  console.debug = console.error
  console.dir = (obj: unknown, opts?: any) => console.error(inspect(obj, opts))
  return {
    write: (s) => {
      write(s)
    },
    flush: () => new Promise((resolve) => write('', () => resolve())),
    restore() {
      stdout.write = original
      Object.assign(console, saved)
    },
  }
}

export class McpCommand extends BuiltinCommand {
  static help =
    'Run a Model Context Protocol server over stdio for AI coding agents. Claude Code, Codex, Cursor, VS Code and other MCP clients can then inspect the project (settings, apps, models, routes, migrations, commands, docs) and run management commands. Configure the client to run `npx ghuri mcp` in the project directory.'
  static project = 'none' as const

  addArguments(parser: ArgumentParser): void {
    parser.option('--docs-url <url>', {
      help: 'Where search_docs / get_doc read the docs from: a URL or a file path (default: https://ghurijs.github.io/docs/llms-full.txt).',
    })
  }

  async handle(args: Record<string, unknown>, _io: CommandIO): Promise<number> {
    const { globals, options, cwd } = this.cli
    if (globals.remote) {
      throw new CommandError('ghuri mcp does not support --remote: agents only get local bindings.')
    }
    // Tests pass their own sinks; a real run guards process.stdout.
    const guard = options.stdout ? undefined : guardStdout()
    const write = options.stdout ?? guard!.write
    const log = options.stderr ?? ((s: string) => process.stderr.write(s))
    try {
      const bridge = new ProjectBridge({
        cwd,
        globals: { settings: globals.settings, env: globals.env, persistTo: globals.persistTo },
        env: options.env ? { ...process.env, ...options.env } : undefined,
        docsUrl: (args.docsUrl as string | undefined) ?? process.env.GHURI_DOCS_URL,
        log,
      })
      const protocol = new McpProtocol(serverInfo(), createTools(bridge), log)
      await serveStdio(protocol, { input: (options.stdin ?? process.stdin) as any, write, log })
      await guard?.flush()
    } finally {
      guard?.restore()
    }
    return 0
  }
}
