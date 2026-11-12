import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseJsonc } from '../src/project'
import { COMPATIBILITY_DATE, generateSecretKey, startProject } from '../src/scaffold'
import { cleanTmp, run, tmpDir } from './helpers'

afterAll(cleanTmp)

const read = (dir: string, f: string) => readFileSync(join(dir, f), 'utf8')

function noPlaceholders(dir: string, files: string[]) {
  for (const f of files) expect(read(dir, f), f).not.toMatch(/\{\{|\}\}(?!\s*\))/)
}

describe('startProject (d1)', () => {
  const cwd = tmpDir('sp')
  const result = startProject({ name: 'my_site', cwd, db: 'd1', pm: 'npm', secretKey: 'k'.repeat(64) })
  const dir = result.directory

  it('writes the spec §11 layout', () => {
    expect(dir).toBe(join(cwd, 'my_site'))
    expect(result.files.sort()).toEqual(
      [
        '.dev.vars',
        '.dev.vars.example',
        '.gitignore',
        '.mcp.json',
        'AGENTS.md',
        'CLAUDE.md',
        'README.md',
        'package.json',
        'src/index.ts',
        'src/server.ts',
        'src/settings.ts',
        'src/urls.ts',
        'tsconfig.json',
        'vitest.config.ts',
        'wrangler.jsonc',
      ].sort(),
    )
    for (const f of result.files) expect(existsSync(join(dir, f)), f).toBe(true)
    noPlaceholders(dir, result.files)
  })

  it('renders a valid package.json', () => {
    const pkg = JSON.parse(read(dir, 'package.json'))
    expect(pkg.name).toBe('my-site')
    expect(pkg.type).toBe('module')
    expect(pkg.ghuri).toEqual({ settings: 'src/settings.ts' })
    for (const s of ['dev', 'deploy', 'migrate', 'makemigrations', 'test', 'ghuri'])
      expect(pkg.scripts[s]).toBeTruthy()
    for (const d of [
      '@ghuri/core',
      '@ghuri/orm',
      '@ghuri/auth',
      '@ghuri/rest',
      '@ghuri/admin',
      '@ghuri/storage',
    ]) {
      // @ghuri/rest 0.1.0-alpha.1 adds RestFrameworkConfig, which the template installs.
      expect(pkg.dependencies[d]).toBe(d === '@ghuri/rest' ? '^0.1.0-alpha.1' : '^0.1.0-alpha.0')
    }
    expect(pkg.devDependencies['@ghuri/cli']).toBe('^0.1.0-alpha.1')
    for (const d of ['wrangler', 'typescript', 'vitest', '@cloudflare/workers-types', '@ghuri/cli']) {
      expect(pkg.devDependencies[d]).toBeTruthy()
    }
  })

  it('renders wrangler.jsonc with nodejs_compat and DB/MEDIA bindings', () => {
    const cfg = parseJsonc(read(dir, 'wrangler.jsonc'))
    expect(cfg.name).toBe('my-site')
    expect(cfg.main).toBe('src/index.ts')
    expect(cfg.compatibility_flags).toContain('nodejs_compat')
    expect(cfg.compatibility_date).toBe(COMPATIBILITY_DATE)
    expect(cfg.d1_databases[0]).toMatchObject({ binding: 'DB', database_name: 'my-site-db' })
    expect(cfg.r2_buckets[0]).toMatchObject({ binding: 'MEDIA' })
    expect(read(dir, 'wrangler.jsonc')).toContain('wrangler d1 create my-site-db')
  })

  it('writes the secret key to .dev.vars only', () => {
    expect(read(dir, '.dev.vars')).toContain(`SECRET_KEY=${'k'.repeat(64)}`)
    expect(read(dir, '.dev.vars.example')).not.toContain('k'.repeat(64))
    expect(read(dir, '.gitignore')).toMatch(/^\.dev\.vars$/m)
  })

  it('renders settings that switch on DATABASE_URL', () => {
    const settings = read(dir, 'src/settings.ts')
    expect(settings).toContain("env.DATABASE_URL ? postgres({ url: env.DATABASE_URL }) : d1('DB')")
    expect(settings).toContain("default: r2('MEDIA')")
    expect(settings).toMatch(
      /INSTALLED_APPS: \[\s+ContentTypesConfig,\s+AuthConfig,\s+SessionsConfig,\s+AuthTokenConfig,\s+AdminConfig,\s+RestFrameworkConfig,\s+\]/,
    )
    expect(settings).toContain('REST_FRAMEWORK')
    expect(read(dir, 'src/urls.ts')).toContain("path('admin/', admin.site.urls)")
    expect(read(dir, 'src/urls.ts')).toContain("path('api/', include(router.urls))")
    expect(read(dir, 'src/index.ts')).toContain('export default createApp(settings)')
  })

  it('serves the OpenAPI schema with Swagger UI and Scalar, and installs generateschema', () => {
    const settings = read(dir, 'src/settings.ts')
    expect(settings).toContain(
      "import { IsAuthenticatedOrReadOnly, PageNumberPagination, RestFrameworkConfig } from '@ghuri/rest'",
    )
    const urls = read(dir, 'src/urls.ts')
    expect(urls).toContain(
      "import { DefaultRouter, ScalarView, SchemaView, SwaggerUIView } from '@ghuri/rest'",
    )
    expect(urls).toContain(
      "path('api/schema/', SchemaView.asView({ title: 'my_site API', version: '0.1.0' }), { name: 'schema' })",
    )
    expect(urls).toContain(
      "path('api/docs/', SwaggerUIView.asView({ urlName: 'schema' }), { name: 'swagger-ui' })",
    )
    expect(urls).toContain(
      "path('api/reference/', ScalarView.asView({ urlName: 'schema' }), { name: 'scalar' })",
    )
    // Before the router include, so a viewset registered as 'schema' or 'docs' can't shadow them.
    expect(urls.indexOf("path('api/schema/'")).toBeLessThan(
      urls.indexOf("path('api/', include(router.urls))"),
    )
    expect(urls).toContain("docs: '/api/docs/'")
    const readme = read(dir, 'README.md')
    expect(readme).toContain('## REST API and OpenAPI')
    expect(readme).toContain('npx ghuri generateschema --file openapi.yaml')
    expect(read(dir, 'AGENTS.md')).toContain('npx ghuri generateschema --file openapi.yaml')
  })

  it('suggests next steps', () => {
    expect(result.nextSteps).toEqual([
      'cd my_site',
      'npm install',
      expect.stringContaining('npx wrangler d1 create my-site-db'),
      'npx ghuri migrate',
      'npx ghuri createsuperuser',
      'npm run dev',
    ])
  })
})

describe('startProject AI agent files', () => {
  it('renders AGENTS.md for the project, CLAUDE.md importing it and .mcp.json for npm', () => {
    const r = startProject({ name: 'my_site', cwd: tmpDir('sp'), db: 'd1', pm: 'npm' })
    const agents = read(r.directory, 'AGENTS.md')
    expect(agents).toContain('# AGENTS.md — my_site')
    expect(agents).toContain('Django for TypeScript')
    expect(agents).toContain('npx ghuri makemigrations')
    expect(agents).toContain('npx ghuri deploy')
    expect(agents).toContain('npx ghuri mcp')
    expect(agents).toContain('/plugin install ghuri@ghuri')
    expect(agents).toContain('https://ghurijs.github.io/docs/llms-full.txt')
    expect(agents).toContain('running here on Cloudflare Workers')
    expect(agents).not.toContain('src/schema.ts')
    expect(read(r.directory, 'CLAUDE.md').split('\n')[0]).toBe('@AGENTS.md')
    expect(JSON.parse(read(r.directory, '.mcp.json'))).toEqual({
      mcpServers: { ghuri: { command: 'npx', args: ['ghuri', 'mcp'] } },
    })
    expect(read(r.directory, 'README.md')).toContain('## Working with AI coding agents')
    noPlaceholders(r.directory, ['AGENTS.md', 'CLAUDE.md', '.mcp.json', 'README.md'])
  })

  it('runs the MCP server through the chosen package manager', () => {
    const cases = [
      ['pnpm', 'pnpm', ['exec', 'ghuri', 'mcp']],
      ['bun', 'bunx', ['ghuri', 'mcp']],
      ['yarn', 'yarn', ['ghuri', 'mcp']],
    ] as const
    for (const [pm, command, args] of cases) {
      const r = startProject({ name: 'x', cwd: tmpDir('sp'), pm })
      expect(JSON.parse(read(r.directory, '.mcp.json')).mcpServers.ghuri, pm).toEqual({ command, args })
    }
  })

  it('adapts AGENTS.md to Node (sqlite) and GraphQL projects', () => {
    const lite = startProject({ name: 'lite', cwd: tmpDir('sp'), db: 'sqlite', pm: 'pnpm' })
    const agents = read(lite.directory, 'AGENTS.md')
    expect(agents).toContain('running here on Node.js')
    expect(agents).toContain('pnpm exec ghuri test')
    expect(agents).not.toContain('wrangler')
    expect(agents).not.toContain('ghuri deploy')
    noPlaceholders(lite.directory, ['AGENTS.md'])
    const gql = startProject({ name: 'gql', cwd: tmpDir('sp'), pm: 'npm', graphql: true })
    expect(read(gql.directory, 'AGENTS.md')).toContain('src/schema.ts')
  })
})

describe('startProject (postgres / sqlite)', () => {
  it('postgres uses Hyperdrive or DATABASE_URL and keeps wrangler', () => {
    const r = startProject({ name: 'pg', cwd: tmpDir('sp'), db: 'postgres', pm: 'pnpm' })
    const settings = read(r.directory, 'src/settings.ts')
    expect(settings).toContain("postgres({ hyperdrive: 'HYPERDRIVE' })")
    expect(settings).not.toContain('d1(')
    expect(read(r.directory, '.dev.vars')).toContain('DATABASE_URL=postgres://')
    expect(parseJsonc(read(r.directory, 'wrangler.jsonc')).d1_databases).toBeUndefined()
    JSON.parse(read(r.directory, 'package.json'))
    expect(r.nextSteps).toContain('pnpm exec ghuri migrate')
    noPlaceholders(r.directory, r.files)
  })

  it('sqlite is a Node project without wrangler', () => {
    const r = startProject({ name: 'lite', cwd: tmpDir('sp'), db: 'sqlite', pm: 'bun' })
    expect(r.files).not.toContain('wrangler.jsonc')
    const pkg = JSON.parse(read(r.directory, 'package.json'))
    expect(pkg.scripts.dev).toBe('ghuri runserver --node')
    expect(pkg.scripts.deploy).toBeUndefined()
    expect(pkg.dependencies['better-sqlite3']).toBeTruthy()
    expect(pkg.devDependencies.wrangler).toBeUndefined()
    const settings = read(r.directory, 'src/settings.ts')
    expect(settings).toContain("import { sqlite } from '@ghuri/orm/sqlite'")
    expect(settings).toContain('fileSystemStorage(')
    expect(JSON.parse(read(r.directory, 'tsconfig.json')).compilerOptions.types).toEqual(['node'])
    noPlaceholders(r.directory, r.files)
  })
})

describe('startProject --graphql', () => {
  it('adds @ghuri/graphql, GraphQLConfig, src/schema.ts and the /graphql/ route', () => {
    const r = startProject({ name: 'gql', cwd: tmpDir('sp'), db: 'd1', pm: 'npm', graphql: true })
    expect(r.graphql).toBe(true)
    expect(r.files).toContain('src/schema.ts')
    const pkg = JSON.parse(read(r.directory, 'package.json'))
    expect(pkg.dependencies['@ghuri/graphql']).toBeTruthy()
    expect(pkg.dependencies.graphql).toBeTruthy()
    const settings = read(r.directory, 'src/settings.ts')
    expect(settings).toContain("import { GraphQLConfig } from '@ghuri/graphql'")
    expect(settings).toMatch(/AdminConfig,\n {4}RestFrameworkConfig,\n {4}GraphQLConfig,\n {2}\]/)
    expect(settings).toContain('SCHEMA: schema')
    expect(read(r.directory, 'src/urls.ts')).toContain(
      "path('graphql/', GraphQLView.asView(), { name: 'graphql' })",
    )
    expect(read(r.directory, 'src/schema.ts')).toContain("'Hello from gql!'")
    expect(read(r.directory, 'README.md')).toContain('GraphQL at /graphql/')
    noPlaceholders(r.directory, r.files)
  })

  it('is off by default: no GraphQL dependency, files or settings', () => {
    const r = startProject({ name: 'plain', cwd: tmpDir('sp'), pm: 'npm' })
    expect(r.graphql).toBe(false)
    expect(r.files).not.toContain('src/schema.ts')
    expect(JSON.parse(read(r.directory, 'package.json')).dependencies['@ghuri/graphql']).toBeUndefined()
    expect(read(r.directory, 'src/settings.ts')).not.toContain('graphql')
    expect(read(r.directory, 'src/urls.ts')).not.toContain('graphql')
  })

  it('ghuri startproject --graphql', async () => {
    const cwd = tmpDir('sp')
    const { code } = await run(['startproject', 'site', '--graphql', '--no-install'], { cwd })
    expect(code).toBe(0)
    expect(existsSync(join(cwd, 'site', 'src', 'schema.ts'))).toBe(true)
  })
})

describe('startProject errors', () => {
  it('rejects invalid names, unknown databases and non-empty directories', () => {
    const cwd = tmpDir('sp')
    expect(() => startProject({ name: '1bad', cwd })).toThrow(/not a valid project name/)
    expect(() => startProject({ name: 'ok', cwd, db: 'mongo' as any })).toThrow(/--db must be one of/)
    mkdirSync(join(cwd, 'taken'))
    writeFileSync(join(cwd, 'taken', 'x'), '')
    expect(() => startProject({ name: 'taken', cwd })).toThrow(/not empty/)
  })

  it('generates long random secret keys', () => {
    const a = generateSecretKey()
    expect(a).toHaveLength(64)
    expect(a).not.toBe(generateSecretKey())
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('ghuri startproject', () => {
  it('creates the project and installs with the chosen package manager', async () => {
    const cwd = tmpDir('sp')
    const calls: Array<[string, string[], string]> = []
    const { code, out } = await run(['startproject', 'shop', '--pm', 'pnpm', '--db', 'postgres'], {
      cwd,
      spawn: async (cmd, args, o) => {
        calls.push([cmd, args, o.cwd])
        return 0
      },
    })
    expect(code).toBe(0)
    expect(calls).toEqual([['pnpm', ['install'], join(cwd, 'shop')]])
    expect(out).toContain("Created Ghuri project 'shop'")
    expect(out).toContain('pnpm exec ghuri createsuperuser')
    expect(out).not.toContain('  pnpm install\n')
  })

  it('--no-install skips installation and works with a target directory', async () => {
    const cwd = tmpDir('sp')
    const { code, out } = await run(['startproject', 'blog', 'site-dir', '--no-install'], {
      cwd,
      spawn: async () => {
        throw new Error('should not spawn')
      },
    })
    expect(code).toBe(0)
    expect(existsSync(join(cwd, 'site-dir', 'wrangler.jsonc'))).toBe(true)
    expect(out).toContain('cd site-dir')
    expect(out).toContain('npm install')
  })

  it('fails cleanly without a name', async () => {
    const { code, err } = await run(['startproject'], { cwd: tmpDir('sp') })
    expect(code).toBe(2)
    expect(err).toContain('the following arguments are required: name')
  })
})
