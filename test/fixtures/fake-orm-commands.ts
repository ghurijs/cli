// Mimics @ghuri/orm/commands: exports command classes and registerOrmCommands().
import {
  type ArgumentParser,
  BaseCommand,
  type CommandIO,
  type CommandRegistry,
  commandRegistry,
} from '@ghuri/core'

export class FakeMigrateCommand extends BaseCommand {
  static help = 'Pretends to apply migrations.'
  addArguments(parser: ArgumentParser): void {
    parser
      .argument('app', { help: 'App label.' })
      .option('--database <alias>', { help: 'Database alias.', default: 'default' })
  }
  async handle(args: Record<string, unknown>, io: CommandIO): Promise<void> {
    io.stdout(`migrating ${args.app ?? 'all'} on ${args.database}`)
  }
}

export class ShowFakeMigrationsCommand extends BaseCommand {
  static help = 'Lists fake migrations.'
  async handle(_args: Record<string, unknown>, io: CommandIO): Promise<void> {
    io.stdout('[X] 0001_initial')
  }
}

export function registerOrmCommands(registry: CommandRegistry = commandRegistry): void {
  registry.register('fakemigrate', FakeMigrateCommand)
  registry.register('showfakemigrations', ShowFakeMigrationsCommand)
  registry.register('importmigration', ImportMigrationCommand)
}

// Like @ghuri/orm/commands: the CLI installs its TypeScript loader for migration files.
let importer: ((file: string) => Promise<unknown>) | undefined
export function setMigrationImporter(fn: (file: string) => Promise<unknown>): void {
  importer = fn
}

export class ImportMigrationCommand extends BaseCommand {
  static help = 'Imports a migration file with the installed importer.'
  addArguments(parser: ArgumentParser): void {
    parser.argument('file', { help: 'File.', required: true })
  }
  async handle(args: Record<string, unknown>, io: CommandIO): Promise<void> {
    if (!importer) throw new Error('no migration importer installed')
    const mod = (await importer(String(args.file))) as { default: { name: string } }
    io.stdout(`imported ${mod.default.name}`)
  }
}
