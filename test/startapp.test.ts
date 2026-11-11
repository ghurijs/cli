import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { registerApp, startApp, startProject } from '../src/scaffold'
import { cleanTmp, run, tmpDir } from './helpers'

afterAll(cleanTmp)

const APP_FILES = [
  'admin.ts',
  'app.ts',
  'migrations/index.ts',
  'models.ts',
  'serializers.ts',
  'tests.ts',
  'urls.ts',
  'views.ts',
]

describe('startApp', () => {
  it('creates src/<name> and registers the AppConfig in settings.ts', () => {
    const project = startProject({ name: 'site', cwd: tmpDir('sa'), pm: 'npm' }).directory
    const r = startApp({ name: 'blog_posts', cwd: join(project, 'src') })
    expect(r.directory).toBe(join(project, 'src', 'blog_posts'))
    expect(r.files.sort()).toEqual(APP_FILES)
    for (const f of APP_FILES) {
      const content = readFileSync(join(r.directory, f), 'utf8')
      expect(content, f).not.toContain('{{')
    }
    const app = readFileSync(join(r.directory, 'app.ts'), 'utf8')
    expect(app).toContain('export class BlogPostsConfig extends AppConfig')
    expect(app).toContain("name = 'blog_posts'")
    expect(app).toContain('path = import.meta.dirname')
    expect(app).toContain('migrations = migrations')
    expect(r.registered).toBe(true)
    const settings = readFileSync(join(project, 'src/settings.ts'), 'utf8')
    expect(settings).toContain("import { BlogPostsConfig } from './blog_posts/app'")
    expect(settings).toMatch(/AdminConfig,\n {4}BlogPostsConfig,\n {2}\]/)
    expect(readFileSync(join(r.directory, 'urls.ts'), 'utf8')).toContain("patterns('blog_posts', [")
  })

  it('works outside a configured project and does not register', () => {
    const cwd = tmpDir('sa')
    const r = startApp({ name: 'shop', cwd })
    expect(r.registered).toBe(false)
    expect(existsSync(join(cwd, 'shop/app.ts'))).toBe(true)
    expect(r.importLine).toBe("import { ShopConfig } from './shop/app'")
  })

  it('rejects bad and reserved names', () => {
    expect(() => startApp({ name: 'Blog', cwd: tmpDir('sa') })).toThrow(/not a valid app name/)
    expect(() => startApp({ name: 'auth', cwd: tmpDir('sa') })).toThrow(/conflicts/)
  })
})

describe('registerApp', () => {
  const imp = "import { BlogConfig } from './blog/app'"

  it('appends to multi-line lists and adds the import after the last import', () => {
    const src =
      "import { a } from 'a'\nimport {\n  b,\n} from 'b'\n\nexport default defineSettings(() => ({\n  INSTALLED_APPS: [\n    AuthConfig,\n    AdminConfig\n  ],\n}))\n"
    const out = registerApp(src, 'BlogConfig', imp)!
    expect(out).toContain("} from 'b'\nimport { BlogConfig } from './blog/app'\n")
    expect(out).toContain('    AdminConfig,\n    BlogConfig,\n  ],')
    expect(registerApp(out, 'BlogConfig', imp)).toBe(out)
  })

  it('handles single-line and empty lists', () => {
    expect(registerApp('INSTALLED_APPS: [AuthConfig]', 'BlogConfig', imp)).toBe(
      `${imp}\nINSTALLED_APPS: [AuthConfig, BlogConfig]`,
    )
    expect(registerApp("import x from 'x'\nconst s = { INSTALLED_APPS: [] }", 'BlogConfig', imp)).toBe(
      `import x from 'x'\n${imp}\nconst s = { INSTALLED_APPS: [BlogConfig] }`,
    )
    expect(registerApp('no apps here', 'BlogConfig', imp)).toBeNull()
  })
})

describe('ghuri startapp', () => {
  it('creates the app from inside the project and reports registration', async () => {
    const project = startProject({ name: 'site', cwd: tmpDir('sa') }).directory
    const { code, out } = await run(['startapp', 'blog'], { cwd: project })
    expect(code).toBe(0)
    expect(out).toContain("Created app 'blog'")
    expect(out).toContain('Added BlogConfig to INSTALLED_APPS')
    expect(out).toContain("path('blog/', include(blogUrls))")
    const again = await run(['startapp', 'blog'], { cwd: project })
    expect(again.code).toBe(1)
    expect(again.err).toContain('already exists')
  })

  it('--no-register prints manual instructions', async () => {
    const project = startProject({ name: 'site', cwd: tmpDir('sa') }).directory
    const { code, out } = await run(['startapp', 'shop', '--no-register'], { cwd: project })
    expect(code).toBe(0)
    expect(out).toContain("import { ShopConfig } from './shop/app'")
    expect(readFileSync(join(project, 'src/settings.ts'), 'utf8')).not.toContain('ShopConfig')
  })
})
