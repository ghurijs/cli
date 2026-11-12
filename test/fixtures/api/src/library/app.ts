import { AppConfig } from '@ghuri/core'
import * as models from './models'

export class LibraryConfig extends AppConfig {
  name = 'library'
  path = import.meta.dirname
  models = models
}
