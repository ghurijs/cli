// Minimum versions of the Ghuri packages that `startproject` writes into new projects' package.json.
//
// Keep each entry at the package's current release: npm installs the `latest` dist-tag whenever it satisfies a
// range, and `latest` can lag behind `next` (where alpha releases go), so `^0.1.0-alpha.0` would pull an old
// version. `test/versions.test.ts` fails when an entry differs from `packages/<name>/package.json` in the
// workspace, so bump the entry when releasing that package.

/** Minimum version per Ghuri package written by `startproject` (rendered as `^<version>`). */
export const GHURI_PACKAGE_VERSIONS = {
  '@ghuri/admin': '0.1.0-alpha.0',
  '@ghuri/auth': '0.1.0-alpha.4',
  '@ghuri/cli': '0.1.0-alpha.5',
  '@ghuri/core': '0.1.0-alpha.2',
  '@ghuri/graphql': '0.1.0-alpha.2',
  '@ghuri/orm': '0.1.0-alpha.4',
  '@ghuri/rest': '0.1.0-alpha.1',
  '@ghuri/storage': '0.1.0-alpha.1',
} as const satisfies Record<string, string>

export type GhuriPackageName = keyof typeof GHURI_PACKAGE_VERSIONS

/** The semver range `startproject` writes for `name` (`^<minimum version>`). */
export function ghuriRange(name: GhuriPackageName): string {
  return `^${GHURI_PACKAGE_VERSIONS[name]}`
}

/**
 * Template variable holding a package's range: `@ghuri/core` → `coreRange` (`{{coreRange}}` in
 * `templates/project/package.json.tpl`).
 */
export function rangeVarName(name: GhuriPackageName): string {
  return `${name.slice('@ghuri/'.length)}Range`
}

/** `{ adminRange: '^0.1.0-alpha.0', authRange: …, … }` for the project template. */
export function ghuriRangeVars(): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const name of Object.keys(GHURI_PACKAGE_VERSIONS) as GhuriPackageName[])
    vars[rangeVarName(name)] = ghuriRange(name)
  return vars
}
