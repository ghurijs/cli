import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findPackageDir } from '../src/paths'
import { startApp, startProject } from '../src/scaffold'
import { cleanTmp, tmpDir } from './helpers'

afterAll(cleanTmp)

/** The commented example code of a template file (after its leading prose comment). */
function uncomment(src: string): string {
  const lines = src.split('\n')
  const start = lines.findIndex((l) => l.startsWith('// import '))
  return lines
    .slice(start)
    .map((l) => l.replace(/^\/\/ ?/, ''))
    .join('\n')
}

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

/** Strict: every `@ghuri/*` import resolves to the real packages of the workspace and must typecheck. */
describe('generated code typechecks (tsc --noEmit)', () => {
  for (const db of ['d1', 'sqlite'] as const) {
    it(`startproject --db ${db} + startapp blog`, () => {
      const dir = startProject({ name: 'site', cwd: tmpDir(`tsc-${db}`), db }).directory
      startApp({ name: 'blog', cwd: dir })
      const errors = tsc(dir)
      expect(errors).toEqual([])
    })
  }

  it('startproject --graphql + startapp blog with its schema.ts uncommented', () => {
    const dir = startProject({ name: 'site', cwd: tmpDir('tsc-graphql'), db: 'd1', graphql: true }).directory
    startApp({ name: 'blog', cwd: dir })
    const app = join(dir, 'src', 'blog')
    writeFileSync(
      join(app, 'models.ts'),
      `import { CharField, DateTimeField, type Manager, Model, TextField } from '@ghuri/orm'
export class Post extends Model({
  title: new CharField({ maxLength: 200 }),
  body: new TextField({ blank: true }),
  createdAt: new DateTimeField({ autoNowAdd: true }),
}) {
  declare static objects: Manager<Post>
}
`,
    )
    writeFileSync(
      join(app, 'serializers.ts'),
      uncomment(readFileSync(join(app, 'serializers.ts'), 'utf8')).replace('export {}\n', ''),
    )
    writeFileSync(join(app, 'schema.ts'), uncomment(readFileSync(join(app, 'schema.ts'), 'utf8')))
    const schema = join(dir, 'src', 'schema.ts')
    writeFileSync(
      schema,
      readFileSync(schema, 'utf8')
        .replace(
          "from '@ghuri/graphql'",
          "from '@ghuri/graphql'\nimport { BlogMutation, BlogQuery } from './blog/schema'",
        )
        .replace('query: [ProjectQuery]', 'query: [ProjectQuery, BlogQuery], mutation: [BlogMutation]'),
    )
    expect(readFileSync(schema, 'utf8')).toContain('BlogQuery]')
    expect(tsc(dir)).toEqual([])
  })

  it('uncommented app code with decorators (@admin.register, @display, @action) typechecks', () => {
    const dir = startProject({ name: 'site', cwd: tmpDir('tsc-decorators'), db: 'd1' }).directory
    startApp({ name: 'blog', cwd: dir })
    const app = join(dir, 'src', 'blog')
    writeFileSync(
      join(app, 'models.ts'),
      `import { CharField, DateTimeField, type Manager, Model, TextField } from '@ghuri/orm'
export class Post extends Model({
  title: new CharField({ maxLength: 200 }),
  body: new TextField({ blank: true }),
  createdAt: new DateTimeField({ autoNowAdd: true }),
}) {
  declare static objects: Manager<Post>
  static Meta = { ordering: ['-createdAt'] }
  toString() {
    return this.title
  }
}
`,
    )
    writeFileSync(
      join(app, 'admin.ts'),
      `import { admin, display, ModelAdmin } from '@ghuri/admin'
import { Post } from './models'

@admin.register(Post)
export class PostAdmin extends ModelAdmin<Post> {
  listDisplay = ['title', 'length', 'createdAt']
  searchFields = ['title', 'body']

  @display({ description: 'Length' })
  length(post: Post) {
    return post.body.length
  }
}
`,
    )
    writeFileSync(
      join(app, 'views.ts'),
      `import type { Context } from 'hono'
import { type APIRequest, action, IsAuthenticatedOrReadOnly, ModelSerializer, ModelViewSet } from '@ghuri/rest'
import { Post } from './models'

export function index(c: Context) {
  return c.json({ app: 'blog' })
}

class PostSerializer extends ModelSerializer<Post> {
  static Meta = { model: Post, fields: ['id', 'title', 'body', 'createdAt'] }
}

export class PostViewSet extends ModelViewSet<Post> {
  queryset = Post.objects.all()
  serializerClass = PostSerializer
  permissionClasses = [IsAuthenticatedOrReadOnly]

  @action({ detail: false })
  async recent(_request: APIRequest) {
    return this.getSerializer({ instance: await this.getQueryset().slice(0, 5), many: true }).getData()
  }
}
`,
    )
    expect(tsc(dir)).toEqual([])
  })
})
