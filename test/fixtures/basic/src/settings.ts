import { AppConfig, defineSettings, path } from '@ghuri/core'
import type { Context } from 'hono'
import { HelloCommand } from './commands'

export class DemoConfig extends AppConfig {
  name = 'demo'
  path = import.meta.dirname
  commands = { hello: HelloCommand }
}

const home = (c: Context) => c.text('home')
const item = (c: Context) => c.text('item')

export default defineSettings((env) => ({
  SECRET_KEY: env.SECRET_KEY,
  DEBUG: env.DEBUG === 'true',
  INSTALLED_APPS: [DemoConfig],
  ROOT_URLCONF: [
    path('', home, { name: 'home' }),
    path('items/<int:id>/', item, { name: 'item-detail', methods: ['GET'] }),
  ],
  FIXTURE_VALUE: env.FROM_DEV_VARS,
  HAS_DB_BINDING: !!env.DB,
}))
