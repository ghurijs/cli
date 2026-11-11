import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Root of the @ghuri/cli package. Source files live in `src/` and the bundle in `dist/`, both one
 * level below the package root, so `..` works for tests (src) and the published build (dist).
 */
export const PACKAGE_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const TEMPLATES_DIR: string = join(PACKAGE_ROOT, 'templates')

export function readJson<T = any>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

export function cliVersion(): string {
  try {
    return readJson(join(PACKAGE_ROOT, 'package.json')).version
  } catch {
    return 'unknown'
  }
}

/** Find `node_modules/<name>` walking up from `fromDir` (works even when `exports` hides package.json). */
export function findPackageDir(name: string, fromDir: string): string | undefined {
  let dir = resolve(fromDir)
  while (true) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** Absolute path of a package's bin script (e.g. wrangler, vitest), resolved from the project. */
export function findBin(pkg: string, fromDir: string, binName = pkg): string | undefined {
  const dir = findPackageDir(pkg, fromDir) ?? findPackageDir(pkg, PACKAGE_ROOT)
  if (!dir) return undefined
  const json = readJson(join(dir, 'package.json'))
  const bin = typeof json.bin === 'string' ? json.bin : json.bin?.[binName]
  return bin ? join(dir, bin) : undefined
}

export const DEFAULT_SETTINGS = 'src/settings.ts'
export const WRANGLER_CONFIGS = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']

export interface ProjectRoot {
  root: string
  packageJson: Record<string, any>
  settingsPath: string
}

/**
 * Walk up from `cwd` to the project root: the nearest directory whose package.json has a `ghuri` key
 * or that contains the default settings file. Returns undefined outside a project.
 */
export function findProjectRoot(cwd: string, settingsOverride?: string): ProjectRoot | undefined {
  let dir = resolve(cwd)
  while (true) {
    const pj = join(dir, 'package.json')
    if (existsSync(pj)) {
      let json: Record<string, any> = {}
      try {
        json = readJson(pj)
      } catch {}
      const configured = json.ghuri?.settings as string | undefined
      const rel = settingsOverride ?? configured ?? DEFAULT_SETTINGS
      const settingsPath = resolve(settingsOverride ? cwd : dir, rel)
      if (json.ghuri || existsSync(settingsPath)) return { root: dir, packageJson: json, settingsPath }
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export function findWranglerConfig(root: string): string | undefined {
  for (const f of WRANGLER_CONFIGS) {
    const p = join(root, f)
    if (existsSync(p)) return p
  }
  return undefined
}
