import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Parse a `.env` / `.dev.vars` file (KEY=value, quotes, `export` prefix, comments, multi-line "…"). */
export function parseDotenv(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]
    let value = m[2]
    const quote = value[0]
    if (quote === '"' || quote === "'" || quote === '`') {
      let body = value.slice(1)
      // Multi-line quoted value.
      while (!hasClosingQuote(body, quote) && i + 1 < lines.length) body += `\n${lines[++i]}`
      const end = findClosingQuote(body, quote)
      value = end >= 0 ? body.slice(0, end) : body
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"')
    } else {
      const hash = value.search(/\s#/)
      if (hash >= 0) value = value.slice(0, hash)
      value = value.trim()
    }
    out[key] = value
  }
  return out
}

function findClosingQuote(s: string, q: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      i++
      continue
    }
    if (s[i] === q) return i
  }
  return -1
}

function hasClosingQuote(s: string, q: string): boolean {
  return findClosingQuote(s, q) >= 0
}

/**
 * Load project variables the way wrangler does for local dev: `.env` then `.dev.vars`
 * (later files win), plus `.env.<environment>` / `.dev.vars.<environment>` when an environment is given.
 */
export function loadEnvFiles(root: string, environment?: string): Record<string, string> {
  const files = ['.env', '.env.local']
  if (environment) files.push(`.env.${environment}`, `.env.${environment}.local`)
  files.push(
    environment && existsSync(join(root, `.dev.vars.${environment}`))
      ? `.dev.vars.${environment}`
      : '.dev.vars',
  )
  const out: Record<string, string> = {}
  for (const f of files) {
    const p = join(root, f)
    if (existsSync(p)) Object.assign(out, parseDotenv(readFileSync(p, 'utf8')))
  }
  return out
}
