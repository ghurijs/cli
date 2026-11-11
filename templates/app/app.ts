import { AppConfig } from '@ghuri/core'
import * as admin from './admin'
import * as migrations from './migrations'
import * as models from './models'

export class {{className}} extends AppConfig {
  name = '{{name}}'
  verboseName = '{{verboseName}}'
  path = import.meta.dirname
  models = models
  migrations = migrations
  admin = admin
}
