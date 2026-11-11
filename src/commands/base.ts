import { BaseCommand } from '@ghuri/core'
import type { CliContext, ProjectLevel } from '../context'

/** Base class for the CLI's built-in commands: they receive the CLI context. */
export abstract class BuiltinCommand extends BaseCommand {
  /** 'none': works anywhere; 'root': needs a project directory; 'setup': needs apps populated. */
  static project: ProjectLevel = 'none'
  /** Forward unknown options / extra arguments in `args._`. */
  static passthrough = false

  constructor(protected readonly cli: CliContext) {
    super()
  }
}

export { CommandError } from '@ghuri/core'
