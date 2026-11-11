// Turns @ghuri/core `ArgumentParser` specs into real argv parsing (no dependencies).
import type { ArgumentParser, ArgumentSpec, OptionSpec } from '@ghuri/core'

export class UsageError extends Error {
  readonly returncode = 2
}

/** A parsed `OptionSpec` flag string such as `'-n, --name <value>'`. */
export interface ParsedOption {
  spec: OptionSpec
  /** Long flag without dashes, e.g. `name`, `no-input`. */
  long?: string
  /** Short flag letter, e.g. `n`. */
  short?: string
  /** Key in the `args` object (camelCase of the long flag). */
  key: string
  /** For `--no-x` flags: the positive key (`x`) that is set to `false`. */
  negates?: string
  /** `<value>` (required), `[value]` (optional) or none (boolean). */
  value: 'none' | 'required' | 'optional'
  /** Metavar shown in help (`value` in `<value>`). */
  metavar?: string
  /** `<value...>` — repeatable / multiple values collected in an array. */
  multiple: boolean
}

export interface CommandSpec {
  arguments: ArgumentSpec[]
  options: OptionSpec[]
}

export function camelCase(s: string): string {
  return s.replace(/^-+/, '').replace(/[-_]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** Parse `'-n, --name <value>'`, `'--remote'`, `'--no-input'`, `'--port [port]'`, `'--tag <tag...>'`. */
export function parseOptionFlags(spec: OptionSpec): ParsedOption {
  const tokens = spec.flags.split(/[\s,|]+/).filter(Boolean)
  let long: string | undefined
  let short: string | undefined
  let value: ParsedOption['value'] = 'none'
  let metavar: string | undefined
  let multiple = false
  for (const t of tokens) {
    if (t.startsWith('--')) long = t.slice(2)
    else if (t.startsWith('-')) short = t.slice(1)
    else if (/^<.+>$/.test(t) || /^\[.+\]$/.test(t)) {
      value = t.startsWith('<') ? 'required' : 'optional'
      metavar = t.slice(1, -1)
      if (metavar.endsWith('...')) {
        multiple = true
        metavar = metavar.slice(0, -3)
      }
    }
  }
  if (!long && !short) throw new Error(`Invalid option flags: '${spec.flags}'`)
  const key = camelCase(long ?? short!)
  const negates = long?.startsWith('no-') && value === 'none' ? camelCase(long.slice(3)) : undefined
  return { spec, long, short, key, negates, value, metavar, multiple }
}

export function specFromParser(parser: ArgumentParser | undefined): CommandSpec {
  return { arguments: [...(parser?.arguments ?? [])], options: [...(parser?.options ?? [])] }
}

export interface ParseOptions {
  /** Collect unknown options and extra positionals into `args._` instead of failing. */
  passthrough?: boolean
}

/**
 * Parse argv (without the command name) against a spec.
 *
 * - Option keys are the camelCased long flag (`--dry-run` → `dryRun`).
 * - `--no-x` sets `noX: true` and `x: false` (defaults: `noX: false`, `x: true`).
 * - Options with `<value>` take a value (`--port 8000` or `--port=8000`); numbers are coerced when the
 *   option's default is a number. `<value...>` collects repeated values into an array.
 * - Positionals fill `arguments` in order; a `variadic` argument takes the rest (array).
 * - Everything after `--` (and, in passthrough mode, anything unknown) goes to `args._`.
 */
export function parseArgv(
  argv: string[],
  spec: CommandSpec,
  opts: ParseOptions = {},
): Record<string, unknown> {
  const options = spec.options.map(parseOptionFlags)
  const byLong = new Map<string, ParsedOption>()
  const byShort = new Map<string, ParsedOption>()
  for (const o of options) {
    if (o.long) byLong.set(o.long, o)
    if (o.short) byShort.set(o.short, o)
  }
  const args: Record<string, unknown> = {}
  // Unknown options (passthrough) and positionals, in their original order.
  const ordered: Array<{ value: string; positional: boolean }> = []
  const afterDashes: string[] = []

  // Defaults.
  for (const o of options) {
    if (o.spec.default !== undefined) args[o.key] = o.spec.default
    else if (o.value === 'none') args[o.key] = false
    else if (o.multiple) args[o.key] = []
    if (o.negates && args[o.negates] === undefined) args[o.negates] = true
  }

  const setValue = (o: ParsedOption, raw: string | true) => {
    if (o.value === 'none') {
      args[o.key] = true
      if (o.negates) args[o.negates] = false
      return
    }
    const v = raw === true ? true : coerce(raw, o.spec.default)
    if (o.multiple) {
      const prev = args[o.key]
      const list = Array.isArray(prev) && prev !== o.spec.default ? prev : []
      args[o.key] = [...list, v]
    } else args[o.key] = v
  }

  let i = 0
  while (i < argv.length) {
    const tok = argv[i++]
    if (tok === '--') {
      afterDashes.push(...argv.slice(i))
      break
    }
    if (tok.startsWith('--') && tok.length > 2) {
      const eq = tok.indexOf('=')
      const name = eq >= 0 ? tok.slice(2, eq) : tok.slice(2)
      const inline = eq >= 0 ? tok.slice(eq + 1) : undefined
      const o = byLong.get(name) ?? byLong.get(aliasOf(name))
      if (!o) {
        if (opts.passthrough) {
          ordered.push({ value: tok, positional: false })
          continue
        }
        throw new UsageError(`unrecognized option: --${name}${suggest(name, [...byLong.keys()])}`)
      }
      if (o.value === 'none') {
        if (inline !== undefined) throw new UsageError(`option --${name} does not take a value`)
        setValue(o, true)
      } else if (inline !== undefined) setValue(o, inline)
      else if (i < argv.length && (o.value === 'required' || !argv[i].startsWith('-'))) setValue(o, argv[i++])
      else if (o.value === 'optional') setValue(o, true)
      else throw new UsageError(`option --${name} expects a value`)
      continue
    }
    if (tok.startsWith('-') && tok.length > 1 && !/^-\d/.test(tok)) {
      const body = tok.slice(1)
      const eq = body.indexOf('=')
      const letter = body[0]
      const o = byShort.get(letter)
      if (!o) {
        if (opts.passthrough) {
          ordered.push({ value: tok, positional: false })
          continue
        }
        throw new UsageError(`unrecognized option: -${letter}`)
      }
      if (o.value === 'none') {
        setValue(o, true)
        // Combined short booleans: -abc
        for (const extra of body.slice(1)) {
          const x = byShort.get(extra)
          if (x?.value !== 'none') throw new UsageError(`unrecognized option: -${extra}`)
          setValue(x, true)
        }
      } else if (eq === 1) setValue(o, body.slice(2))
      else if (body.length > 1) setValue(o, body.slice(1))
      else if (i < argv.length && (o.value === 'required' || !argv[i].startsWith('-'))) setValue(o, argv[i++])
      else if (o.value === 'optional') setValue(o, true)
      else throw new UsageError(`option -${letter} expects a value`)
      continue
    }
    ordered.push({ value: tok, positional: true })
  }
  const positionals = ordered.filter((o) => o.positional).map((o) => o.value)

  // Positionals.
  let p = 0
  for (const a of spec.arguments) {
    if (a.variadic) {
      const values = positionals.slice(p)
      p = positionals.length
      if (values.length) args[a.name] = values
      else if (a.default !== undefined) args[a.name] = a.default
      else if (a.required === true) throw new UsageError(`the following arguments are required: ${a.name}`)
      else args[a.name] = []
      continue
    }
    if (p < positionals.length) args[a.name] = positionals[p++]
    else if (a.default !== undefined) args[a.name] = a.default
    else if (a.required === true) {
      throw new UsageError(`the following arguments are required: ${a.name}`)
    }
  }
  if (p < positionals.length && !opts.passthrough) {
    throw new UsageError(`unrecognized arguments: ${positionals.slice(p).join(' ')}`)
  }
  // Leftovers keep their original order: unknown options and the positionals not consumed above.
  let seen = 0
  const rest = ordered
    .filter((o) => !o.positional || seen++ >= p)
    .map((o) => o.value)
    .concat(afterDashes)
  if (rest.length || opts.passthrough) args._ = rest
  return args
}

/** Django spellings accepted as aliases. */
function aliasOf(name: string): string {
  if (name === 'noinput') return 'no-input'
  return name
}

function coerce(raw: string, def: unknown): unknown {
  if (typeof def === 'number') {
    const n = Number(raw)
    if (Number.isNaN(n)) throw new UsageError(`expected a number, got '${raw}'`)
    return n
  }
  return raw
}

/** Levenshtein-based "did you mean" suffix. */
export function suggest(name: string, candidates: string[]): string {
  const best = closest(name, candidates)
  return best ? ` (did you mean '${best}'?)` : ''
}

export function closest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined
  let bestScore = Number.POSITIVE_INFINITY
  for (const c of candidates) {
    const d = distance(name, c)
    if (d < bestScore) {
      bestScore = d
      best = c
    }
  }
  return best !== undefined && bestScore <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}
