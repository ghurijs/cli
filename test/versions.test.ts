import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PACKAGE_ROOT, TEMPLATES_DIR } from '../src/paths'
import { GHURI_PACKAGE_VERSIONS, type GhuriPackageName, ghuriRange, ghuriRangeVars } from '../src/versions'

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

/** `packages/` of the Ghuri workspace when this package is checked out inside it. */
const WORKSPACE_PACKAGES = resolve(PACKAGE_ROOT, '..')
const names = Object.keys(GHURI_PACKAGE_VERSIONS) as GhuriPackageName[]

function workspaceManifest(name: GhuriPackageName): { name: string; version: string } | undefined {
  const file = join(WORKSPACE_PACKAGES, name.slice('@ghuri/'.length), 'package.json')
  if (!existsSync(file)) return undefined
  const pkg = readJson(file)
  return pkg.name === name ? pkg : undefined
}

describe('GHURI_PACKAGE_VERSIONS', () => {
  it("lists @ghuri/cli at this package's own version", () => {
    expect(GHURI_PACKAGE_VERSIONS['@ghuri/cli']).toBe(readJson(join(PACKAGE_ROOT, 'package.json')).version)
  })

  // Skipped when the sibling repos aren't cloned next to this one (e.g. this repo's own CI).
  const siblings = names.filter((n) => n !== '@ghuri/cli' && workspaceManifest(n))
  const table = siblings.length ? siblings : (['@ghuri/core'] as GhuriPackageName[])
  it.skipIf(siblings.length === 0).each(table)('matches the workspace version of %s', (name) => {
    expect(GHURI_PACKAGE_VERSIONS[name], `bump ${name} in src/versions.ts`).toBe(
      workspaceManifest(name)?.version,
    )
  })

  it('covers every @ghuri package the project template depends on', () => {
    const tpl = readFileSync(join(TEMPLATES_DIR, 'project', 'package.json.tpl'), 'utf8')
    const used = [...tpl.matchAll(/"(@ghuri\/[\w-]+)"\s*:\s*"([^"]*)"/g)]
    expect(used.length).toBeGreaterThan(0)
    for (const [, name, range] of used) {
      expect(names, name).toContain(name)
      // never hard-coded: the range always comes from the versions map
      expect(range, name).toBe(`{{${name.slice('@ghuri/'.length)}Range}}`)
    }
    expect(new Set(used.map((m) => m[1]))).toEqual(new Set(names))
  })

  it('renders caret ranges as template variables', () => {
    expect(ghuriRange('@ghuri/orm')).toBe(`^${GHURI_PACKAGE_VERSIONS['@ghuri/orm']}`)
    expect(ghuriRangeVars()).toMatchObject({
      coreRange: ghuriRange('@ghuri/core'),
      cliRange: ghuriRange('@ghuri/cli'),
    })
    expect(Object.keys(ghuriRangeVars())).toHaveLength(names.length)
  })

  it('every listed package exists in the workspace (when present)', () => {
    if (!existsSync(join(WORKSPACE_PACKAGES, 'core', 'package.json'))) return
    const dirs = new Set(readdirSync(WORKSPACE_PACKAGES))
    for (const name of names) expect(dirs.has(name.slice('@ghuri/'.length)), name).toBe(true)
  })
})
