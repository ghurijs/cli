import { AppConfig, BaseCommand, type CommandIO } from '@ghuri/core'
import * as models from './models'

export class NoisyCommand extends BaseCommand {
  static help = 'Prints to stdout and stderr.'
  async handle(_args: Record<string, unknown>, io: CommandIO): Promise<number> {
    console.log('console.log from noisy')
    io.stdout('noisy stdout')
    io.stderr('noisy stderr')
    return 0
  }
}

export class ShopConfig extends AppConfig {
  name = 'shop'
  verboseName = 'Shop'
  path = import.meta.dirname
  models = models
  commands = { noisy: NoisyCommand }
}
