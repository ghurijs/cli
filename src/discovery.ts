import type { CommandClass } from '@ghuri/core'
import type { CommandEntry } from './context'

export const DEFAULT_ORM_COMMANDS = '@ghuri/orm/commands'

type Registry = { register(name: string, cls: CommandClass): void; all(): Map<string, CommandClass> }

function isCommandClass(v: unknown): v is CommandClass {
  return typeof v === 'function' && typeof (v as any).prototype?.handle === 'function'
}

/** `MakeMigrationsCommand` → `makemigrations`; honors a static `commandName`. */
export function commandNameOf(cls: Function, exportName: string): string {
  const explicit = (cls as any).commandName ?? (cls as any).command
  if (typeof explicit === 'string' && explicit) return explicit
  return exportName.replace(/Command$/, '').toLowerCase()
}

/**
 * Register commands exported by an ORM-commands style module into the registry and return the
 * names that belong to it. Supports, in order of preference:
 *  - `registerOrmCommands(registry?)` / `registerCommands(registry?)`
 *  - `commands: Record<name, CommandClass>`
 *  - exported `XxxCommand` classes (named by `static commandName` or the lowercased class name)
 */
export async function registerModuleCommands(
  mod: Record<string, any>,
  registry: Registry,
): Promise<Set<string>> {
  const before = registry.all()
  const exported = new Set<unknown>()
  const register = mod.registerOrmCommands ?? mod.registerCommands
  if (typeof register === 'function') {
    await register(registry)
  } else if (mod.commands && typeof mod.commands === 'object') {
    for (const [name, cls] of Object.entries(mod.commands)) {
      if (isCommandClass(cls)) registry.register(name, cls)
    }
  } else {
    for (const [key, value] of Object.entries(mod)) {
      if (key === 'default' || !isCommandClass(value) || !/Command$/.test(key)) continue
      if (/^(Base|Abstract)/.test(key)) continue
      registry.register(commandNameOf(value, key), value)
    }
  }
  for (const v of Object.values(mod)) if (isCommandClass(v)) exported.add(v)
  if (mod.commands && typeof mod.commands === 'object')
    for (const v of Object.values(mod.commands)) exported.add(v)
  const names = new Set<string>()
  for (const [name, cls] of registry.all()) {
    if (before.get(name) !== cls || exported.has(cls)) names.add(name)
  }
  return names
}

/**
 * Merge command sources into one table. Later sources override earlier ones (an app can replace a
 * built-in, like Django), except `help`.
 */
export function mergeCommands(...groups: CommandEntry[][]): CommandEntry[] {
  const table = new Map<string, CommandEntry>()
  for (const group of groups) {
    for (const e of group) {
      if (e.name === 'help' && table.has('help')) continue
      table.set(e.name, e)
    }
  }
  return [...table.values()]
}

/** App commands from AppConfig instances (`commands = { name: Class }`), labelled with the app label. */
export function appCommandEntries(
  configs: Array<{ appLabel?: string; name?: string; commands?: Record<string, unknown> }>,
): CommandEntry[] {
  const out: CommandEntry[] = []
  for (const cfg of configs) {
    const label =
      cfg.appLabel ??
      String(cfg.name ?? '')
        .split(/[./]/)
        .pop() ??
      'app'
    for (const [name, cls] of Object.entries(cfg.commands ?? {})) {
      if (isCommandClass(cls)) out.push({ name, cls, source: label, builtin: false })
    }
  }
  return out
}

/** Instantiate INSTALLED_APPS entries without populating the registry (for `ghuri help`). */
export function instantiateConfigs(installed: unknown[]): any[] {
  const out: any[] = []
  for (const entry of installed ?? []) {
    try {
      out.push(typeof entry === 'function' ? new (entry as any)() : entry)
    } catch {}
  }
  return out
}
