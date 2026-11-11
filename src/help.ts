import { ArgumentParser } from '@ghuri/core'
import { type CommandSpec, parseOptionFlags, specFromParser } from './argv'
import type { CliContext, CommandEntry } from './context'
import { makeStyle } from './io'

/** Options every command accepts (merged into each command's spec unless it defines them itself). */
export const GLOBAL_OPTIONS = [
  {
    flags: '--settings <path>',
    help: 'Settings module (default: package.json#ghuri.settings or src/settings.ts).',
  },
  { flags: '--env <name>', help: 'Wrangler environment to read bindings and vars from.' },
  { flags: '--remote', help: 'Use remote Cloudflare bindings (D1/R2/KV) instead of local ones.' },
  { flags: '--persist-to <dir>', help: 'Directory for local binding state (default: .wrangler/state).' },
  { flags: '--traceback', help: 'Print the full stack trace on errors.' },
  { flags: '--no-color', help: "Don't colorize the output." },
  { flags: '-h, --help', help: 'Show help.' },
]

/** Instantiate a command and collect its argument spec. */
export function commandSpec(entry: CommandEntry, cli?: CliContext): CommandSpec {
  const parser = new ArgumentParser()
  const inst = new (entry.cls as any)(cli)
  inst.addArguments?.(parser)
  return specFromParser(parser)
}

/** The command's spec plus global options it doesn't redefine. */
export function withGlobals(spec: CommandSpec): CommandSpec {
  const taken = new Set<string>()
  for (const o of spec.options) {
    const p = parseOptionFlags(o)
    if (p.long) taken.add(`--${p.long}`)
    if (p.short) taken.add(`-${p.short}`)
  }
  const extra = GLOBAL_OPTIONS.filter((g) => {
    const p = parseOptionFlags(g)
    return !(p.long && taken.has(`--${p.long}`)) && !(p.short && taken.has(`-${p.short}`))
  })
  return { arguments: spec.arguments, options: [...spec.options, ...extra] }
}

function helpOf(entry: CommandEntry): string {
  return String((entry.cls as any).help ?? '').trim()
}

/** First sentence of a help text, shortened to `max` characters. */
export function summary(help: string, max = 72): string {
  const first = help.split('\n')[0]
  const sentence = /^(.*?[.!?])(\s|$)/.exec(first)?.[1] ?? first
  const text = sentence.replace(/\.$/, '')
  return text.length > max ? `${text.slice(0, Math.max(10, max - 1)).trimEnd()}…` : text
}

function pad(s: string, n: number): string {
  return s.length >= n ? `${s}  ` : s + ' '.repeat(n - s.length)
}

function wrapLines(text: string, indent: number, width = 100): string {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if (line && line.length + w.length + 1 > width - indent) {
      lines.push(line)
      line = w
    } else line = line ? `${line} ${w}` : w
  }
  if (line) lines.push(line)
  return lines.join(`\n${' '.repeat(indent)}`)
}

/** `ghuri help` — commands grouped by source, like `manage.py help`. */
export function formatMainHelp(
  entries: CommandEntry[],
  opts: { color?: boolean; note?: string; version?: string },
): string {
  const s = makeStyle(!!opts.color)
  const out: string[] = []
  out.push(
    `${s.bold('ghuri')}${opts.version ? s.dim(` ${opts.version}`) : ''} — Django-style management for Ghuri projects`,
  )
  out.push('')
  out.push(`Usage: ghuri ${s.cyan('<subcommand>')} [options] [args]`)
  out.push('')
  out.push(
    "Type 'ghuri help <subcommand>' (or 'ghuri <subcommand> --help') for help on a specific subcommand.",
  )
  out.push('')
  out.push('Available subcommands:')
  const groups = new Map<string, CommandEntry[]>()
  for (const e of entries) {
    const list = groups.get(e.source) ?? []
    list.push(e)
    groups.set(e.source, list)
  }
  const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  const width = Math.max(16, ...entries.map((e) => e.name.length + 4))
  for (const g of order) {
    out.push('')
    out.push(s.error(`[${g}]`))
    for (const e of groups.get(g)!.sort((a, b) => a.name.localeCompare(b.name))) {
      const h = summary(helpOf(e), 100 - width - 4)
      out.push(`    ${pad(e.name, width)}${s.dim(h)}`.trimEnd())
    }
  }
  if (opts.note) {
    out.push('')
    out.push(s.warning(opts.note))
  }
  out.push('')
  out.push('Global options:')
  out.push(...formatOptions(GLOBAL_OPTIONS))
  return `${out.join('\n')}\n`
}

function rank(group: string): number {
  if (group === 'ghuri') return 0
  if (group === 'orm') return 1
  if (group === 'other') return 3
  return 2
}

function formatOptions(options: CommandSpec['options']): string[] {
  const rows = options.map((o) => {
    const p = parseOptionFlags(o)
    const flags = [p.short ? `-${p.short}` : '', p.long ? `--${p.long}` : ''].filter(Boolean).join(', ')
    const meta =
      p.value === 'none'
        ? ''
        : p.value === 'required'
          ? ` <${p.metavar}${p.multiple ? '...' : ''}>`
          : ` [${p.metavar}]`
    const def =
      o.default !== undefined && o.default !== false && o.default !== ''
        ? ` (default: ${JSON.stringify(o.default)})`
        : ''
    return [`  ${p.short ? '' : '    '}${flags}${meta}`, `${o.help ?? ''}${def}`]
  })
  const width = Math.max(24, ...rows.map((r) => r[0].length + 2))
  return rows.map(([a, b]) => `${pad(a, width)}${wrapLines(b, width)}`.trimEnd())
}

/** `ghuri <command> --help`. */
export function formatCommandHelp(
  name: string,
  entry: CommandEntry,
  spec: CommandSpec,
  opts: { color?: boolean },
): string {
  const s = makeStyle(!!opts.color)
  const usageArgs = spec.arguments
    .map((a) => {
      const n = a.variadic ? `${a.name}...` : a.name
      return a.required === true ? `<${n}>` : `[${n}]`
    })
    .join(' ')
  const out: string[] = []
  out.push(`Usage: ghuri ${s.bold(name)} [options]${usageArgs ? ` ${usageArgs}` : ''}`)
  const help = helpOf(entry)
  if (help) {
    out.push('')
    out.push(wrapLines(help, 0))
  }
  if (spec.arguments.length) {
    out.push('')
    out.push('Arguments:')
    const width = Math.max(16, ...spec.arguments.map((a) => a.name.length + 6))
    for (const a of spec.arguments) {
      const def = a.default !== undefined ? ` (default: ${JSON.stringify(a.default)})` : ''
      out.push(
        `${pad(`  ${a.name}${a.variadic ? '...' : ''}`, width)}${wrapLines(`${a.help ?? ''}${def}`, width)}`.trimEnd(),
      )
    }
  }
  if (spec.options.length) {
    out.push('')
    out.push('Options:')
    out.push(...formatOptions(spec.options))
  }
  const own = new Set(spec.options.map((o) => parseOptionFlags(o).long))
  const globals = GLOBAL_OPTIONS.filter((g) => !own.has(parseOptionFlags(g).long))
  out.push('')
  out.push('Global options:')
  out.push(...formatOptions(globals))
  if ((entry.cls as any).passthrough) {
    out.push('')
    out.push(
      s.dim('Unknown options and arguments after the known ones are forwarded to the underlying tool.'),
    )
  }
  return `${out.join('\n')}\n`
}
