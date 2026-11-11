import { ArgumentParser } from '@ghuri/core'
import { describe, expect, it } from 'vitest'
import { parseArgv, parseOptionFlags, specFromParser, UsageError } from '../src/argv'

function spec(build: (p: ArgumentParser) => void) {
  const p = new ArgumentParser()
  build(p)
  return specFromParser(p)
}

describe('parseOptionFlags', () => {
  it('parses boolean, value, short and negated flags', () => {
    expect(parseOptionFlags({ flags: '--remote' })).toMatchObject({
      long: 'remote',
      key: 'remote',
      value: 'none',
    })
    expect(parseOptionFlags({ flags: '-n, --name <value>' })).toMatchObject({
      long: 'name',
      short: 'n',
      key: 'name',
      value: 'required',
      metavar: 'value',
    })
    expect(parseOptionFlags({ flags: '--no-input' })).toMatchObject({ key: 'noInput', negates: 'input' })
    expect(parseOptionFlags({ flags: '--port [port]' })).toMatchObject({ value: 'optional' })
    expect(parseOptionFlags({ flags: '--tag <tag...>' })).toMatchObject({ multiple: true, metavar: 'tag' })
    expect(parseOptionFlags({ flags: '--dry-run' }).key).toBe('dryRun')
  })
})

describe('parseArgv', () => {
  const s = spec((p) =>
    p
      .argument('app', { help: 'app', required: true })
      .argument('name')
      .option('--remote')
      .option('-n, --name-prefix <value>')
      .option('--no-input')
      .option('--port <port>', { default: 8000 })
      .option('-v, --verbose')
      .option('-q, --quiet')
      .option('--tag <tag...>'),
  )

  it('applies defaults', () => {
    expect(parseArgv(['blog'], s)).toEqual({
      app: 'blog',
      remote: false,
      noInput: false,
      input: true,
      port: 8000,
      verbose: false,
      quiet: false,
      tag: [],
    })
  })

  it('parses positionals and options in any order', () => {
    const args = parseArgv(['--remote', 'blog', '-n', 'x', '0002', '--port=9000', '--no-input'], s)
    expect(args).toMatchObject({
      app: 'blog',
      name: '0002',
      remote: true,
      namePrefix: 'x',
      port: 9000,
      noInput: true,
      input: false,
    })
  })

  it('supports -nVALUE, -n=VALUE, combined short booleans and repeated list options', () => {
    expect(parseArgv(['blog', '-nabc'], s).namePrefix).toBe('abc')
    expect(parseArgv(['blog', '-n=abc'], s).namePrefix).toBe('abc')
    expect(parseArgv(['blog', '-vq'], s)).toMatchObject({ verbose: true, quiet: true })
    expect(parseArgv(['blog', '--tag', 'a', '--tag=b'], s).tag).toEqual(['a', 'b'])
  })

  it('accepts the Django spelling --noinput', () => {
    expect(parseArgv(['blog', '--noinput'], s).noInput).toBe(true)
  })

  it('reports missing and unknown arguments', () => {
    expect(() => parseArgv([], s)).toThrow(/required: app/)
    expect(() => parseArgv(['blog', 'a', 'b'], s)).toThrow(/unrecognized arguments: b/)
    expect(() => parseArgv(['blog', '--remot'], s)).toThrow(
      /unrecognized option: --remot \(did you mean 'remote'\?\)/,
    )
    expect(() => parseArgv(['blog', '--port'], s)).toThrow(UsageError)
    expect(() => parseArgv(['blog', '--port', 'abc'], s)).toThrow(/expected a number/)
    expect(() => parseArgv(['blog', '--remote=yes'], s)).toThrow(/does not take a value/)
  })

  it('collects variadic positionals', () => {
    const v = spec((p) => p.argument('labels', { variadic: true }).option('--all'))
    expect(parseArgv(['a', 'b', '--all', 'c'], v)).toEqual({ labels: ['a', 'b', 'c'], all: true })
    expect(parseArgv([], v)).toEqual({ labels: [], all: false })
    const req = spec((p) => p.argument('labels', { variadic: true, required: true }))
    expect(() => parseArgv([], req)).toThrow(/required/)
  })

  it('puts everything after -- and (in passthrough mode) unknown args in args._', () => {
    const p = spec((x) => x.option('--watch'))
    expect(parseArgv(['--watch', '--', '--reporter', 'dot'], p)).toEqual({
      watch: true,
      _: ['--reporter', 'dot'],
    })
    expect(parseArgv(['--reporter=dot', 'file.ts', '--watch'], p, { passthrough: true })).toEqual({
      watch: true,
      _: ['--reporter=dot', 'file.ts'],
    })
  })

  it('handles optional values', () => {
    const p = spec((x) => x.option('--color [when]'))
    expect(parseArgv(['--color'], p).color).toBe(true)
    expect(parseArgv(['--color', 'always'], p).color).toBe('always')
  })
})
