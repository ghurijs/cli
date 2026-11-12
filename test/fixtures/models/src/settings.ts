import { CommonMiddleware, defineSettings, path } from '@ghuri/core'
import { sqlite } from '@ghuri/orm/sqlite'
import type { Context } from 'hono'
import { ShopConfig } from './shop/app'

// Noise on stdout while the project loads: `ghuri mcp` must keep it off the protocol stream.
console.log('settings: loading the models fixture')
process.stdout.write('raw stdout noise from settings\n')

const home = (c: Context) => c.text('home')
const productDetail = (c: Context) => c.text('product')

export default defineSettings((env) => ({
  SECRET_KEY: 'fixture-secret-key-do-not-leak',
  DEBUG: true,
  INSTALLED_APPS: [ShopConfig],
  MIDDLEWARE: [CommonMiddleware],
  ROOT_URLCONF: [
    path('', home, { name: 'home' }),
    path('products/<int:id>/', productDetail, { name: 'product-detail', methods: ['GET'] }),
  ],
  DATABASES: { default: sqlite({ filename: env.SQLITE_FILE ?? 'db.sqlite3' }) },
  PAYMENTS: { PROVIDER_URL: 'https://merchant:hunter2@pay.example.com/v1', API_KEY: 'sk_live_fixture' },
  TIME_ZONE: 'UTC',
}))
