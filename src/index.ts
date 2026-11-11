// @ghuri/cli — the `ghuri` command (Django's django-admin / manage.py). See ARCHITECTURE.md §11.
export {
  type CommandSpec,
  camelCase,
  type ParsedOption,
  parseArgv,
  parseOptionFlags,
  specFromParser,
  UsageError,
} from './argv'
export { printHelp, runCli, splitArgv } from './cli'
export * from './commands/index'
export type {
  BuiltinCommandClass,
  CliContext,
  CommandEntry,
  GlobalOptions,
  RunCliOptions,
  SpawnFn,
} from './context'
export { DEFAULT_ORM_COMMANDS, registerModuleCommands } from './discovery'
export { loadEnvFiles, parseDotenv } from './dotenv'
export { commandSpec, formatCommandHelp, formatMainHelp, GLOBAL_OPTIONS } from './help'
export { type CliIO, createIO } from './io'
export { cliVersion, findProjectRoot, TEMPLATES_DIR } from './paths'
export {
  loadProject,
  locateProject,
  type Project,
  ProjectError,
  type ProjectOptions,
  parseJsonc,
  writeRemoteConfig,
} from './project'
export { renderString, renderTemplate, TemplateError } from './render'
export {
  COMPATIBILITY_DATE,
  DATABASES,
  type DatabaseChoice,
  detectPackageManager,
  generateSecretKey,
  nextStepsFor,
  PACKAGE_MANAGERS,
  type PackageManager,
  pmCommands,
  registerApp,
  ScaffoldError,
  type StartAppOptions,
  type StartAppResult,
  type StartProjectOptions,
  type StartProjectResult,
  startApp,
  startProject,
} from './scaffold'
