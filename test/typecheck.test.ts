import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findPackageDir } from '../src/paths'
import { startApp, startProject } from '../src/scaffold'
import { cleanTmp, tmpDir } from './helpers'

afterAll(cleanTmp)

/** Packages still being built concurrently: tolerate "cannot find module" for them until they ship types. */
const PENDING =
  /error TS2307: Cannot find module '@ghuri\/(admin|auth|auth\/rest|rest|storage|storage\/fs|orm\/sqlite)'/

function tsc(dir: string): string[] {
  const bin = join(findPackageDir('typescript', dir)!, 'bin', 'tsc')
  try {
    execFileSync(process.execPath, [bin, '--noEmit', '-p', dir], { encoding: 'utf8' })
    return []
  } catch (err) {
    return String((err as any).stdout)
      .split('\n')
      .filter((l) => l.includes('error TS'))
  }
}

describe('generated code typechecks (tsc --noEmit)', () => {
  for (const db of ['d1', 'sqlite'] as const) {
    it(`startproject --db ${db} + startapp blog`, () => {
      const dir = startProject({ name: 'site', cwd: tmpDir(`tsc-${db}`), db }).directory
      startApp({ name: 'blog', cwd: dir })
      const errors = tsc(dir).filter((l) => !PENDING.test(l))
      expect(errors).toEqual([])
    })
  }
})
