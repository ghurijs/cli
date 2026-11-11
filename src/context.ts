import type { BaseCommand, CommandClass, GhuriContext } from '@ghuri/core'
import type { CliIO } from './io'
import type { ProjectRoot } from './paths'
import type { Project, ProjectOptions } from './project'

/** Global options accepted by every command (Django: --settings, --traceback, --no-color …). */
export interface GlobalOptions {
  settings?: string
  env?: string
  remote?: boolean
  persistTo?: string
  traceback?: boolean
  noColor?: boolean
  help?: boolean
  version?: boolean
}

export interface RunCliOptions {
  /** Working directory (default `process.cwd()`). */
  cwd?: string
  /** Output sinks (default: process.stdout / process.stderr). */
  stdout?: (s: string) => void
  stderr?: (s: string) => void
  stdin?: NodeJS.ReadableStream
  /** Force prompts on/off (default: stdin and stdout are TTYs). */
  interactive?: boolean
  /** Force ANSI colors on/off. */
  color?: boolean
  /** Base environment for the project (default `process.env`). */
  env?: Record<string, string | undefined>
  /** Module that provides ORM commands (default `@ghuri/orm/commands`). */
  ormCommandsModule?: string
  /** Tests: replace wrangler's getPlatformProxy. */
  getPlatformProxy?: ProjectOptions['getPlatformProxy']
  /** Tests: replace child-process spawning (wrangler, vitest, package managers). */
  spawn?: SpawnFn
}

export type SpawnFn = (
  command: string,
  args: string[],
  opts: { cwd: string; env?: Record<string, string | undefined> },
) => Promise<number>

export type CommandSource = string

export interface CommandEntry {
  name: string
  cls: CommandClass | BuiltinCommandClass
  /** Group shown in `ghuri help`: 'ghuri', 'orm', an app label, or 'other'. */
  source: CommandSource
  builtin: boolean
}

/** What built-in commands get from the CLI. */
export interface CliContext {
  cwd: string
  io: CliIO
  globals: GlobalOptions
  options: RunCliOptions
  /** Find the project root (no settings import). Throws outside a project. */
  root(): ProjectRoot
  /** Load settings + env (bindings) — cached. */
  loadProject(extra?: Partial<ProjectOptions>): Promise<Project>
  /** Load the project and run `createApp(settings).setup(env)`. */
  setup(): Promise<{ project: Project; ctx: GhuriContext }>
  /** All known commands (after discovery). */
  commands(): Promise<CommandEntry[]>
  spawn: SpawnFn
  /** Run another ghuri command in a child process (fresh bindings, e.g. `migrate --remote`). */
  runSelf(args: string[]): Promise<number>
}

export type ProjectLevel = 'none' | 'root' | 'setup'

export type BuiltinCommandClass = (new (
  cli: CliContext,
) => BaseCommand) & {
  help?: string
  /** 'none': works anywhere; 'root': needs a project directory; 'setup': needs apps populated. */
  project?: ProjectLevel
  /** Unknown options / extra arguments are collected into `args._` (forwarded to wrangler/vitest). */
  passthrough?: boolean
}
