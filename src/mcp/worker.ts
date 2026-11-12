// Child-process side of `ghuri mcp`. Each introspection runs in a fresh `node <ghuri> __mcp-worker <json>`
// process, so edits to settings, models and urls are always picked up (no stale module or registry state),
// a broken project can't crash the server, and nothing the project prints reaches the protocol stream.
// The result goes back over the IPC channel.
import { existsSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { GhuriContext } from '@ghuri/core'
import { createCliContext } from '../cli'
import { collectRoutes } from '../commands/project'
import type { CliContext, GlobalOptions, RunCliOptions } from '../context'
import { commandSpec, formatCommandHelp, summary } from '../help'
import { cliVersion, readJson } from '../paths'
import type { Project } from '../project'
import { redact, toJson } from './json'

export type WorkerOp = 'snapshot' | 'show_migrations' | 'openapi_schema'

export interface WorkerRequest {
  op: WorkerOp
  cwd: string
  globals?: Pick<GlobalOptions, 'settings' | 'env' | 'persistTo'>
  args?: Record<string, unknown>
}

export type WorkerResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { name: string; message: string; stack?: string } }

/** Run one worker operation in this process. */
export async function runWorkerOp(req: WorkerRequest, options: RunCliOptions = {}): Promise<unknown> {
  const log = (s: string) => process.stderr.write(s)
  const cli = createCliContext(
    { ...(req.globals ?? {}) },
    { cwd: req.cwd, interactive: false, color: false, stdout: log, stderr: log, ...options },
  )
  try {
    const { project, ctx } = await cli.setup()
    if (req.op === 'snapshot') return await buildSnapshot(cli, project, ctx)
    if (req.op === 'show_migrations') return await migrationStatus(project, req.args ?? {})
    if (req.op === 'openapi_schema') return await openapiSchema(project, ctx)
    throw new Error(`Unknown worker operation '${req.op}'.`)
  } finally {
    await Promise.race([cli.dispose().catch(() => {}), new Promise((r) => setTimeout(r, 5000).unref())])
  }
}

/** Entry point: `ghuri __mcp-worker '<json request>'` (spawned by the MCP server with an IPC channel). */
export async function workerMain(argv: string[]): Promise<number> {
  // Anything printed by the project goes to stderr; the parent only reads the IPC message.
  console.log = console.error
  console.info = console.error
  let response: WorkerResponse
  try {
    const req = JSON.parse(argv[0] ?? '') as WorkerRequest
    response = { ok: true, result: toJson(await runWorkerOp(req)) }
  } catch (err) {
    const e = err as Error
    response = {
      ok: false,
      error: { name: e?.constructor?.name ?? 'Error', message: String(e?.message ?? err), stack: e?.stack },
    }
  }
  if (!process.send) {
    process.stderr.write(`${JSON.stringify(response)}\n`)
    return response.ok ? 0 : 1
  }
  await new Promise<void>((done) => process.send!(response, undefined, {}, () => done()))
  return 0
}

// ---- snapshot -----------------------------------------------------------------------------------

export interface ProjectSnapshot {
  project: Record<string, unknown>
  apps: Array<Record<string, unknown>>
  models: ModelDescription[]
  routes: Array<{ pattern: string; name: string; methods: string; view: string }>
  commands: Array<{ name: string; group: string; summary: string; help: string; usage?: string }>
}

export interface ModelDescription {
  label: string
  app: string
  name: string
  dbTable: string
  pk?: string
  fields: Array<Record<string, unknown>>
  reverseRelations: Array<Record<string, unknown>>
  meta: Record<string, unknown>
  managers: Array<{ name: string; class: string }>
}

const RELATION_KEYS = [
  'to',
  'onDelete',
  'onDeleteValue',
  'relatedName',
  'relatedQueryName',
  'through',
  'throughFields',
  'toField',
  'dbConstraint',
  'dbTable',
]

function nameOf(v: unknown): string {
  if (typeof v === 'function') return v.name || '(anonymous)'
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') return (v as any).constructor?.name ?? 'object'
  return String(v)
}

export function describeField(f: any): Record<string, unknown> {
  let decon: { type: string; options: Record<string, unknown> } = { type: f.internalType, options: {} }
  try {
    decon = f.deconstruct()
  } catch {}
  const options: Record<string, unknown> = {}
  const relation: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(decon.options ?? {})) {
    if (f.isRelation && RELATION_KEYS.includes(k)) relation[k] = v
    else options[k] = v
  }
  const out: Record<string, unknown> = { name: f.name, type: decon.type }
  if (f.concrete && f.column) out.column = f.column
  if (f.attname && f.attname !== f.name) out.attname = f.attname
  if (Object.keys(options).length) out.options = options
  if (f.isRelation) {
    if (typeof f.targetLabel === 'function') {
      try {
        relation.to = f.targetLabel()
      } catch {}
    }
    out.relation = relation
  }
  return out
}

export function describeModel(model: any): ModelDescription {
  const meta = model._meta
  const reverse: Array<Record<string, unknown>> = []
  for (const r of meta.relatedObjects ?? []) {
    let onDelete: unknown
    try {
      onDelete = r.field.deconstruct().options.onDelete
    } catch {}
    reverse.push({
      name: r.name,
      accessor: r.getAccessorName?.() ?? null,
      model: r.relatedModel._meta.label,
      field: r.field.name,
      kind: r.manyToMany ? 'many-to-many' : r.oneToOne ? 'one-to-one' : 'one-to-many',
      ...(onDelete !== undefined ? { onDelete } : {}),
    })
  }
  const metaOut: Record<string, unknown> = {
    verboseName: meta.verboseName,
    verboseNamePlural: meta.verboseNamePlural,
  }
  const add = (key: string, value: unknown) => {
    if (value === undefined || (Array.isArray(value) && !value.length)) return
    metaOut[key] = value
  }
  add('ordering', meta.ordering)
  add('uniqueTogether', meta.uniqueTogether)
  add('indexes', meta.indexes)
  add('constraints', meta.constraints)
  add('getLatestBy', meta.getLatestBy)
  add('permissions', meta.permissions)
  if (meta.abstract) metaOut.abstract = true
  if (meta.managed === false) metaOut.managed = false
  if (meta.meta?.defaultManagerName) metaOut.defaultManagerName = meta.meta.defaultManagerName
  return {
    label: meta.label,
    app: meta.appLabel,
    name: meta.objectName,
    dbTable: meta.dbTable,
    pk: meta.pk?.name,
    fields: (meta.forwardFields ?? []).map(describeField),
    reverseRelations: reverse,
    meta: metaOut,
    managers: managersOf(model),
  }
}

function managersOf(model: any): Array<{ name: string; class: string }> {
  const declared = (model._meta.managers ?? []) as Array<[string, unknown]>
  if (declared.length) return declared.map(([name, m]) => ({ name, class: nameOf(m) }))
  // No declared manager: the implicit `objects`.
  try {
    const objects = model.objects
    if (objects) return [{ name: 'objects', class: nameOf(objects) }]
  } catch {}
  return []
}

function describeDatabases(dbs: unknown): Record<string, unknown> | undefined {
  if (!dbs || typeof dbs !== 'object') return undefined
  const out: Record<string, unknown> = {}
  for (const [alias, cfg] of Object.entries(dbs as Record<string, any>)) {
    const o = (cfg?.options ?? {}) as Record<string, unknown>
    const name = o.binding ?? o.filename ?? o.dataDir ?? o.database ?? o.url
    out[alias] = redact({
      vendor: cfg?.vendor,
      dialect: cfg?.dialect,
      ...(name !== undefined ? { name: String(name) } : {}),
    })
  }
  return out
}

function describeBackends(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const out: Record<string, unknown> = {}
  for (const [alias, cfg] of Object.entries(value as Record<string, any>)) {
    out[alias] = {
      backend: cfg?.backend ?? cfg?.vendor ?? cfg?.type ?? nameOf(cfg),
    }
  }
  return out
}

/** Versions of @ghuri/* and a few key packages, as resolved from the project root. */
function packageVersions(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  let dir = resolve(root)
  while (true) {
    const scope = join(dir, 'node_modules', '@ghuri')
    if (existsSync(scope)) {
      for (const name of readdirSync(scope).sort()) {
        const key = `@ghuri/${name}`
        if (key in out) continue
        try {
          out[key] = readJson(join(scope, name, 'package.json')).version
        } catch {}
      }
    }
    for (const name of ['hono', 'drizzle-orm', 'wrangler', 'vitest', 'typescript']) {
      if (name in out) continue
      try {
        const pj = join(dir, 'node_modules', name, 'package.json')
        if (existsSync(pj)) out[name] = readJson(pj).version
      } catch {}
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return out
}

function settingValue(key: string, value: unknown): unknown {
  return redact(toJson(value, 3), key)
}

async function buildSnapshot(cli: CliContext, project: Project, ctx: GhuriContext): Promise<ProjectSnapshot> {
  const settings = ctx.settings as Record<string, unknown>
  const core = project.core
  const rel = (p?: string) => (p ? relative(project.root, p) || '.' : undefined)
  const configs = core.apps.getAppConfigs()
  const models = (core.apps.getModels() as any[]).filter((m) => m?._meta)

  const special = new Set([
    'SECRET_KEY',
    'DEBUG',
    'INSTALLED_APPS',
    'MIDDLEWARE',
    'DATABASES',
    'STORAGES',
    'CACHES',
    'ROOT_URLCONF',
  ])
  const otherSettings: Record<string, unknown> = {}
  for (const key of Object.keys(settings).sort()) {
    if (!special.has(key)) otherSettings[key] = settingValue(key, settings[key])
  }
  const bindings = Object.entries(project.env)
    .filter(([, v]) => v !== null && typeof v === 'object')
    .map(([k]) => k)
    .sort()

  const projectInfo: Record<string, unknown> = {
    root: project.root,
    settingsModule: rel(project.settingsPath),
    runtime: project.wranglerConfig ? 'cloudflare' : 'node',
    ...(project.wranglerConfig ? { wranglerConfig: rel(project.wranglerConfig) } : {}),
    bindings,
    DEBUG: !!settings.DEBUG,
    SECRET_KEY: settings.SECRET_KEY ? '(set, hidden)' : '(not set)',
    INSTALLED_APPS: configs.map((c) => c.name),
    MIDDLEWARE: ((settings.MIDDLEWARE as unknown[]) ?? []).map(nameOf),
    DATABASES: describeDatabases(settings.DATABASES),
    STORAGES: describeBackends(settings.STORAGES),
    CACHES: describeBackends(settings.CACHES),
    otherSettings,
    packages: packageVersions(project.root),
    ghuriCli: cliVersion(),
    node: process.version,
  }
  for (const [k, v] of Object.entries(projectInfo)) if (v === undefined) delete projectInfo[k]

  const apps = configs.map((c) => {
    const path = c.path ? resolve(c.path) : undefined
    const inProject = !!path && (path + sep).startsWith(project.root + sep) && !path.includes('node_modules')
    return {
      label: c.appLabel,
      name: c.name,
      verboseName: c.displayName,
      source: inProject ? 'project' : 'package',
      ...(path ? { path: inProject ? rel(path) : path } : {}),
      models: (core.apps.getModels(c.appLabel) as any[]).map((m) => m?._meta?.objectName ?? m?.name),
      commands: Object.keys(c.commands ?? {}),
      hasMigrations: !!c.migrations && Object.keys(c.migrations).length > 0,
    }
  })

  const entries = await cli.commands()
  const commands = entries
    .map((e) => {
      const help = String((e.cls as any).help ?? '').trim()
      let usage: string | undefined
      try {
        usage = formatCommandHelp(e.name, e, commandSpec(e, cli), { color: false }).trimEnd()
      } catch {}
      return { name: e.name, group: e.source, summary: summary(help, 200), help, usage }
    })
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))

  return {
    project: projectInfo,
    apps,
    models: models.map(describeModel),
    routes: collectRoutes(project, ctx),
    commands,
  }
}

// ---- migrations ---------------------------------------------------------------------------------

async function migrationStatus(project: Project, args: Record<string, unknown>) {
  const orm = await project.tryImport<any>('@ghuri/orm/commands')
  if (typeof orm?.showMigrations !== 'function') {
    throw new Error('@ghuri/orm is not installed in this project (no @ghuri/orm/commands): no migrations.')
  }
  const appLabels = Array.isArray(args.app) ? args.app.map(String) : args.app ? [String(args.app)] : []
  const using = typeof args.database === 'string' ? args.database : 'default'
  const statuses = (await orm.showMigrations({ appLabels, using })) as Array<{
    app: string
    name: string
    applied: boolean
    replaces?: string[]
  }>
  const labels = appLabels.length
    ? appLabels
    : project.core.apps
        .getAppConfigs()
        .map((c) => c.appLabel)
        .sort()
  const apps = labels.map((label) => ({
    app: label,
    migrations: statuses
      .filter((s) => s.app === label)
      .map((s) => ({
        name: s.name,
        applied: s.applied,
        ...(s.replaces?.length ? { replaces: s.replaces } : {}),
      })),
  }))
  const unapplied = statuses.filter((s) => !s.applied).map((s) => `${s.app}.${s.name}`)
  return { database: using, apps, unapplied }
}

// ---- OpenAPI ------------------------------------------------------------------------------------

/**
 * What the `openapi_schema` worker op returns: the document as a JSON string (so the generic `toJson`
 * depth limit never cuts a deeply nested schema), or why there is none.
 */
export type OpenAPIResult = { json: string } | { unavailable: string }

/**
 * The OpenAPI document `ghuri generateschema` would print: @ghuri/rest's `GenerateSchemaCommand`, which
 * documents ROOT_URLCONF through the first routed `SchemaView` (its title, version, patterns and prefix).
 */
async function openapiSchema(project: Project, ctx: GhuriContext): Promise<OpenAPIResult> {
  const rest = await project.tryImport<any>('@ghuri/rest')
  if (
    !rest ||
    (typeof rest.GenerateSchemaCommand !== 'function' && typeof rest.generateSchema !== 'function')
  ) {
    return {
      unavailable:
        '@ghuri/rest is not installed in this project, so it has no REST API to describe. Install it with `npm install @ghuri/rest@next` and route a viewset or APIView.',
    }
  }
  const urlconf = (ctx.settings as Record<string, unknown>).ROOT_URLCONF
  if (!urlconf) return { unavailable: 'ROOT_URLCONF is not set, so there are no REST routes to describe.' }
  const document =
    typeof rest.GenerateSchemaCommand === 'function'
      ? new rest.GenerateSchemaCommand().generate({})
      : rest.generateSchema(urlconf)
  return { json: JSON.stringify(document) }
}
