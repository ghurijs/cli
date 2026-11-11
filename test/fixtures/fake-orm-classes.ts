// An ORM-commands style module without registerOrmCommands(): classes are discovered by name.
import { BaseCommand, type CommandIO } from '@ghuri/core'

export class SqlFlushCommand extends BaseCommand {
  static help = 'Prints the SQL for flush.'
  async handle(_args: Record<string, unknown>, io: CommandIO): Promise<void> {
    io.stdout('DELETE FROM ...')
  }
}

export class CopyDataCommand extends BaseCommand {
  static commandName = 'copydata'
  static help = 'Copies data between databases.'
  async handle(_args: Record<string, unknown>, io: CommandIO): Promise<void> {
    io.stdout('copied')
  }
}
