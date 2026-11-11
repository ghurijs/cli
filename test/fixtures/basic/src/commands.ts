import { type ArgumentParser, BaseCommand, type CommandIO, getEnv } from '@ghuri/core'

export class HelloCommand extends BaseCommand {
  static help = 'Says hello from the fixture app.'

  addArguments(parser: ArgumentParser): void {
    parser
      .argument('name', { help: 'Who to greet.', required: true })
      .argument('extra', { help: 'More names.', variadic: true })
      .option('--shout', { help: 'Uppercase.' })
      .option('-n, --times <n>', { help: 'Repeat.', default: 1 })
      .option('--no-input', { help: 'Never prompt.' })
  }

  async handle(args: Record<string, unknown>, io: CommandIO): Promise<number> {
    const greeting = `hello ${args.name}`
    for (let i = 0; i < Number(args.times); i++) io.stdout(args.shout ? greeting.toUpperCase() : greeting)
    io.stdout(`ARGS ${JSON.stringify(args)}`)
    io.stdout(`ENV ${getEnv().FROM_DEV_VARS} ${getEnv().FROM_DOTENV}`)
    return args.name === 'fail' ? 3 : 0
  }
}
