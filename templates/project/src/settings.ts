// Project settings (Django's settings.py). `env` holds Worker bindings and vars (wrangler.jsonc,
// .dev.vars) on Cloudflare, or process.env on Node. Never read env.DB / env.MEDIA in app code:
// databases, storage and caches are configured here so the project stays portable.
import { AdminConfig } from '@ghuri/admin'
import { AuthConfig, AuthenticationMiddleware, SessionMiddleware } from '@ghuri/auth'
import { SessionAuthentication, TokenAuthentication } from '@ghuri/auth/rest'
import {
  CommonMiddleware,
  CsrfMiddleware,
  defineSettings,
  kvCache,
  memoryCache,
  SecurityMiddleware,
  XFrameOptionsMiddleware,
} from '@ghuri/core'
{{#if d1}}
import { d1, postgres } from '@ghuri/orm'
{{else}}
import { postgres } from '@ghuri/orm'
{{/if}}
{{#if sqlite}}
import { sqlite } from '@ghuri/orm/sqlite'
{{/if}}
import { IsAuthenticatedOrReadOnly, PageNumberPagination } from '@ghuri/rest'
{{#if cloudflare}}
import { r2 } from '@ghuri/storage'
{{else}}
import { fileSystemStorage } from '@ghuri/storage/fs'
{{/if}}
import { urlpatterns } from './urls'

export default defineSettings((env) => ({
  SECRET_KEY: env.SECRET_KEY,
  DEBUG: env.DEBUG === 'true',
  ALLOWED_HOSTS: env.ALLOWED_HOSTS ? String(env.ALLOWED_HOSTS).split(',') : ['*'],

  INSTALLED_APPS: [
    AuthConfig,
    AdminConfig,
  ],

  MIDDLEWARE: [
    SecurityMiddleware,
    CommonMiddleware,
    SessionMiddleware,
    CsrfMiddleware,
    AuthenticationMiddleware,
    XFrameOptionsMiddleware,
  ],

  ROOT_URLCONF: urlpatterns,

  DATABASES: {
{{#if d1}}
    // D1 on Cloudflare (binding "DB" in wrangler.jsonc). Set DATABASE_URL to use Postgres instead —
    // e.g. on Node / a VPS. Move data with `ghuri dumpdata` / `ghuri loaddata` (or `ghuri copydata`).
    default: env.DATABASE_URL ? postgres({ url: env.DATABASE_URL }) : d1('DB'),
{{/if}}
{{#if postgres}}
    // Postgres through Hyperdrive on Cloudflare, or DATABASE_URL directly (local dev, Node / VPS).
    default: env.HYPERDRIVE ? postgres({ hyperdrive: 'HYPERDRIVE' }) : postgres({ url: env.DATABASE_URL }),
{{/if}}
{{#if sqlite}}
    // SQLite file on Node (better-sqlite3). Set DATABASE_URL to use Postgres instead.
    default: env.DATABASE_URL
      ? postgres({ url: env.DATABASE_URL })
      : sqlite({ filename: env.DATABASE_PATH ?? 'db.sqlite3' }),
{{/if}}
  },

  STORAGES: {
{{#if cloudflare}}
    // R2 bucket (binding "MEDIA" in wrangler.jsonc). Use s3({ ... }) from '@ghuri/storage' elsewhere.
    default: r2('MEDIA'),
{{else}}
    // Files on the local disk. Use s3({ ... }) from '@ghuri/storage' for S3 / R2 / MinIO.
    default: fileSystemStorage({ location: 'media', baseUrl: '/media/' }),
{{/if}}
  },
  MEDIA_URL: '/media/',

  CACHES: {
    // Workers KV when the CACHE binding exists, otherwise an in-memory cache.
    default: env.CACHE ? kvCache('CACHE') : memoryCache(),
  },

  AUTH_USER_MODEL: 'auth.User',

  REST_FRAMEWORK: {
    DEFAULT_AUTHENTICATION_CLASSES: [SessionAuthentication, TokenAuthentication],
    DEFAULT_PERMISSION_CLASSES: [IsAuthenticatedOrReadOnly],
    DEFAULT_PAGINATION_CLASS: PageNumberPagination,
    PAGE_SIZE: 20,
  },

  TIME_ZONE: 'UTC',
  USE_TZ: true,
}))
