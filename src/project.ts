import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createJiti, type Jiti } from 'jiti'
import { loadEnvFiles } from './dotenv'
import { findPackageDir, findProjectRoot, findWranglerConfig, type ProjectRoot } from './paths'

export class ProjectError extends Error {
  readonly returncode = 1
}

export interface ProjectOptions {
  cwd: string
  /** `--settings` override (path relative to cwd). */
  settings?: string
  /** Wrangler environment (`--env`). */
  environment?: string
  /** Use remote D1/R2/KV bindings through wrangler (`--remote`). */
  remote?: boolean
  /** Where local binding state lives (`--persist-to`); defaults to wrangler's `.wrangler/state`. */
  persistTo?: string
  /** Base environment (defaults to `process.env`). */
  processEnv?: Record<string, string | undefined>
  /** Skip wrangler entirely (plain `process.env` + `.env`/`.dev.vars`). */
  noBindings?: boolean
  /** Hook for tests: replaces `wrangler.getPlatformProxy`. */
  getPlatformProxy?: (
    opts: Record<string, unknown>,
  ) => Promise<{ env: Record<string, unknown>; dispose(): Promise<void> }>
}

/** A loaded Ghuri project: settings factory, env (bindings + vars) and helpers to import its modules. */
export interface Project extends ProjectRoot {
  jiti: Jiti
  /** The project's `@ghuri/core` (resolved from the project so app and CLI share one copy). */
  core: typeof import('@ghuri/core')
  settingsFactory: import('@ghuri/core').SettingsFactory
  env: Record<string, unknown>
  wranglerConfig?: string
  /** True when bindings come from wrangler's platform proxy. */
  hasBindings: boolean
  import<T = any>(specifier: string): Promise<T>
  /** Try to import a module; undefined if it cannot be resolved. */
  tryImport<T = any>(specifier: string): Promise<T | undefined>
  dispose(): Promise<void>
}

export function createProjectJiti(root: string): Jiti {
  return createJiti(pathToFileURL(join(root, 'package.json')).href, {
    interopDefault: true,
    moduleCache: true,
    jsx: { runtime: 'automatic', importSource: 'hono/jsx' } as any,
  })
}

/** Locate the project and import its settings module (no env / bindings yet). */
export async function locateProject(
  opts: Pick<ProjectOptions, 'cwd' | 'settings'>,
): Promise<ProjectRoot & { jiti: Jiti; core: typeof import('@ghuri/core'); settingsFactory: any }> {
  const found = findProjectRoot(opts.cwd, opts.settings)
  if (!found) {
    throw new ProjectError(
      `No Ghuri project found in ${opts.cwd} or its parents (looked for package.json#ghuri.settings or src/settings.ts).\n` +
        `Create one with 'ghuri startproject mysite' or pass --settings <path>.`,
    )
  }
  if (!existsSync(found.settingsPath)) {
    throw new ProjectError(`Settings module not found: ${found.settingsPath}`)
  }
  const jiti = createProjectJiti(found.root)
  const core = await importCore(jiti, found.root)
  let mod: any
  try {
    mod = await jiti.import(found.settingsPath)
  } catch (err) {
    const e = new ProjectError(`Could not import settings '${found.settingsPath}': ${(err as Error).message}`)
    ;(e as any).cause = err
    throw e
  }
  const factory = pickSettings(mod)
  if (!factory || !core.isSettingsFactory(factory)) {
    throw new ProjectError(
      `${found.settingsPath} must export default defineSettings((env) => ({ ... })) from '@ghuri/core'.`,
    )
  }
  return { ...found, jiti, core, settingsFactory: factory }
}

function pickSettings(mod: any): unknown {
  if (!mod) return undefined
  if (typeof mod === 'function') return mod
  return mod.default ?? mod.settings
}

async function importCore(jiti: Jiti, root: string): Promise<typeof import('@ghuri/core')> {
  if (findPackageDir('@ghuri/core', root)) {
    try {
      return (await jiti.import('@ghuri/core')) as typeof import('@ghuri/core')
    } catch {}
  }
  return import('@ghuri/core')
}

/** Load the project and build `env`: wrangler bindings (local or remote) + vars + `.dev.vars`/`.env` + process.env. */
export async function loadProject(opts: ProjectOptions): Promise<Project> {
  const base = await locateProject(opts)
  const processEnv = opts.processEnv ?? process.env
  const fileVars = loadEnvFiles(base.root, opts.environment)
  const wranglerConfig = opts.noBindings ? undefined : findWranglerConfig(base.root)
  let proxy: { env: Record<string, unknown>; dispose(): Promise<void> } | undefined
  let cleanup: (() => void) | undefined
  if (wranglerConfig) {
    const getPlatformProxy = opts.getPlatformProxy ?? (await loadGetPlatformProxy(base.root))
    if (getPlatformProxy) {
      let configPath = wranglerConfig
      if (opts.remote) {
        const tmp = await writeRemoteConfig(base.root, wranglerConfig)
        configPath = tmp
        cleanup = () => rmSync(tmp, { force: true })
      }
      try {
        proxy = await getPlatformProxy({
          configPath,
          environment: opts.environment,
          persist: opts.persistTo ? { path: opts.persistTo } : true,
          remoteBindings: !!opts.remote,
        })
      } catch (err) {
        cleanup?.()
        throw new ProjectError(`wrangler getPlatformProxy() failed: ${(err as Error).message}`)
      }
    } else if (opts.remote) {
      throw new ProjectError('--remote needs wrangler: npm install -D wrangler')
    }
  } else if (opts.remote) {
    throw new ProjectError('--remote needs a wrangler.jsonc / wrangler.json / wrangler.toml in the project.')
  }

  const proxyVars: Record<string, unknown> = {}
  const bindings: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(proxy?.env ?? {})) {
    if (typeof v === 'string') proxyVars[k] = v
    else bindings[k] = v
  }
  // Precedence (high → low): bindings > process.env > .dev.vars > .env > wrangler `vars`.
  const env: Record<string, unknown> = { ...proxyVars, ...fileVars }
  for (const [k, v] of Object.entries(processEnv)) if (v !== undefined) env[k] = v
  Object.assign(env, bindings)

  let disposed = false
  const project: Project = {
    ...base,
    env,
    wranglerConfig,
    hasBindings: !!proxy,
    import: <T>(s: string) => base.jiti.import(s) as Promise<T>,
    async tryImport<T>(s: string) {
      try {
        return (await base.jiti.import(s)) as T
      } catch (err) {
        if (isNotFound(err, s)) return undefined
        throw err
      }
    },
    async dispose() {
      if (disposed) return
      disposed = true
      try {
        const orm = await project.tryImport<any>('@ghuri/orm')
        await orm?.connections?.closeAll?.()
      } catch {}
      try {
        await proxy?.dispose()
      } finally {
        cleanup?.()
      }
    },
  }
  return project
}

export function isNotFound(err: unknown, specifier?: string): boolean {
  const e = err as any
  const msg = String(e?.message ?? '')
  const notFound =
    ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(e?.code) ||
    /Cannot find (module|package)/.test(msg)
  if (!notFound || !specifier) return notFound
  const pkg = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
  return msg.includes(specifier) || msg.includes(pkg)
}

async function loadGetPlatformProxy(root: string): Promise<ProjectOptions['getPlatformProxy'] | undefined> {
  const dir = findPackageDir('wrangler', root)
  if (!dir) return undefined
  // Keep wrangler's informational logs ("Using secrets defined in .dev.vars") out of command output.
  process.env.WRANGLER_LOG ??= 'warn'
  try {
    const wrangler: any = await import(pathToFileURL(join(dir, 'wrangler-dist', 'cli.js')).href)
    return wrangler.getPlatformProxy ?? wrangler.default?.getPlatformProxy
  } catch {
    try {
      const wrangler: any = await createProjectJiti(root).import('wrangler')
      return wrangler.getPlatformProxy
    } catch {
      return undefined
    }
  }
}

/**
 * Wrangler (v4) enables remote bindings per binding (`"remote": true`). For `--remote` we write a
 * temporary config next to the real one with every D1 / R2 / KV binding marked remote.
 */
export async function writeRemoteConfig(root: string, configPath: string): Promise<string> {
  const raw = await readWranglerConfig(root, configPath)
  const markRemote = (cfg: any) => {
    for (const key of ['d1_databases', 'r2_buckets', 'kv_namespaces']) {
      if (Array.isArray(cfg?.[key])) cfg[key] = cfg[key].map((b: any) => ({ ...b, remote: true }))
    }
  }
  markRemote(raw)
  for (const envCfg of Object.values(raw.env ?? {})) markRemote(envCfg)
  const tmp = join(
    dirname(configPath),
    `.ghuri-remote.${basename(configPath).replace(/\.(toml|jsonc?)$/, '')}.json`,
  )
  writeFileSync(tmp, JSON.stringify(raw, null, 2))
  return tmp
}

/** Read wrangler.jsonc/json/toml as a plain object (wrangler's own reader when available). */
export async function readWranglerConfig(root: string, configPath: string): Promise<Record<string, any>> {
  const dir = findPackageDir('wrangler', root)
  if (dir) {
    try {
      const wrangler: any = await import(pathToFileURL(join(dir, 'wrangler-dist', 'cli.js')).href)
      if (wrangler.experimental_readRawConfig) {
        return structuredClone(wrangler.experimental_readRawConfig({ config: configPath }).rawConfig)
      }
    } catch {}
  }
  if (configPath.endsWith('.toml')) throw new ProjectError('Reading wrangler.toml needs wrangler installed.')
  const { readFileSync } = await import('node:fs')
  return parseJsonc(readFileSync(configPath, 'utf8'))
}

/** Minimal JSONC parser: strips comments and trailing commas. */
export function parseJsonc(src: string): any {
  let out = ''
  let i = 0
  let inString = false
  while (i < src.length) {
    const ch = src[i]
    if (inString) {
      out += ch
      if (ch === '\\') out += src[++i] ?? ''
      else if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i++
    } else if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (ch === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
    } else {
      out += ch
      i++
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}
