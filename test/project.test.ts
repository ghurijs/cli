import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadEnvFiles, parseDotenv } from '../src/dotenv'
import { loadProject, locateProject, parseJsonc, writeRemoteConfig } from '../src/project'
import { cleanTmp, copyFixture, tmpDir } from './helpers'

afterAll(cleanTmp)

describe('parseDotenv', () => {
  it('parses quotes, comments, export and multi-line values', () => {
    const env = parseDotenv(
      [
        '# comment',
        'A=1',
        'export B = two # trailing comment',
        'C="quoted # not a comment"',
        "D='single'",
        'E="line1\\nline2"',
        'F="multi',
        'line"',
        'G=',
        'not a var',
      ].join('\n'),
    )
    expect(env).toEqual({
      A: '1',
      B: 'two',
      C: 'quoted # not a comment',
      D: 'single',
      E: 'line1\nline2',
      F: 'multi\nline',
      G: '',
    })
  })

  it('loads .env then .dev.vars (later wins), with per-environment files', () => {
    const dir = tmpDir('env')
    writeFileSync(join(dir, '.env'), 'X=env\nY=env')
    writeFileSync(join(dir, '.dev.vars'), 'X=devvars')
    writeFileSync(join(dir, '.dev.vars.staging'), 'X=staging')
    expect(loadEnvFiles(dir)).toEqual({ X: 'devvars', Y: 'env' })
    expect(loadEnvFiles(dir, 'staging')).toEqual({ X: 'staging', Y: 'env' })
  })
})

describe('parseJsonc', () => {
  it('strips comments and trailing commas but not string contents', () => {
    expect(parseJsonc('{\n // c\n "a": "http://x", /* b */ "b": [1,2,],\n}')).toEqual({
      a: 'http://x',
      b: [1, 2],
    })
  })
})

describe('locateProject / loadProject', () => {
  it('imports TS settings with jiti and validates the factory', async () => {
    const dir = copyFixture('basic')
    const p = await locateProject({ cwd: join(dir, 'src') })
    expect(p.root).toBe(dir)
    expect(p.core.isSettingsFactory(p.settingsFactory)).toBe(true)
  })

  it('rejects settings modules that are not a SettingsFactory', async () => {
    const dir = copyFixture('basic')
    writeFileSync(join(dir, 'src/settings.ts'), 'export default { SECRET_KEY: "x" }\n')
    await expect(locateProject({ cwd: dir })).rejects.toThrow(/must export default defineSettings/)
  })

  it('reports a missing project', async () => {
    await expect(locateProject({ cwd: '/' })).rejects.toThrow(/No Ghuri project found/)
  })

  it('builds env from .dev.vars, .env and process env (process env wins over files)', async () => {
    const dir = copyFixture('basic')
    const p = await loadProject({ cwd: dir, processEnv: { FROM_DOTENV: 'shell' } })
    expect(p.env.SECRET_KEY).toBe('from-dev-vars')
    expect(p.env.FROM_DEV_VARS).toBe('yes from dev vars')
    expect(p.env.FROM_DOTENV).toBe('shell')
    expect(p.hasBindings).toBe(false)
    expect(p.settingsFactory(p.env).FIXTURE_VALUE).toBe('yes from dev vars')
    await p.dispose()
  })

  it('merges wrangler platform-proxy bindings (local by default) and disposes the proxy', async () => {
    const dir = copyFixture('basic')
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      '{ "name": "x", "d1_databases": [{ "binding": "DB", "database_id": "abc" }] }',
    )
    const calls: any[] = []
    let disposed = false
    const db = { prepare() {} }
    const p = await loadProject({
      cwd: dir,
      processEnv: { SECRET_KEY: 'from-shell' },
      getPlatformProxy: async (opts) => {
        calls.push(opts)
        return {
          env: { DB: db, SECRET_KEY: 'from-wrangler-vars', WRANGLER_VAR: 'w' },
          dispose: async () => {
            disposed = true
          },
        }
      },
    })
    expect(calls).toEqual([
      {
        configPath: join(dir, 'wrangler.jsonc'),
        environment: undefined,
        persist: true,
        remoteBindings: false,
      },
    ])
    expect(p.env.DB).toBe(db)
    expect(p.env.WRANGLER_VAR).toBe('w')
    expect(p.env.SECRET_KEY).toBe('from-shell')
    expect(p.hasBindings).toBe(true)
    expect(p.settingsFactory(p.env).HAS_DB_BINDING).toBe(true)
    await p.dispose()
    expect(disposed).toBe(true)
  })

  it('--remote marks D1/R2/KV bindings remote in a temporary config', async () => {
    const dir = copyFixture('basic')
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      '{ // c\n "name": "x", "d1_databases": [{ "binding": "DB", "database_id": "abc" }], "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "m" }],\n "env": { "staging": { "kv_namespaces": [{ "binding": "CACHE", "id": "k" }] } } }',
    )
    let seen: any
    let tmpContent: any
    const p = await loadProject({
      cwd: dir,
      remote: true,
      environment: 'staging',
      persistTo: '/tmp/state',
      getPlatformProxy: async (opts) => {
        seen = opts
        tmpContent = JSON.parse(readFileSync(opts.configPath as string, 'utf8'))
        return { env: {}, dispose: async () => {} }
      },
    })
    expect(seen.remoteBindings).toBe(true)
    expect(seen.environment).toBe('staging')
    expect(seen.persist).toEqual({ path: '/tmp/state' })
    expect(seen.configPath).not.toBe(join(dir, 'wrangler.jsonc'))
    expect(tmpContent.d1_databases[0].remote).toBe(true)
    expect(tmpContent.r2_buckets[0].remote).toBe(true)
    expect(tmpContent.env.staging.kv_namespaces[0].remote).toBe(true)
    await p.dispose()
    expect(existsSync(seen.configPath)).toBe(false)
  })

  it('writeRemoteConfig reads wrangler.toml through wrangler', async () => {
    const dir = copyFixture('basic')
    const toml = join(dir, 'wrangler.toml')
    writeFileSync(toml, 'name = "x"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_id = "abc"\n')
    const tmp = await writeRemoteConfig(dir, toml)
    expect(JSON.parse(readFileSync(tmp, 'utf8')).d1_databases[0]).toMatchObject({
      binding: 'DB',
      remote: true,
    })
  })
})
