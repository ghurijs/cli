import { randomInt } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { findProjectRoot, TEMPLATES_DIR } from './paths'
import { type RenderedFile, renderTemplate, TemplateError, writeFiles } from './render'

export const DATABASES = ['d1', 'postgres', 'sqlite'] as const
export type DatabaseChoice = (typeof DATABASES)[number]
export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'bun', 'yarn'] as const
export type PackageManager = (typeof PACKAGE_MANAGERS)[number]

/** Workers compatibility date written into new projects' wrangler.jsonc. */
export const COMPATIBILITY_DATE = '2026-11-01'

export class ScaffoldError extends Error {
  readonly returncode = 1
}

/** Django's get_random_secret_key(), limited to characters that need no quoting in .dev.vars / .env. */
export function generateSecretKey(length = 64): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
  let out = ''
  for (let i = 0; i < length; i++) out += chars[randomInt(chars.length)]
  return out
}

/** Package manager that launched us (`npm_config_user_agent`), defaulting to npm. */
export function detectPackageManager(env: Record<string, string | undefined> = process.env): PackageManager {
  const ua = env.npm_config_user_agent ?? ''
  for (const pm of ['pnpm', 'bun', 'yarn'] as const) if (ua.startsWith(pm)) return pm
  return 'npm'
}

export function pmCommands(pm: PackageManager): { install: string; run: string; exec: string } {
  switch (pm) {
    case 'pnpm':
      return { install: 'pnpm install', run: 'pnpm', exec: 'pnpm exec' }
    case 'bun':
      return { install: 'bun install', run: 'bun run', exec: 'bunx' }
    case 'yarn':
      return { install: 'yarn', run: 'yarn', exec: 'yarn' }
    default:
      return { install: 'npm install', run: 'npm run', exec: 'npx' }
  }
}

export function validateProjectName(name: string): void {
  if (!name) throw new ScaffoldError('You must provide a project name.')
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw new ScaffoldError(
      `'${name}' is not a valid project name. Use letters, digits, '-' and '_' (starting with a letter).`,
    )
  }
}

const RESERVED_APP_NAMES = new Set([
  'auth',
  'admin',
  'core',
  'orm',
  'rest',
  'storage',
  'agents',
  'graphql',
  'test',
  'src',
])

export function validateAppName(name: string): void {
  if (!name) throw new ScaffoldError('You must provide an application name.')
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new ScaffoldError(
      `'${name}' is not a valid app name. Use lowercase letters, digits and '_' (starting with a letter).`,
    )
  }
  if (RESERVED_APP_NAMES.has(name)) {
    throw new ScaffoldError(
      `'${name}' conflicts with a Ghuri package or reserved name. Please try another name.`,
    )
  }
}

export function pascalCase(s: string): string {
  return s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
}

export function camelCaseName(s: string): string {
  const p = pascalCase(s)
  return p ? p[0].toLowerCase() + p.slice(1) : p
}

function titleCase(s: string): string {
  return s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

function isEmptyDir(dir: string): boolean {
  return !existsSync(dir) || readdirSync(dir).filter((f) => f !== '.git' && f !== '.DS_Store').length === 0
}

// ---------------------------------------------------------------------------------------------
// startproject
// ---------------------------------------------------------------------------------------------

export interface StartProjectOptions {
  name: string
  /** Target directory (default `<cwd>/<name>`). */
  directory?: string
  cwd?: string
  db?: DatabaseChoice
  pm?: PackageManager
  /** Fixed secret key (tests); random by default. */
  secretKey?: string
  /** Add @ghuri/graphql: GraphQLConfig, src/schema.ts, GraphQLView at /graphql/. */
  graphql?: boolean
}

export interface StartProjectResult {
  directory: string
  files: string[]
  db: DatabaseChoice
  pm: PackageManager
  graphql: boolean
  /** Commands to show the user afterwards. */
  nextSteps: string[]
}

export function projectTemplateVars(opts: {
  name: string
  db: DatabaseChoice
  pm: PackageManager
  secretKey: string
  graphql?: boolean
}): Record<string, string | boolean> {
  const pkgName = opts.name.toLowerCase().replace(/_/g, '-')
  const pm = pmCommands(opts.pm)
  // `.mcp.json` runs the project's own `ghuri mcp` through the package manager (`npx`, `pnpm exec`, …).
  const [mcpCommand, ...execArgs] = pm.exec.split(' ')
  return {
    name: opts.name,
    pkgName,
    titleName: titleCase(opts.name),
    secretKey: opts.secretKey,
    compatibilityDate: COMPATIBILITY_DATE,
    db: opts.db,
    d1: opts.db === 'd1',
    postgres: opts.db === 'postgres',
    sqlite: opts.db === 'sqlite',
    cloudflare: opts.db !== 'sqlite',
    node: opts.db === 'sqlite',
    graphql: !!opts.graphql,
    pm: opts.pm,
    install: pm.install,
    run: pm.run,
    exec: pm.exec,
    mcpCommand,
    mcpArgs: `[${[...execArgs, 'ghuri', 'mcp'].map((a) => JSON.stringify(a)).join(', ')}]`,
  }
}

/** Render the project template in memory (used by tests and `startProject`). */
export function renderProject(vars: Record<string, string | boolean>): RenderedFile[] {
  return renderTemplate(join(TEMPLATES_DIR, 'project'), vars)
}

export function nextStepsFor(opts: {
  dirLabel: string
  db: DatabaseChoice
  pm: PackageManager
  installed: boolean
  pkgName: string
}): string[] {
  const pm = pmCommands(opts.pm)
  const steps: string[] = []
  if (opts.dirLabel !== '.') steps.push(`cd ${opts.dirLabel}`)
  if (!opts.installed) steps.push(pm.install)
  if (opts.db === 'd1')
    steps.push(
      `${pm.exec} wrangler d1 create ${opts.pkgName}-db   # then paste database_id into wrangler.jsonc (needed for deploys)`,
    )
  if (opts.db === 'postgres') steps.push('# set DATABASE_URL in .dev.vars to a running Postgres database')
  steps.push(`${pm.exec} ghuri migrate`)
  steps.push(`${pm.exec} ghuri createsuperuser`)
  steps.push(`${pm.run} dev`)
  return steps
}

/** Create a project (Django's `startproject`). Does not install dependencies. */
export function startProject(opts: StartProjectOptions): StartProjectResult {
  validateProjectName(opts.name)
  const db = opts.db ?? 'd1'
  if (!DATABASES.includes(db))
    throw new ScaffoldError(`--db must be one of ${DATABASES.join(', ')} (got '${db}').`)
  const pm = opts.pm ?? 'npm'
  if (!PACKAGE_MANAGERS.includes(pm))
    throw new ScaffoldError(`--pm must be one of ${PACKAGE_MANAGERS.join(', ')} (got '${pm}').`)
  const cwd = opts.cwd ?? process.cwd()
  const directory = resolve(cwd, opts.directory ?? opts.name)
  if (!isEmptyDir(directory)) {
    throw new ScaffoldError(`'${directory}' already exists and is not empty.`)
  }
  const vars = projectTemplateVars({
    name: opts.name,
    db,
    pm,
    secretKey: opts.secretKey ?? generateSecretKey(),
    graphql: opts.graphql,
  })
  const files = renderProject(vars)
  try {
    writeFiles(directory, files)
  } catch (err) {
    if (err instanceof TemplateError) throw new ScaffoldError(err.message)
    throw err
  }
  const relPath = relative(cwd, directory) || '.'
  const rel = relPath.startsWith('..') ? directory : relPath
  return {
    directory,
    files: files.map((f) => f.path),
    db,
    pm,
    graphql: !!opts.graphql,
    nextSteps: nextStepsFor({
      dirLabel: rel.includes(' ') ? JSON.stringify(rel) : rel,
      db,
      pm,
      installed: false,
      pkgName: String(vars.pkgName),
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// startapp
// ---------------------------------------------------------------------------------------------

export interface StartAppOptions {
  name: string
  /** Target directory (default `<project>/src/<name>`). */
  directory?: string
  cwd?: string
  /** Add the AppConfig to INSTALLED_APPS in the settings module (default true). */
  register?: boolean
}

export interface StartAppResult {
  directory: string
  files: string[]
  className: string
  /** Import line for the settings module. */
  importLine: string
  /** Whether settings.ts was updated automatically. */
  registered: boolean
  settingsPath?: string
  urlsHint: string
}

export function appTemplateVars(name: string): Record<string, string> {
  return {
    name,
    className: `${pascalCase(name)}Config`,
    pascalName: pascalCase(name),
    verboseName: titleCase(name),
    camelName: camelCaseName(name),
  }
}

export function renderApp(name: string): RenderedFile[] {
  return renderTemplate(join(TEMPLATES_DIR, 'app'), appTemplateVars(name))
}

/** Create an app (Django's `startapp`) and register it in INSTALLED_APPS when possible. */
export function startApp(opts: StartAppOptions): StartAppResult {
  validateAppName(opts.name)
  const cwd = opts.cwd ?? process.cwd()
  const project = findProjectRoot(cwd)
  // In a project: <root>/src/<name>. Elsewhere: ./src/<name> when ./src exists, else ./<name>.
  const defaultDir = project
    ? join(project.root, 'src', opts.name)
    : existsSync(join(cwd, 'src'))
      ? join(cwd, 'src', opts.name)
      : join(cwd, opts.name)
  const directory = opts.directory ? resolve(cwd, opts.directory) : defaultDir
  if (!isEmptyDir(directory)) throw new ScaffoldError(`'${directory}' already exists and is not empty.`)
  const vars = appTemplateVars(opts.name)
  const files = renderApp(opts.name)
  try {
    writeFiles(directory, files)
  } catch (err) {
    if (err instanceof TemplateError) throw new ScaffoldError(err.message)
    throw err
  }

  const settingsPath = project?.settingsPath
  let specifier = `./${opts.name}/app`
  if (settingsPath) {
    specifier = relative(dirname(settingsPath), join(directory, 'app')).split(sep).join('/')
    if (!specifier.startsWith('.')) specifier = `./${specifier}`
  }
  const importLine = `import { ${vars.className} } from '${specifier}'`
  let registered = false
  if (opts.register !== false && settingsPath && existsSync(settingsPath)) {
    const src = readFileSync(settingsPath, 'utf8')
    const updated = registerApp(src, vars.className, importLine)
    if (updated !== null) {
      writeFileSync(settingsPath, updated)
      registered = true
    }
  }
  return {
    directory,
    files: files.map((f) => f.path),
    className: vars.className,
    importLine,
    registered,
    settingsPath,
    urlsHint: `path('${opts.name}/', include(${vars.camelName}Urls)),  // import { urlpatterns as ${vars.camelName}Urls } from '${specifier.replace(/\/app$/, '/urls')}'`,
  }
}

/**
 * Insert `className` at the end of `INSTALLED_APPS: [ … ]` and its import after the last import.
 * Returns null when the pattern isn't found (the caller prints manual instructions).
 */
export function registerApp(src: string, className: string, importLine: string): string | null {
  const start = /INSTALLED_APPS\s*:\s*\[/.exec(src)
  if (!start) return null
  // Find the matching closing bracket.
  let depth = 0
  let end = -1
  for (let i = start.index + start[0].length - 1; i < src.length; i++) {
    const ch = src[i]
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return null
  const body = src.slice(start.index + start[0].length, end)
  if (new RegExp(`\\b${className}\\b`).test(body)) return src
  let updated: string
  if (body.includes('\n')) {
    // Multi-line list: add a new line with the same indentation as the existing entries.
    const indent = /\n([ \t]+)\S/.exec(body)?.[1] ?? '    '
    const trimmed = body.replace(/\s*$/, '')
    const sep = trimmed.trim() === '' || trimmed.endsWith(',') ? '' : ','
    const closingIndent = /\n([ \t]*)$/.exec(body)?.[1] ?? ''
    updated = `${src.slice(0, start.index + start[0].length)}${trimmed}${sep}\n${indent}${className},\n${closingIndent}${src.slice(end)}`
  } else {
    const trimmed = body.trim().replace(/,$/, '')
    updated = `${src.slice(0, start.index + start[0].length)}${trimmed ? `${trimmed}, ` : ''}${className}${src.slice(end)}`
  }
  // Import after the last top-level import statement.
  const importRe = /^import\s[^;]*?from\s*['"][^'"]+['"];?[ \t]*$/gm
  let last: RegExpExecArray | null = null
  for (let m = importRe.exec(updated); m; m = importRe.exec(updated)) last = m
  if (last) {
    const at = last.index + last[0].length
    updated = `${updated.slice(0, at)}\n${importLine}${updated.slice(at)}`
  } else updated = `${importLine}\n${updated}`
  return updated
}
