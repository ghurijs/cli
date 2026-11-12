import { defineSettings, include, path } from '@ghuri/core'
import { sqlite } from '@ghuri/orm/sqlite'
import { DefaultRouter, SchemaView } from '@ghuri/rest'
import type { Context } from 'hono'
import { LibraryConfig } from './library/app'
import { AuthorViewSet, BookViewSet } from './library/views'

const router = new DefaultRouter()
router.register('books', BookViewSet)
router.register('authors', AuthorViewSet)

const home = (c: Context) => c.text('home')

export default defineSettings((env) => ({
  SECRET_KEY: 'fixture-secret-key',
  DEBUG: true,
  INSTALLED_APPS: [LibraryConfig],
  ROOT_URLCONF: [
    path('', home, { name: 'home' }),
    path('api/schema/', SchemaView.asView({ title: 'Library API', version: '2.0.0' }), { name: 'schema' }),
    path('api/', include(router.urls)),
  ],
  DATABASES: { default: sqlite({ filename: env.SQLITE_FILE ?? 'db.sqlite3' }) },
}))
