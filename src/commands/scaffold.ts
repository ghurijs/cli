import type { ArgumentParser, CommandIO } from '@ghuri/core'
import {
  DATABASES,
  type DatabaseChoice,
  detectPackageManager,
  nextStepsFor,
  PACKAGE_MANAGERS,
  type PackageManager,
  pmCommands,
  startApp,
  startProject,
} from '../scaffold'
import { BuiltinCommand } from './base'

export class StartProjectCommand extends BuiltinCommand {
  static help = 'Creates a new Ghuri project. The project is created in ./<name> or in the given directory.'

  addArguments(parser: ArgumentParser): void {
    parser
      .argument('name', { help: 'Name of the project.', required: true })
      .argument('directory', { help: 'Optional destination directory (default: ./<name>).' })
      .option('--db <database>', {
        help: `Database: ${DATABASES.join(' | ')} (d1 = Cloudflare D1, postgres = Hyperdrive/DATABASE_URL, sqlite = Node).`,
        default: 'd1',
      })
      .option('--pm <manager>', {
        help: `Package manager: ${PACKAGE_MANAGERS.join(' | ')} (default: the one running this command, else npm).`,
      })
      .option('--no-install', { help: "Don't install dependencies." })
  }

  async handle(args: Record<string, unknown>, io: CommandIO): Promise<number> {
    const pm =
      (args.pm as PackageManager | undefined) ?? detectPackageManager(this.cli.options.env ?? process.env)
    const result = startProject({
      name: String(args.name),
      directory: args.directory as string | undefined,
      cwd: this.cli.cwd,
      db: args.db as DatabaseChoice,
      pm,
    })
    io.stdout(io.style.success(`Created Ghuri project '${args.name}' in ${result.directory}`))
    for (const f of result.files) io.stdout(`  ${f}`)
    let installed = false
    if (args.install !== false) {
      const cmd = pmCommands(pm).install.split(' ')
      io.stdout('')
      io.stdout(io.style.notice(`Installing dependencies with ${pm}…`))
      const code = await this.cli.spawn(cmd[0], cmd.slice(1), { cwd: result.directory })
      installed = code === 0
      if (!installed)
        io.stderr(io.style.warning(`'${cmd.join(' ')}' failed (exit ${code}); run it yourself.`))
    }
    const steps = nextStepsFor({
      dirLabel: result.nextSteps[0]?.startsWith('cd ') ? result.nextSteps[0].slice(3) : '.',
      db: result.db,
      pm,
      installed,
      pkgName: String(args.name).toLowerCase().replace(/_/g, '-'),
    })
    io.stdout('')
    io.stdout(io.style.bold('Next steps:'))
    for (const s of steps) io.stdout(`  ${s}`)
    return 0
  }
}

export class StartAppCommand extends BuiltinCommand {
  static help =
    'Creates a new app in src/<name>/. Its AppConfig is added to INSTALLED_APPS in the settings module.'

  addArguments(parser: ArgumentParser): void {
    parser
      .argument('name', {
        help: 'Name of the application (lowercase identifier, e.g. blog).',
        required: true,
      })
      .argument('directory', { help: 'Optional destination directory (default: src/<name>).' })
      .option('--no-register', { help: "Don't add the app to INSTALLED_APPS automatically." })
  }

  async handle(args: Record<string, unknown>, io: CommandIO): Promise<number> {
    const result = startApp({
      name: String(args.name),
      directory: args.directory as string | undefined,
      cwd: this.cli.cwd,
      register: args.register !== false,
    })
    io.stdout(io.style.success(`Created app '${args.name}' in ${result.directory}`))
    for (const f of result.files) io.stdout(`  ${f}`)
    io.stdout('')
    if (result.registered) {
      io.stdout(`Added ${io.style.bold(result.className)} to INSTALLED_APPS in ${result.settingsPath}.`)
    } else {
      io.stdout('Add the app to INSTALLED_APPS in your settings:')
      io.stdout(`  ${result.importLine}`)
      io.stdout(`  INSTALLED_APPS: [..., ${result.className}]`)
    }
    io.stdout('Route its URLs from src/urls.ts:')
    io.stdout(`  ${result.urlsHint}`)
    io.stdout('Then define models in models.ts and run: ghuri makemigrations && ghuri migrate')
    return 0
  }
}
