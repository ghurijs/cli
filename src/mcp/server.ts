// `ghuri mcp`: the development-time MCP server's tools and the child processes behind them.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { GlobalOptions } from '../context'
import { cliVersion, findPackageDir, findProjectRoot, PACKAGE_ROOT } from '../paths'
import { DOCS_URL, DocsIndex } from './docs'
import { type McpTool, ToolError, type ToolOutput } from './protocol'
import type { ModelDescription, ProjectSnapshot, WorkerOp, WorkerRequest, WorkerResponse } from './worker'

export const MCP_INSTRUCTIONS = `This server is connected to a Ghuri project. Ghuri is "Django for TypeScript": settings.ts with INSTALLED_APPS, apps with models, migrations, urls.ts, class-based views, an admin and a REST framework, built on Hono and Drizzle; it runs on Cloudflare Workers (D1/R2/KV) by default and on Node with Postgres. It is TypeScript, not Python: options and methods are camelCase (maxLength, orderBy), settings keys are UPPER_SNAKE, and database calls are async.

Use these tools to check the real project before editing code instead of guessing:
- project_info, list_apps, list_models, describe_model, list_routes and list_commands read the current project (they reload it after every file change).
- After adding or changing models, run run_command with command "makemigrations", then "migrate" (local database only), and check with show_migrations.
- run_command runs any other ghuri management command (check, test, startapp, sqlmigrate, dumpdata, app commands); runserver, shell, deploy, flush and --remote are not available here.
- search_docs and get_doc read the Ghuri documentation (https://ghurijs.github.io/docs/llms-full.txt). Only use APIs that the docs or the project's own code show exist; do not assume a Django or DRF feature exists in Ghuri.`

/** Commands an agent may not run through `run_command` (interactive, long-running, or destructive). */
export const DENIED_COMMANDS: Record<string, string> = {
  runserver: 'it starts a long-running development server; ask the user to run `npx ghuri runserver`',
  shell: 'it is an interactive REPL',
  dbshell: 'it is an interactive database shell',
  mcp: 'it is this server',
  deploy: 'it deploys to production; ask the user to run `npx ghuri deploy`',
  flush: 'it deletes every row in the database; ask the user to run it',
  startproject: 'it creates a new project; you are already inside one',
}

/** Why `run_command` refuses this invocation, or undefined when it is allowed. */
export function deniedReason(command: string, args: string[]): string | undefined {
  if (command in DENIED_COMMANDS)
    return `'${command}' is not available over MCP: ${DENIED_COMMANDS[command]}.`
  const opts = args.filter((a) => a.startsWith('-'))
  if (opts.some((a) => a === '--remote' || a.startsWith('--remote='))) {
    return '--remote is not available over MCP: it would use the production Cloudflare bindings (D1/R2/KV). Ask the user to run it.'
  }
  if (command === 'createsuperuser' && !opts.some((a) => ['--noinput', '--no-input'].includes(a))) {
    return "'createsuperuser' prompts for input; pass --no-input with --username, --email and --password, or ask the user to run it."
  }
  if (command === 'test' && opts.includes('--watch'))
    return "'test --watch' never exits; run 'test' without --watch."
  return undefined
}

export interface McpServerOptions {
  cwd: string
  globals?: Pick<GlobalOptions, 'settings' | 'env' | 'persistTo'>
  /** How to run this CLI in a child process: `[node, ...args]` (default: this ghuri, dist or src). */
  cliCommand?: string[]
  /** Base environment for child processes (default `process.env`). */
  env?: Record<string, string | undefined>
  docsUrl?: string
  fetch?: typeof fetch
  /** Diagnostics (default: stderr). */
  log?: (s: string) => void
  workerTimeoutMs?: number
}

/** `[process.execPath, ...]` that runs this CLI: the built `dist/bin.js`, or `src/bin.ts` through jiti in tests. */
export function defaultCliCommand(): string[] {
  const self = fileURLToPath(import.meta.url)
  if (/\.ts$/.test(self)) {
    const jiti = findPackageDir('jiti', PACKAGE_ROOT)
    const register = jiti ? pathToFileURL(join(jiti, 'lib', 'jiti-register.mjs')).href : 'jiti/register'
    return [process.execPath, '--import', register, join(PACKAGE_ROOT, 'src', 'bin.ts')]
  }
  return [process.execPath, join(PACKAGE_ROOT, 'dist', 'bin.js')]
}

const MAX_STREAM = 30_000
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}]*${BEL}`, 'g')

/** Keep the head and the tail of long output. */
export function truncate(s: string, max = MAX_STREAM): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false }
  const head = Math.floor(max * 0.3)
  const tail = max - head
  const cut = s.length - head - tail
  return {
    text: `${s.slice(0, head)}\n[… ${cut} characters truncated …]\n${s.slice(-tail)}`,
    truncated: true,
  }
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage'])
/** Local databases and logs change on every query: not part of the source fingerprint. */
const DATA_FILE = /\.(sqlite3?|db|log)(-wal|-shm|-journal)?$/i

/**
 * Fingerprint of the project's source files (paths, sizes and mtimes; skips node_modules, build output and
 * dot-directories like .wrangler/.git). Undefined for very large trees (then nothing is cached).
 */
export function projectFingerprint(root: string, limit = 5000): string | undefined {
  const hash = createHash('sha1')
  let n = 0
  const walk = (dir: string): boolean => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return true
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
        if (!walk(p)) return false
      } else if (e.isFile()) {
        if (DATA_FILE.test(e.name)) continue
        if (++n > limit) return false
        try {
          const st = statSync(p)
          hash.update(`${p}\0${st.size}\0${st.mtimeMs}\n`)
        } catch {}
      }
    }
    return true
  }
  return walk(root) ? hash.digest('hex') : undefined
}

interface ProcessResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  message?: WorkerResponse
}

/** Spawn a child, collect its output (and an IPC message), with a timeout and cancellation. */
function runProcess(
  argv: string[],
  opts: {
    cwd: string
    env: Record<string, string | undefined>
    ipc?: boolean
    timeoutMs: number
    signal?: AbortSignal
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv,
      stdio: opts.ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let message: WorkerResponse | undefined
    const cap = (s: string, chunk: string) => (s.length > 2_000_000 ? s : s + chunk)
    child.stdout?.setEncoding('utf8').on('data', (c: string) => {
      stdout = cap(stdout, c)
    })
    child.stderr?.setEncoding('utf8').on('data', (c: string) => {
      stderr = cap(stderr, c)
    })
    child.on('message', (m) => {
      message = m as WorkerResponse
    })
    const kill = () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 3000).unref()
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, opts.timeoutMs)
    timer.unref()
    const onAbort = () => kill()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code, signal, stdout, stderr, timedOut, message })
    })
  })
}

function str(v: unknown, name: string, required = false): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ToolError(`Missing required argument '${name}'.`)
    return undefined
  }
  if (typeof v !== 'string') throw new ToolError(`'${name}' must be a string.`)
  return v
}

function strList(v: unknown, name: string): string[] {
  if (v === undefined || v === null) return []
  if (typeof v === 'string') return [v]
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' && typeof x !== 'number'))
    throw new ToolError(`'${name}' must be an array of strings.`)
  return v.map(String)
}

/** The project side of the MCP server: runs workers, caches the snapshot per source fingerprint. */
export class ProjectBridge {
  readonly cliCommand: string[]
  private cache?: { fingerprint: string; snapshot: Promise<ProjectSnapshot> }
  readonly docs: DocsIndex

  constructor(readonly opts: McpServerOptions) {
    this.cliCommand = opts.cliCommand ?? defaultCliCommand()
    this.docs = new DocsIndex({ url: opts.docsUrl ?? DOCS_URL, fetch: opts.fetch })
  }

  private get env(): Record<string, string | undefined> {
    return { ...(this.opts.env ?? process.env), NO_COLOR: '1', FORCE_COLOR: '0' }
  }

  /** The project root, or a tool error outside a project. */
  root(): string {
    const found = findProjectRoot(this.opts.cwd, this.opts.globals?.settings)
    if (!found) {
      throw new ToolError(
        `Not inside a Ghuri project: no package.json with a "ghuri" key or src/settings.ts in ${this.opts.cwd} or its parents. ` +
          "Start the MCP server from the project directory (npx ghuri mcp), or create a project with 'npx ghuri startproject mysite'.",
      )
    }
    return found.root
  }

  async worker(op: WorkerOp, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
    this.root()
    const req: WorkerRequest = { op, cwd: this.opts.cwd, globals: this.opts.globals, args }
    const res = await runProcess([...this.cliCommand, '__mcp-worker', JSON.stringify(req)], {
      cwd: this.opts.cwd,
      env: this.env,
      ipc: true,
      timeoutMs: this.opts.workerTimeoutMs ?? 120_000,
      signal,
    })
    const output = `${res.stdout}${res.stderr}`.replace(ANSI, '').trim()
    if (output) this.opts.log?.(`${output}\n`)
    if (res.message?.ok) return res.message.result
    if (res.message && !res.message.ok) throw new ToolError(projectErrorText(res.message.error))
    if (res.timedOut) throw new ToolError('Loading the project timed out.')
    throw new ToolError(
      `Loading the project failed (exit ${res.code ?? res.signal}).${output ? `\n${truncate(output, 4000).text}` : ''}`,
    )
  }

  /** Settings, apps, models, routes and commands: reloaded when any project source file changed. */
  snapshot(signal?: AbortSignal): Promise<ProjectSnapshot> {
    const root = this.root()
    const fingerprint = projectFingerprint(root)
    if (fingerprint && this.cache?.fingerprint === fingerprint) return this.cache.snapshot
    const snapshot = this.worker('snapshot', {}, signal) as Promise<ProjectSnapshot>
    if (fingerprint) {
      const entry = { fingerprint, snapshot }
      this.cache = entry
      snapshot.catch(() => {
        if (this.cache === entry) this.cache = undefined
      })
    }
    return snapshot
  }

  invalidate(): void {
    this.cache = undefined
  }

  async runCommand(command: string, args: string[], timeoutMs: number, signal?: AbortSignal) {
    this.root()
    const globals: string[] = []
    const has = (flag: string) => args.some((a) => a === flag || a.startsWith(`${flag}=`))
    const g = this.opts.globals ?? {}
    if (g.settings && !has('--settings')) globals.push('--settings', g.settings)
    if (g.env && !has('--env')) globals.push('--env', g.env)
    if (g.persistTo && !has('--persist-to')) globals.push('--persist-to', g.persistTo)
    const started = Date.now()
    try {
      return {
        ...(await runProcess([...this.cliCommand, command, ...args, ...globals], {
          cwd: this.opts.cwd,
          env: this.env,
          timeoutMs,
          signal,
        })),
        durationMs: Date.now() - started,
      }
    } finally {
      this.invalidate()
    }
  }
}

function projectErrorText(error: { name: string; message: string; stack?: string }): string {
  const name = error.name && !['Error', 'ProjectError'].includes(error.name) ? `${error.name}: ` : ''
  return `The project could not be loaded: ${name}${error.message}\n\nFix the error and call the tool again (the project is reloaded on every call).`
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

function modelLine(m: ModelDescription): Record<string, unknown> {
  return {
    label: m.label,
    dbTable: m.dbTable,
    fields: m.fields.map((f) => {
      const rel = f.relation as Record<string, unknown> | undefined
      return `${f.name}: ${f.type}${rel?.to ? ` → ${rel.to}` : ''}`
    }),
  }
}

function findModel(models: ModelDescription[], query: string): ModelDescription {
  const q = query.trim().toLowerCase()
  const exact = models.find((m) => m.label.toLowerCase() === q)
  if (exact) return exact
  const byName = models.filter((m) => m.name.toLowerCase() === q.split('.').pop())
  if (byName.length === 1 && !q.includes('.')) return byName[0]
  if (byName.length > 1 && !q.includes('.')) {
    throw new ToolError(
      `'${query}' is ambiguous: ${byName.map((m) => m.label).join(', ')}. Pass 'app_label.ModelName'.`,
    )
  }
  const near = models
    .filter((m) => m.label.toLowerCase().includes(q.split('.').pop() ?? q))
    .map((m) => m.label)
  throw new ToolError(
    `No model '${query}'. ${near.length ? `Did you mean ${near.join(', ')}? ` : ''}Models: ${models.map((m) => m.label).join(', ') || '(none)'}.`,
  )
}

/** The tools exposed by `ghuri mcp`. */
export function createTools(bridge: ProjectBridge): McpTool[] {
  const tools: McpTool[] = [
    {
      name: 'project_info',
      title: 'Project info',
      description:
        'Overview of the Ghuri project: root, settings module, runtime (cloudflare/node), bindings, DEBUG, INSTALLED_APPS, DATABASES (engine/name), STORAGES, CACHES, MIDDLEWARE, other settings (secrets hidden) and installed @ghuri/* package versions.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      async run(_args, { signal }) {
        return { data: (await bridge.snapshot(signal)).project }
      },
    },
    {
      name: 'list_apps',
      title: 'List apps',
      description:
        'The installed apps (INSTALLED_APPS): label, name, path, whether they live in the project or in a package, their models, commands and whether they have migrations.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      async run(_args, { signal }) {
        return { data: { apps: (await bridge.snapshot(signal)).apps } }
      },
    },
    {
      name: 'list_models',
      title: 'List models',
      description:
        "Every registered model as 'app_label.ModelName' with its table and fields ('name: FieldType → related model'). Use describe_model for options, relations and Meta.",
      inputSchema: {
        type: 'object',
        properties: { app: { type: 'string', description: 'Only models of this app label.' } },
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      async run(args, { signal }) {
        const app = str(args.app, 'app')
        const { models, apps } = await bridge.snapshot(signal)
        if (app && !apps.some((a) => a.label === app))
          throw new ToolError(`No installed app '${app}'. Apps: ${apps.map((a) => a.label).join(', ')}.`)
        return { data: { models: models.filter((m) => !app || m.app === app).map(modelLine) } }
      },
    },
    {
      name: 'describe_model',
      title: 'Describe model',
      description:
        'Full description of one model: fields with type and options (maxLength, null, blank, default, choices, unique, …), relations (target, onDelete, relatedName), reverse relations, Meta (ordering, dbTable, uniqueTogether, indexes, constraints) and managers.',
      inputSchema: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: "'app_label.ModelName' (e.g. 'blog.Post') or just 'Post' when unique.",
          },
        },
        required: ['model'],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      async run(args, { signal }) {
        const model = str(args.model, 'model', true)!
        return { data: findModel((await bridge.snapshot(signal)).models, model) }
      },
    },
    {
      name: 'list_routes',
      title: 'List routes',
      description:
        'The URL patterns of ROOT_URLCONF (like `ghuri routes`): pattern, route name, HTTP methods and view.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      async run(_args, { signal }) {
        return { data: { routes: (await bridge.snapshot(signal)).routes } }
      },
    },
    {
      name: 'list_commands',
      title: 'List commands',
      description:
        'Every management command available in this project (like `ghuri help`), grouped by source (ghuri, orm, app label). Pass `command` to get its full usage (arguments and options).',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Show the full usage of this command.' } },
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      async run(args, { signal }) {
        const name = str(args.command, 'command')
        const { commands } = await bridge.snapshot(signal)
        if (name) {
          const c = commands.find((x) => x.name === name)
          if (!c)
            throw new ToolError(`No command '${name}'. Commands: ${commands.map((x) => x.name).join(', ')}.`)
          const denied = deniedReason(c.name, [])
          return { text: `${c.usage ?? c.help}${denied ? `\n\nNote: ${denied}` : ''}` }
        }
        return {
          data: {
            commands: commands.map((c) => ({
              name: c.name,
              group: c.group,
              help: c.summary,
              ...(c.name in DENIED_COMMANDS ? { availableOverMcp: false } : {}),
            })),
          },
        }
      },
    },
    {
      name: 'show_migrations',
      title: 'Show migrations',
      description:
        'Applied and unapplied migrations per app on the local database (like `ghuri showmigrations`). Run after makemigrations / migrate to check the state.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'array', items: { type: 'string' }, description: 'Only these app labels.' },
          database: { type: 'string', description: "Database alias (default 'default')." },
        },
        additionalProperties: false,
      },
      annotations: { ...READ_ONLY, idempotentHint: true },
      async run(args, { signal }) {
        const app = strList(args.app, 'app')
        const database = str(args.database, 'database')
        return { data: await bridge.worker('show_migrations', { app, database }, signal) }
      },
    },
    {
      name: 'run_command',
      title: 'Run a ghuri command',
      description:
        'Run a ghuri management command in the project (a fresh `npx ghuri <command> <args>` process; no prompts) and return its exit code and output. E.g. check, makemigrations, migrate, showmigrations, sqlmigrate, startapp, test, dumpdata, loaddata, routes, diffsettings, createsuperuser --no-input, and app commands. Not available: runserver, shell, dbshell, deploy, flush, startproject, mcp, and --remote (no production bindings).',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: "Command name, e.g. 'makemigrations'." },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: "Arguments and options, one per item, e.g. ['blog', '--name', 'add_tags'].",
          },
          timeoutSeconds: {
            type: 'number',
            description: 'Kill the command after this many seconds (default 300, max 1800).',
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      async run(args, { signal }): Promise<ToolOutput> {
        const command = str(args.command, 'command', true)!.trim()
        const argv = strList(args.args, 'args')
        if (!/^[A-Za-z][\w:.-]*$/.test(command)) throw new ToolError(`Invalid command name '${command}'.`)
        const denied = deniedReason(command, argv)
        if (denied) throw new ToolError(denied)
        const t =
          typeof args.timeoutSeconds === 'number' && args.timeoutSeconds > 0 ? args.timeoutSeconds : 300
        const timeoutMs = Math.min(t, 1800) * 1000
        const res = await bridge.runCommand(command, argv, timeoutMs, signal)
        const out = truncate(res.stdout.replace(ANSI, ''))
        const err = truncate(res.stderr.replace(ANSI, ''))
        const exitCode = res.code ?? (res.signal ? 1 : 0)
        const status = res.timedOut ? `timed out after ${timeoutMs / 1000}s` : `exit code ${exitCode}`
        const parts = [
          `$ ghuri ${[command, ...argv].join(' ')}`,
          `(${status}, ${(res.durationMs / 1000).toFixed(1)}s)`,
        ]
        if (out.text.trim()) parts.push(`--- stdout ---\n${out.text.trimEnd()}`)
        if (err.text.trim()) parts.push(`--- stderr ---\n${err.text.trimEnd()}`)
        if (out.truncated || err.truncated)
          parts.push('(output truncated: the middle of long output is omitted)')
        return {
          text: parts.join('\n'),
          isError: exitCode !== 0 || res.timedOut,
        }
      },
    },
    {
      name: 'search_docs',
      title: 'Search the Ghuri docs',
      description:
        'Keyword search over the Ghuri documentation (llms-full.txt). Returns the best-matching sections with their page; use get_doc for a whole page.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: "Keywords, e.g. 'ForeignKey onDelete relatedName' or 'ModelViewSet router'.",
          },
          limit: { type: 'number', description: 'Number of sections (default 5, max 10).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { ...READ_ONLY, openWorldHint: true },
      async run(args) {
        const query = str(args.query, 'query', true)!
        const limit = Math.max(1, Math.min(10, typeof args.limit === 'number' ? Math.floor(args.limit) : 5))
        const hits = await bridge.docs.search(query, limit).catch(docsError)
        if (!hits.length) return { text: `No documentation sections match '${query}'. Try other keywords.` }
        return {
          text: hits
            .map((h) => {
              const body = truncate(h.text, 3000).text
              return `## ${h.page}${h.section ? ` › ${h.section}` : ''}\n(page: ${h.slug})\n\n${body}`
            })
            .join('\n\n---\n\n'),
        }
      },
    },
    {
      name: 'get_doc',
      title: 'Read a docs page',
      description:
        "One whole page of the Ghuri documentation by page slug or title as returned by search_docs (e.g. 'models-and-fields', 'Making queries') or a docs path (e.g. 'topics/migrations'). Without `path`, lists the pages.",
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Page slug, title or docs path.' },
          section: { type: 'string', description: 'Only the section with this heading.' },
        },
        additionalProperties: false,
      },
      annotations: { ...READ_ONLY, openWorldHint: true },
      async run(args) {
        const path = str(args.path, 'path')
        const pages = await bridge.docs.load().catch(docsError)
        if (!path) {
          return {
            text: pages
              .map((p) => `- ${p.slug}: ${p.title}${p.description ? ` — ${p.description}` : ''}`)
              .join('\n'),
          }
        }
        const page = await bridge.docs.get(path)
        if (!page) {
          throw new ToolError(`No docs page '${path}'. Pages: ${pages.map((p) => p.slug).join(', ')}.`)
        }
        const section = str(args.section, 'section')
        if (section) {
          const s =
            page.sections.find((x) => x.heading.toLowerCase() === section.toLowerCase()) ??
            page.sections.find((x) => x.heading.toLowerCase().includes(section.toLowerCase()))
          if (!s) {
            throw new ToolError(
              `No section '${section}' in '${page.title}'. Sections: ${page.sections
                .map((x) => x.heading)
                .filter(Boolean)
                .join(' | ')}.`,
            )
          }
          return { text: `# ${page.title} › ${s.heading}\n\n${truncate(s.text, 40_000).text}` }
        }
        const head = `# ${page.title}\n${page.description ? `\n> ${page.description}\n` : ''}`
        return { text: `${head}\n${truncate(page.text, 60_000).text}` }
      },
    },
  ]
  return tools
}

function docsError(err: unknown): never {
  throw new ToolError(String((err as Error)?.message ?? err))
}

export function serverInfo(): { name: string; version: string; title: string; instructions: string } {
  return { name: 'ghuri', title: 'Ghuri project', version: cliVersion(), instructions: MCP_INSTRUCTIONS }
}
