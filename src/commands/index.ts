import type { BuiltinCommandClass } from '../context'
import { McpCommand } from './mcp'
import {
  CheckCommand,
  DiffSettingsCommand,
  HelpCommand,
  RoutesCommand,
  ShellCommand,
  VersionCommand,
} from './project'
import { StartAppCommand, StartProjectCommand } from './scaffold'
import { DeployCommand, RunServerCommand, TestCommand } from './server'

export { BuiltinCommand } from './base'
export { McpCommand } from './mcp'
export * from './project'
export * from './scaffold'
export * from './server'

/** Built-in commands (group "ghuri" in `ghuri help`). */
export const BUILTIN_COMMANDS: Record<string, BuiltinCommandClass> = {
  check: CheckCommand,
  deploy: DeployCommand,
  diffsettings: DiffSettingsCommand,
  help: HelpCommand,
  mcp: McpCommand,
  routes: RoutesCommand,
  runserver: RunServerCommand,
  shell: ShellCommand,
  show_urls: RoutesCommand,
  startapp: StartAppCommand,
  startproject: StartProjectCommand,
  test: TestCommand,
  version: VersionCommand,
}
