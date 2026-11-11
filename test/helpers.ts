import { cpSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type RunCliOptions, runCli } from '../src/index'

export const FIXTURES = resolve(import.meta.dirname, 'fixtures')
/** Temp dirs live inside the package so fixture projects resolve @ghuri/* from the workspace. */
export const TMP = resolve(import.meta.dirname, '.tmp')

let counter = 0
const created: string[] = []
export function tmpDir(prefix = 'case'): string {
  const dir = join(TMP, `${prefix}-${process.pid}-${Date.now()}-${counter++}`)
  mkdirSync(dir, { recursive: true })
  created.push(dir)
  return dir
}

function dotify(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) dotify(p)
    else if (/^_[^_]/.test(entry)) renameSync(p, join(dir, `.${entry.slice(1)}`))
  }
}

/** Copy a fixture project into a fresh temp dir (`_x` files become `.x`). */
export function copyFixture(name: string): string {
  const dir = tmpDir(name)
  cpSync(join(FIXTURES, name), dir, { recursive: true })
  dotify(dir)
  return dir
}

/** Remove the temp dirs this test file created. */
export function cleanTmp(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
}

export async function run(argv: string[], opts: RunCliOptions = {}) {
  let out = ''
  let err = ''
  const code = await runCli(argv, {
    interactive: false,
    color: false,
    env: { PATH: process.env.PATH },
    stdout: (s) => {
      out += s
    },
    stderr: (s) => {
      err += s
    },
    ...opts,
  })
  return { code, out, err }
}
