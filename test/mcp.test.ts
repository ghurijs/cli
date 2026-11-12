import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import { guardStdout } from '../src/commands/mcp'
import { runCli } from '../src/index'
import { parseLlmsFull } from '../src/mcp/docs'
import { MCP_LATEST_PROTOCOL_VERSION, McpProtocol } from '../src/mcp/protocol'
import {
  createTools,
  DENIED_COMMANDS,
  defaultCliCommand,
  deniedReason,
  ProjectBridge,
  serverInfo,
  truncate,
} from '../src/mcp/server'
import { cleanTmp, copyFixture, tmpDir } from './helpers'

afterAll(cleanTmp)

const DOCS = `<SYSTEM>This is the full developer documentation for Ghuri</SYSTEM>

# Models and fields

> Define your data with Model classes.

Intro about models.

## Relations

Use \`ForeignKey\` with onDelete CASCADE and relatedName.

\`\`\`sh
# not a page heading
npx ghuri makemigrations
\`\`\`

## Field options

maxLength, null, blank and default.

# Migrations

> Evolve the schema.

## makemigrations

Run makemigrations after changing models, then migrate.
`

function writeDocs(): string {
  const file = join(tmpDir('docs'), 'llms-full.txt')
  writeFileSync(file, DOCS)
  return file
}

/** An in-process protocol + bridge (children run `src/bin.ts` through jiti). */
function client(cwd: string, opts: Partial<ConstructorParameters<typeof ProjectBridge>[0]> = {}) {
  const bridge = new ProjectBridge({ cwd, log: () => {}, docsUrl: writeDocs(), ...opts })
  const protocol = new McpProtocol(serverInfo(), createTools(bridge))
  let id = 0
  const request = async (method: string, params?: unknown) =>
    protocol.handleMessage({ jsonrpc: '2.0', id: ++id, method, params })
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await request('tools/call', { name, arguments: args })
    if (r?.error) throw new Error(`JSON-RPC error ${r.error.code}: ${r.error.message}`)
    const result = r!.result as {
      content: Array<{ text: string }>
      isError: boolean
      structuredContent?: any
    }
    return { ...result, text: result.content.map((c) => c.text).join('\n'), data: result.structuredContent }
  }
  return { bridge, protocol, request, call }
}

/** Drive `ghuri mcp` through runCli with in-memory stdin/stdout. */
async function session(cwd: string, messages: unknown[], extraArgs: string[] = []) {
  const stdin = new PassThrough()
  let out = ''
  let err = ''
  const done = runCli(['mcp', ...extraArgs], {
    cwd,
    stdin,
    interactive: false,
    color: false,
    stdout: (s) => {
      out += s
    },
    stderr: (s) => {
      err += s
    },
  })
  for (const m of messages) stdin.write(`${typeof m === 'string' ? m : JSON.stringify(m)}\n`)
  stdin.end()
  const code = await done
  const lines = out.split('\n').filter(Boolean)
  return { code, lines, responses: lines.map((l) => JSON.parse(l)), err }
}

const init = (version = '2025-06-18') => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } },
})

describe('protocol', () => {
  it('handshakes, negotiates the protocol version and lists tools', async () => {
    const { code, responses } = await session(tmpDir('mcp'), [
      init(),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
    ])
    expect(code).toBe(0)
    const byId = Object.fromEntries(responses.map((r) => [r.id, r]))
    expect(responses).toHaveLength(3) // nothing for the notification
    expect(byId[1].result.protocolVersion).toBe('2025-06-18')
    expect(byId[1].result.capabilities).toEqual({ tools: { listChanged: false } })
    expect(byId[1].result.serverInfo.name).toBe('ghuri')
    expect(byId[1].result.instructions).toMatch(/Django for TypeScript/)
    expect(byId[1].result.instructions).toMatch(/makemigrations/)
    expect(byId[1].result.instructions).toContain('https://ghurijs.github.io/docs/llms-full.txt')
    expect(byId[2].result).toEqual({})
    const tools = byId[3].result.tools as any[]
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'describe_model',
        'get_doc',
        'list_apps',
        'list_commands',
        'list_models',
        'list_routes',
        'project_info',
        'run_command',
        'search_docs',
        'show_migrations',
      ].sort(),
    )
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.description.length).toBeGreaterThan(20)
      if (t.name === 'run_command') {
        expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
      } else expect(t.annotations.readOnlyHint).toBe(true)
    }
  })

  it('falls back to the latest version and answers protocol errors', async () => {
    const { responses } = await session(tmpDir('mcp'), [
      init('1999-01-01'),
      'this is not json',
      { jsonrpc: '2.0', id: 2, method: 'nope/unknown' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'no_such_tool' } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: 'bad' },
      { jsonrpc: '1.0', id: 5, method: 'ping' },
      [
        { jsonrpc: '2.0', id: 6, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ],
    ])
    const byId = new Map(responses.filter((r) => !Array.isArray(r)).map((r) => [r.id, r]))
    expect(byId.get(1).result.protocolVersion).toBe(MCP_LATEST_PROTOCOL_VERSION)
    expect(byId.get(null).error.code).toBe(-32700)
    expect(byId.get(2).error.code).toBe(-32601)
    expect(byId.get(3).error.code).toBe(-32602)
    expect(byId.get(4).error.code).toBe(-32602)
    expect(byId.get(5).error.code).toBe(-32600)
    expect(responses.find((r) => Array.isArray(r))).toEqual([{ jsonrpc: '2.0', id: 6, result: {} }])
  })

  it('works outside a project; project tools explain what is wrong', async () => {
    const dir = tmpDir('outside')
    const { responses } = await session(dir, [
      init(),
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'project_info', arguments: {} } },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'run_command', arguments: { command: 'check' } },
      },
    ])
    expect(responses[0].result.serverInfo.name).toBe('ghuri')
    for (const r of responses.slice(1)) {
      expect(r.result.isError).toBe(true)
      expect(r.result.content[0].text).toMatch(/Not inside a Ghuri project/)
    }
  })

  it('rejects --remote for the server itself', async () => {
    const { code, err } = await session(tmpDir('mcp'), [], ['--remote'])
    expect(code).toBe(1)
    expect(err).toMatch(/does not support --remote/)
  })

  it('is listed by ghuri help', async () => {
    let out = ''
    await runCli(['help'], { cwd: tmpDir('help'), color: false, stdout: (s) => (out += s) })
    expect(out).toMatch(/^ {4}mcp\s+Run a Model Context Protocol server over stdio for AI coding agents$/m)
  })
})

describe('introspection tools', () => {
  it('project_info, list_apps, list_routes and list_commands describe the real project (secrets hidden)', async () => {
    const dir = copyFixture('models')
    const c = client(dir)
    const info = await c.call('project_info')
    expect(info.isError).toBe(false)
    expect(info.data).toMatchObject({
      root: dir,
      settingsModule: 'src/settings.ts',
      runtime: 'node',
      DEBUG: true,
      SECRET_KEY: '(set, hidden)',
      INSTALLED_APPS: ['shop'],
      MIDDLEWARE: ['CommonMiddleware'],
      DATABASES: { default: { vendor: 'sqlite', dialect: 'sqlite', name: 'db.sqlite3' } },
    })
    expect(info.data.otherSettings.PAYMENTS).toEqual({
      PROVIDER_URL: 'https://***@pay.example.com/v1',
      API_KEY: '(hidden)',
    })
    expect(info.data.packages['@ghuri/core']).toMatch(/^\d+\.\d+/)
    for (const secret of ['fixture-secret-key-do-not-leak', 'hunter2', 'sk_live_fixture']) {
      expect(info.text).not.toContain(secret)
    }

    const apps = await c.call('list_apps')
    expect(apps.data.apps).toEqual([
      {
        label: 'shop',
        name: 'shop',
        verboseName: 'Shop',
        source: 'project',
        path: 'src/shop',
        models: ['Category', 'Product', 'Tag'],
        commands: ['noisy'],
        hasMigrations: false,
      },
    ])

    const routes = await c.call('list_routes')
    expect(routes.data.routes).toEqual([
      { pattern: '/', name: 'home', methods: 'ANY', view: 'home' },
      { pattern: '/products/<int:id>/', name: 'product-detail', methods: 'GET', view: 'productDetail' },
    ])

    const commands = await c.call('list_commands')
    const byName = Object.fromEntries(commands.data.commands.map((x: any) => [x.name, x]))
    expect(byName.check.group).toBe('ghuri')
    expect(byName.makemigrations.group).toBe('orm')
    expect(byName.noisy).toMatchObject({ group: 'shop', help: 'Prints to stdout and stderr' })
    expect(byName.runserver.availableOverMcp).toBe(false)
    expect(byName.mcp.help).toMatch(/Model Context Protocol/)
    const usage = await c.call('list_commands', { command: 'makemigrations' })
    expect(usage.text).toMatch(/Usage: ghuri makemigrations/)
    expect(usage.text).toContain('--dry-run')
    expect((await c.call('list_commands', { command: 'nope' })).isError).toBe(true)
  })

  it('list_models and describe_model use the ORM meta API, and pick up edits', async () => {
    const dir = copyFixture('models')
    const c = client(dir)
    const list = await c.call('list_models')
    expect(list.data.models.map((m: any) => m.label)).toEqual(['shop.Category', 'shop.Product', 'shop.Tag'])
    expect(list.data.models[1].fields).toContain('category: ForeignKey → shop.Category')
    expect(list.data.models[1].fields).toContain('tags: ManyToManyField → shop.Tag')
    expect((await c.call('list_models', { app: 'nope' })).isError).toBe(true)

    const product = (await c.call('describe_model', { model: 'shop.Product' })).data
    expect(product).toMatchObject({
      label: 'shop.Product',
      app: 'shop',
      name: 'Product',
      dbTable: 'shop_product',
      pk: 'id',
    })
    const field = (name: string) => product.fields.find((f: any) => f.name === name)
    expect(field('name')).toEqual({
      name: 'name',
      type: 'CharField',
      column: 'name',
      options: { maxLength: 200 },
    })
    expect(field('price').options).toEqual({ default: 0, helpText: 'In cents.' })
    expect(field('status').options.choices).toEqual([
      ['draft', 'Draft'],
      ['live', 'Live'],
    ])
    expect(field('category')).toMatchObject({
      type: 'ForeignKey',
      column: 'category_id',
      attname: 'categoryId',
      relation: { to: 'shop.Category', onDelete: 'CASCADE', relatedName: 'products' },
    })
    expect(field('replacement')).toMatchObject({
      options: { null: true, blank: true },
      relation: { to: 'shop.Product', onDelete: 'SET_NULL' },
    })
    expect(field('tags')).toMatchObject({ type: 'ManyToManyField', relation: { to: 'shop.Tag' } })
    expect(product.meta).toMatchObject({
      ordering: ['-price'],
      uniqueTogether: [['category', 'name']],
      indexes: [{ fields: ['status', 'price'], name: 'shop_product_status_price' }],
    })
    expect(product.managers).toEqual([{ name: 'objects', class: 'Manager' }])

    const category = (await c.call('describe_model', { model: 'category' })).data
    expect(category.meta).toMatchObject({ ordering: ['name'], verboseNamePlural: 'categories' })
    expect(category.reverseRelations).toEqual([
      {
        name: 'products',
        accessor: 'products',
        model: 'shop.Product',
        field: 'category',
        kind: 'one-to-many',
        onDelete: 'CASCADE',
      },
    ])
    const tag = (await c.call('describe_model', { model: 'Tag' })).data
    expect(tag.reverseRelations).toMatchObject([
      { model: 'shop.Product', field: 'tags', kind: 'many-to-many' },
    ])

    const missing = await c.call('describe_model', { model: 'shop.Order' })
    expect(missing.isError).toBe(true)
    expect(missing.text).toMatch(/No model 'shop.Order'.*shop.Category/)
    expect((await c.call('describe_model', {})).text).toMatch(/Missing required argument 'model'/)

    // The agent edits models.ts: the next call sees the new model.
    const models = join(dir, 'src/shop/models.ts')
    writeFileSync(
      models,
      `${readFileSync(models, 'utf8')}\nexport class Review extends Model({ body: new CharField({ maxLength: 500 }) }) {}\n`,
    )
    const again = await c.call('list_models')
    expect(again.data.models.map((m: any) => m.label)).toContain('shop.Review')
  })

  it('returns a tool error (not a crash) for a broken model file, and recovers once fixed', async () => {
    const dir = copyFixture('models')
    const c = client(dir)
    const models = join(dir, 'src/shop/models.ts')
    const good = readFileSync(models, 'utf8')
    writeFileSync(
      models,
      `${good}\nexport class Broken extends Model({ oops: new CharField({ maxLength: }) }) {}\n`,
    )
    const r = await c.call('list_models')
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/The project could not be loaded/)
    expect(r.text).toMatch(/models\.ts/)
    expect((await c.call('show_migrations')).isError).toBe(true)
    writeFileSync(models, good)
    expect((await c.call('list_models')).isError).toBe(false)
  })

  it('reports a broken settings module', async () => {
    const dir = copyFixture('models')
    writeFileSync(join(dir, 'src/settings.ts'), 'throw new Error("settings exploded")\n')
    const r = await client(dir).call('project_info')
    expect(r.isError).toBe(true)
    expect(r.text).toContain('settings exploded')
  })
})

describe('migrations and run_command', () => {
  it('makemigrations → show_migrations → migrate', async () => {
    const dir = copyFixture('models')
    const c = client(dir)
    expect((await c.call('show_migrations')).data).toEqual({
      database: 'default',
      apps: [{ app: 'shop', migrations: [] }],
      unapplied: [],
    })

    const dry = await c.call('run_command', { command: 'makemigrations', args: ['--dry-run'] })
    expect(dry.isError).toBe(false)
    expect(dry.text).toMatch(/exit code 0/)
    expect(existsSync(join(dir, 'src/shop/migrations'))).toBe(false)

    const make = await c.call('run_command', { command: 'makemigrations', args: ['shop'] })
    expect(make.isError).toBe(false)
    expect(make.text).toMatch(/0001_initial/)
    expect(existsSync(join(dir, 'src/shop/migrations/0001_initial.ts'))).toBe(true)

    const pending = (await c.call('show_migrations', { app: ['shop'] })).data
    expect(pending.apps).toEqual([{ app: 'shop', migrations: [{ name: '0001_initial', applied: false }] }])
    expect(pending.unapplied).toEqual(['shop.0001_initial'])

    const migrate = await c.call('run_command', { command: 'migrate', args: ['--no-input'] })
    expect(migrate.isError).toBe(false)
    const applied = (await c.call('show_migrations')).data
    expect(applied.apps[0].migrations).toEqual([{ name: '0001_initial', applied: true }])
    expect(applied.unapplied).toEqual([])
  })

  it('captures command output, exit codes and failures', async () => {
    const dir = copyFixture('models')
    const c = client(dir)
    const noisy = await c.call('run_command', { command: 'noisy' })
    expect(noisy.isError).toBe(false)
    expect(noisy.text).toMatch(/^\$ ghuri noisy\n\(exit code 0, [\d.]+s\)/)
    expect(noisy.text).toMatch(/--- stdout ---[\s\S]*console\.log from noisy[\s\S]*noisy stdout/)
    expect(noisy.text).toMatch(/--- stderr ---\nnoisy stderr/)

    const unknown = await c.call('run_command', { command: 'nosuchcommand' })
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toMatch(/exit code 1/)
    expect(unknown.text).toMatch(/Unknown command: 'nosuchcommand'/)

    expect((await c.call('run_command', { command: 'check; rm -rf /' })).text).toMatch(/Invalid command name/)
    expect((await c.call('run_command', { command: 'check', args: [1, {}] as any })).text).toMatch(
      /array of strings/,
    )
  })

  it('denies interactive, long-running and production commands without spawning anything', async () => {
    const dir = copyFixture('models')
    const c = client(dir, { cliCommand: ['/nonexistent/node-that-must-not-run'] })
    for (const command of Object.keys(DENIED_COMMANDS)) {
      const r = await c.call('run_command', { command })
      expect(r.isError, command).toBe(true)
      expect(r.text).toMatch(/not available over MCP/)
    }
    for (const args of [['--remote'], ['--remote=true'], ['--database', 'default', '--remote']]) {
      const r = await c.call('run_command', { command: 'migrate', args })
      expect(r.isError).toBe(true)
      expect(r.text).toMatch(/--remote is not available/)
    }
    expect((await c.call('run_command', { command: 'createsuperuser' })).text).toMatch(/--no-input/)
    expect((await c.call('run_command', { command: 'test', args: ['--watch'] })).text).toMatch(/never exits/)
    expect(deniedReason('createsuperuser', ['--no-input', '--username', 'a'])).toBeUndefined()
    expect(deniedReason('createsuperuser', ['--noinput'])).toBeUndefined()
    for (const ok of [
      'check',
      'makemigrations',
      'migrate',
      'test',
      'startapp',
      'sqlmigrate',
      'dumpdata',
      'routes',
    ]) {
      expect(deniedReason(ok, []), ok).toBeUndefined()
    }
  })

  it('truncates very long output, keeping head and tail', () => {
    const long = `HEAD${'x'.repeat(100_000)}TAIL`
    const t = truncate(long, 1000)
    expect(t.truncated).toBe(true)
    expect(t.text.startsWith('HEAD')).toBe(true)
    expect(t.text.endsWith('TAIL')).toBe(true)
    expect(t.text).toMatch(/characters truncated/)
    expect(truncate('short').truncated).toBe(false)
  })
})

describe('stdout hygiene', () => {
  it('a real `ghuri mcp` process writes nothing but JSON-RPC lines on stdout', async () => {
    const dir = copyFixture('models')
    const [node, ...prefix] = defaultCliCommand()
    const child = spawn(node, [...prefix, 'mcp', '--docs-url', writeDocs()], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8').on('data', (c) => (out += c))
    child.stderr.setEncoding('utf8').on('data', (c) => (err += c))
    const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`)
    const waitFor = async (id: number) => {
      for (let i = 0; i < 600 && !out.split('\n').some((l) => l.includes(`"id":${id},`)); i++) {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    send(init())
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'project_info', arguments: {} } })
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'run_command', arguments: { command: 'noisy' } },
    })
    send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'search_docs', arguments: { query: 'foreignkey' } },
    })
    await waitFor(2)
    await waitFor(3)
    await waitFor(4)
    child.stdin.end()
    const code = await new Promise((r) => child.on('close', r))
    expect(code).toBe(0)
    const lines = out.split('\n').filter(Boolean)
    expect(lines).toHaveLength(4)
    for (const line of lines) {
      const msg = JSON.parse(line)
      expect(msg.jsonrpc).toBe('2.0')
      expect(msg.result).toBeDefined()
    }
    const byId = Object.fromEntries(lines.map((l) => JSON.parse(l)).map((m) => [m.id, m]))
    expect(byId[2].result.isError).toBe(false)
    expect(byId[3].result.content[0].text).toContain('console.log from noisy')
    expect(byId[4].result.content[0].text).toMatch(/Relations/)
    // What the project printed while loading went to stderr (it only appears on stdout inside the JSON
    // result of run_command, which captures the command's own output).
    expect(lines.every((l) => l.startsWith('{"jsonrpc":"2.0"'))).toBe(true)
    expect(err).toContain('settings: loading the models fixture')
    expect(err).toContain('raw stdout noise from settings')
  })

  it('guardStdout() sends console.log and process.stdout.write to stderr until restored', () => {
    const errWrite = process.stderr.write
    const captured: string[] = []
    process.stderr.write = ((chunk: any) => {
      captured.push(String(chunk))
      return true
    }) as any
    const protocolLines: string[] = []
    const origWrite = process.stdout.write
    let guard: ReturnType<typeof guardStdout> | undefined
    let redirected = false
    try {
      // The protocol writer is the original stdout writer; capture it for the test.
      process.stdout.write = ((chunk: any) => {
        protocolLines.push(String(chunk))
        return true
      }) as any
      guard = guardStdout()
      // vitest replaces the global console, so check the redirection itself.
      redirected = console.log === console.error && console.info === console.error
      process.stdout.write('from stdout.write\n')
      guard.write('{"jsonrpc":"2.0"}\n')
    } finally {
      guard?.restore()
      process.stdout.write = origWrite
      process.stderr.write = errWrite
    }
    expect(protocolLines).toEqual(['{"jsonrpc":"2.0"}\n'])
    expect(redirected).toBe(true)
    expect(captured.join('')).toContain('from stdout.write')
    expect(console.log).not.toBe(console.error)
  })
})

describe('docs tools', () => {
  it('splits llms-full.txt into pages and sections, ignoring # inside code fences', () => {
    const pages = parseLlmsFull(DOCS)
    expect(pages.map((p) => p.title)).toEqual(['Models and fields', 'Migrations'])
    expect(pages[0].slug).toBe('models-and-fields')
    expect(pages[0].description).toBe('Define your data with Model classes.')
    expect(pages[0].sections.map((s) => s.heading)).toEqual(['', 'Relations', 'Field options'])
    expect(pages[0].text).toContain('# not a page heading')
  })

  it('search_docs ranks sections; get_doc reads a page by slug, title or path', async () => {
    const c = client(tmpDir('docs'))
    const hits = await c.call('search_docs', { query: 'ForeignKey onDelete' })
    expect(hits.isError).toBe(false)
    expect(hits.text.split('\n')[0]).toBe('## Models and fields › Relations')
    expect(hits.text).toContain('(page: models-and-fields)')
    expect((await c.call('search_docs', { query: 'zzzz qqqq' })).text).toMatch(/No documentation sections/)

    const page = await c.call('get_doc', { path: 'models-and-fields' })
    expect(page.text).toMatch(/^# Models and fields\n\n> Define your data/)
    expect(page.text).toContain('## Field options')
    expect((await c.call('get_doc', { path: 'topics/migrations' })).text).toMatch(/^# Migrations/)
    expect((await c.call('get_doc', { path: 'Migrations', section: 'makemigrations' })).text).toMatch(
      /^# Migrations › makemigrations\n\nRun makemigrations/,
    )
    expect((await c.call('get_doc', {})).text).toContain('- migrations: Migrations — Evolve the schema.')
    const missing = await c.call('get_doc', { path: 'nope-nothing' })
    expect(missing.isError).toBe(true)
    expect(missing.text).toMatch(/Pages: models-and-fields, migrations/)
  })

  it('fails gracefully when the docs cannot be fetched, and retries later', async () => {
    let calls = 0
    const fetch404 = (async () => {
      calls++
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    const c = client(tmpDir('docs'), { docsUrl: 'https://example.invalid/llms-full.txt', fetch: fetch404 })
    const r = await c.call('search_docs', { query: 'models' })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/HTTP 404/)
    expect(r.text).toContain('https://ghurijs.github.io/docs/')
    const offline = client(tmpDir('docs'), {
      docsUrl: 'https://example.invalid/llms-full.txt',
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch,
    })
    expect((await offline.call('get_doc', { path: 'x' })).text).toMatch(/offline/)
    await c.call('get_doc', {})
    expect(calls).toBe(2)
  })
})
