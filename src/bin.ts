#!/usr/bin/env node
import { runCli } from './cli'

// wrangler (a dependency of most projects) still requires the deprecated `punycode` module; hide that noise.
const emitWarning = process.emitWarning
process.emitWarning = function (this: unknown, warning: string | Error, ...rest: any[]) {
  if (String(warning).includes('punycode')) return
  return (emitWarning as any).call(process, warning, ...rest)
} as typeof process.emitWarning

const argv = process.argv.slice(2)
// `ghuri mcp` runs project introspection in child processes: `ghuri __mcp-worker '<json>'` (internal).
const main =
  argv[0] === '__mcp-worker' ? import('./mcp/worker').then((m) => m.workerMain(argv.slice(1))) : runCli(argv)

main.then(
  (code) => {
    process.exitCode = code
    // Bindings proxies, REPL handles or DB pools may keep the event loop alive; commands are done.
    setTimeout(() => process.exit(code), 50).unref()
  },
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
