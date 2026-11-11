import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanTmp, copyFixture, FIXTURES, run, tmpDir } from './helpers'

afterAll(cleanTmp)

const fakeOrm = join(FIXTURES, 'fake-orm-commands.ts')
const fakeOrmClasses = join(FIXTURES, 'fake-orm-classes.ts')

describe('help', () => {
  it('lists built-in commands outside a project', async () => {
    const { code, out } = await run(['help'], { cwd: tmpDir('help') })
    expect(code).toBe(0)
    expect(out).toContain('[ghuri]')
    for (const c of [
      'startproject',
      'startapp',
      'runserver',
      'shell',
      'check',
      'test',
      'deploy',
      'version',
      'routes',
    ]) {
      expect(out).toMatch(new RegExp(`^ {4}${c}\\b`, 'm'))
    }
    expect(out).toContain('Global options:')
    expect((await run([], { cwd: tmpDir('help') })).out).toBe(out)
    expect((await run(['--help'], { cwd: tmpDir('help') })).out).toBe(out)
  })

  it('groups app and ORM commands like manage.py help', async () => {
    const dir = copyFixture('basic')
    const { code, out } = await run(['help'], { cwd: dir, ormCommandsModule: fakeOrm })
    expect(code).toBe(0)
    expect(out).toMatch(/\[orm\]\n {4}fakemigrate\s+Pretends to apply migrations\n {4}showfakemigrations/)
    expect(out).toMatch(/\[demo\]\n {4}hello\s+Says hello from the fixture app/)
    expect(out.indexOf('[ghuri]')).toBeLessThan(out.indexOf('[orm]'))
    expect(out.indexOf('[orm]')).toBeLessThan(out.indexOf('[demo]'))
  })

  it('discovers exported XxxCommand classes when there is no registerOrmCommands()', async () => {
    const dir = copyFixture('basic')
    const { out } = await run(['help'], { cwd: dir, ormCommandsModule: fakeOrmClasses })
    expect(out).toMatch(/\[orm\][\s\S]*copydata[\s\S]*sqlflush/)
    const r = await run(['copydata'], { cwd: dir, ormCommandsModule: fakeOrmClasses })
    expect(r.out).toBe('copied\n')
  })

  it('notes when the project cannot be loaded', async () => {
    const dir = copyFixture('basic')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'src/settings.ts'), 'throw new Error("boom")\n')
    const { code, out } = await run(['help'], { cwd: dir })
    expect(code).toBe(0)
    expect(out).toContain('only built-in commands are listed')
    expect(out).toContain('boom')
  })

  it('shows per-command help with arguments, options and globals', async () => {
    const dir = copyFixture('basic')
    const { code, out } = await run(['hello', '--help'], { cwd: dir })
    expect(code).toBe(0)
    expect(out).toContain('Usage: ghuri hello [options] <name> [extra...]')
    expect(out).toContain('Says hello from the fixture app.')
    expect(out).toMatch(/-n, --times <n>\s+Repeat\. \(default: 1\)/)
    expect(out).toContain('--no-input')
    expect(out).toContain('--settings <path>')
    expect((await run(['help', 'hello'], { cwd: dir })).out).toBe(out)
  })

  it('suggests close matches for unknown commands', async () => {
    const outside = await run(['startprojct'], { cwd: tmpDir('help') })
    expect(outside.code).toBe(1)
    expect(outside.err).toContain("Unknown command: 'startprojct'. Did you mean startproject?")
    const dir = copyFixture('basic')
    const inside = await run(['hallo'], { cwd: dir })
    expect(inside.code).toBe(1)
    expect(inside.err).toContain('Did you mean hello?')
  })
})

describe('running project commands', () => {
  it('parses argv from the ArgumentParser spec and passes env through the Ghuri context', async () => {
    const dir = copyFixture('basic')
    const { code, out, err } = await run(['hello', 'world', 'a', 'b', '--shout', '-n', '2', '--no-input'], {
      cwd: dir,
      env: { FROM_DOTENV: 'shell' },
    })
    expect(err).toBe('')
    expect(code).toBe(0)
    expect(out).toContain('HELLO WORLD\nHELLO WORLD\n')
    const args = JSON.parse(/ARGS (.*)/.exec(out)![1])
    expect(args).toMatchObject({
      name: 'world',
      extra: ['a', 'b'],
      shout: true,
      times: 2,
      noInput: true,
      input: false,
    })
    expect(out).toContain('ENV yes from dev vars shell')
  })

  it('returns the exit code from handle()', async () => {
    const dir = copyFixture('basic')
    expect((await run(['hello', 'fail'], { cwd: dir })).code).toBe(3)
  })

  it('reports usage errors with exit code 2', async () => {
    const dir = copyFixture('basic')
    const { code, err } = await run(['hello', '--bogus'], { cwd: dir })
    expect(code).toBe(2)
    expect(err).toContain('ghuri hello: error: unrecognized option: --bogus')
  })

  it('runs ORM commands from an @ghuri/orm/commands style module', async () => {
    const dir = copyFixture('basic')
    const { code, out } = await run(['fakemigrate', 'blog', '--database', 'pg'], {
      cwd: dir,
      ormCommandsModule: fakeOrm,
    })
    expect(code).toBe(0)
    expect(out).toBe('migrating blog on pg\n')
  })

  it('works when @ghuri/orm/commands provides no commands yet', async () => {
    const dir = copyFixture('basic')
    const { code } = await run(['hello', 'x'], { cwd: dir })
    expect(code).toBe(0)
  })

  it('accepts --settings from another directory', async () => {
    const dir = copyFixture('basic')
    const { code, out } = await run(['--settings', join(dir, 'src/settings.ts'), 'routes'], { cwd: dir })
    expect(code).toBe(0)
    expect(out).toContain('/items/<int:id>/')
  })
})

describe('built-in project commands', () => {
  it('routes lists patterns with names and methods', async () => {
    const dir = copyFixture('basic')
    const { code, out } = await run(['routes'], { cwd: dir })
    expect(code).toBe(0)
    expect(out).toMatch(/^PATTERN\s+NAME\s+METHODS\s+VIEW$/m)
    expect(out).toMatch(/^\/\s+home\s+ANY\s+home$/m)
    expect(out).toMatch(/^\/items\/<int:id>\/\s+item-detail\s+GET\s+item$/m)
    const json = JSON.parse((await run(['show_urls', '--format', 'json'], { cwd: dir })).out)
    expect(json).toEqual([
      { pattern: '/', name: 'home', methods: 'ANY', view: 'home' },
      { pattern: '/items/<int:id>/', name: 'item-detail', methods: 'GET', view: 'item' },
    ])
  })

  it('check runs system checks', async () => {
    const dir = copyFixture('basic')
    const ok = await run(['check'], { cwd: dir })
    expect(ok.code).toBe(0)
    expect(ok.out).toContain('System check identified no issues (0 silenced).')
    const deploy = await run(['check', '--deploy'], { cwd: dir })
    expect(deploy.code).toBe(0)
    expect(deploy.out).toContain('WARNINGS:')
    expect(deploy.out).toContain('security.W018')
    const strict = await run(['check', '--deploy', '--fail-level', 'WARNING'], { cwd: dir })
    expect(strict.code).toBe(1)
    expect(strict.err).toContain('SystemCheckError')
  })

  it('shell -c evaluates code with settings, apps and env (top-level await)', async () => {
    const dir = copyFixture('basic')
    const { code, out } = await run(['shell', '-c', 'settings.FIXTURE_VALUE'], { cwd: dir })
    expect(code).toBe(0)
    expect(out).toBe("'yes from dev vars'\n")
    const multi = await run(
      [
        'shell',
        '--command',
        'const x = await Promise.resolve(apps.getAppConfigs().map((a) => a.appLabel)); return x',
      ],
      { cwd: dir },
    )
    expect(multi.out).toBe("[ 'demo' ]\n")
  })

  it('diffsettings hides defaults and secrets', async () => {
    const dir = copyFixture('basic')
    const { code, out } = await run(['diffsettings'], { cwd: dir })
    expect(code).toBe(0)
    expect(out).toContain("SECRET_KEY = '********'")
    expect(out).toContain("FIXTURE_VALUE = 'yes from dev vars'")
    expect(out).toContain('DEBUG = true')
    expect(out).not.toContain('APPEND_SLASH')
    const all = await run(['diffsettings', '--all'], { cwd: dir })
    expect(all.out).toContain('APPEND_SLASH = true\n')
    expect(all.out).toContain("FIXTURE_VALUE = 'yes from dev vars'  ###")
  })

  it('version prints the CLI and project package versions', async () => {
    const dir = copyFixture('basic')
    const { code, out } = await run(['version'], { cwd: dir })
    expect(code).toBe(0)
    expect(out).toMatch(/^ghuri 0\.1\.0/)
    expect(out).toMatch(/@ghuri\/core\s+0\.1\.0/)
    expect(out).toContain(`node             ${process.version}`)
    expect((await run(['--version'], { cwd: dir })).out).toMatch(/^0\.1\.0/)
  })
})

describe('commands that wrap tools', () => {
  function recorder() {
    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = []
    return {
      calls,
      spawn: async (cmd: string, args: string[], o: { cwd: string }) => {
        calls.push({ cmd, args, cwd: o.cwd })
        return 0
      },
    }
  }

  it('test spawns vitest run with forwarded args', async () => {
    const dir = copyFixture('basic')
    const r = recorder()
    const { code } = await run(['test', 'src/demo', '--reporter=dot'], { cwd: dir, spawn: r.spawn })
    expect(code).toBe(0)
    expect(r.calls[0].cmd).toBe(process.execPath)
    expect(r.calls[0].args[0]).toMatch(/vitest/)
    expect(r.calls[0].args.slice(1)).toEqual(['run', 'src/demo', '--reporter=dot'])
    expect(r.calls[0].cwd).toBe(dir)
  })

  it('runserver wraps wrangler dev, or serves with Node when there is no wrangler config', async () => {
    const dir = copyFixture('basic')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'wrangler.jsonc'), '{ "name": "x" }')
    const r = recorder()
    const { code } = await run(
      ['runserver', '0.0.0.0:9000', '--remote', '--env', 'staging', '--', '--log-level', 'debug'],
      {
        cwd: dir,
        spawn: r.spawn,
      },
    )
    expect(code).toBe(0)
    expect(r.calls[0].args[0]).toMatch(/wrangler/)
    expect(r.calls[0].args.slice(1)).toEqual([
      'dev',
      '--port',
      '9000',
      '--ip',
      '0.0.0.0',
      '--remote',
      '--env',
      'staging',
      '--log-level',
      'debug',
    ])
  })

  it('deploy runs migrate --remote first when asked, then wrangler deploy', async () => {
    const dir = copyFixture('basic')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'wrangler.jsonc'), '{ "name": "x" }')
    const r = recorder()
    const { code } = await run(['deploy', '--migrate', '--env', 'production'], { cwd: dir, spawn: r.spawn })
    expect(code).toBe(0)
    expect(r.calls).toHaveLength(2)
    expect(r.calls[0].args[0]).toMatch(/dist[\\/]bin\.js$/)
    expect(r.calls[0].args.slice(1)).toEqual(['migrate', '--remote', '--env', 'production'])
    expect(r.calls[1].args.slice(1)).toEqual(['deploy', '--env', 'production'])

    const skip = recorder()
    const noInput = await run(['deploy', '--no-input'], { cwd: dir, spawn: skip.spawn })
    expect(noInput.code).toBe(0)
    expect(noInput.err).toContain('Skipping migrations')
    expect(skip.calls.map((c) => c.args[1])).toEqual(['deploy'])
  })

  it('deploy stops when migrations fail', async () => {
    const dir = copyFixture('basic')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'wrangler.jsonc'), '{ "name": "x" }')
    const calls: string[][] = []
    const { code, err } = await run(['deploy', '--migrate'], {
      cwd: dir,
      spawn: async (_c, args) => {
        calls.push(args)
        return 5
      },
    })
    expect(code).toBe(5)
    expect(calls).toHaveLength(1)
    expect(err).toContain('not deploying')
  })
})

describe('real wrangler bindings', () => {
  it('loads local D1/R2 through getPlatformProxy and merges vars', { timeout: 180_000 }, async () => {
    const dir = copyFixture('basic')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      `{
        // fixture
        "name": "fixture",
        "main": "src/index.ts",
        "compatibility_date": "2026-11-01",
        "compatibility_flags": ["nodejs_compat"],
        "d1_databases": [{ "binding": "DB", "database_name": "fixture-db", "database_id": "00000000-0000-0000-0000-000000000000" }],
        "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "fixture-media" }],
        "vars": { "DEBUG": "false", "WRANGLER_VAR": "hello" },
      }`,
    )
    const code =
      "[typeof env.DB.prepare, typeof env.MEDIA.put, env.WRANGLER_VAR, env.DEBUG, settings.HAS_DB_BINDING, (await env.DB.prepare('select 1 as x').first()).x]"
    const r = await run(['shell', '-c', code, '--persist-to', join(dir, '.state')], { cwd: dir })
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    expect(r.out).toBe("[ 'function', 'function', 'hello', 'true', true, 1 ]\n")
  })
})
