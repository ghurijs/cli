// Tiny template renderer for `templates/` (startproject / startapp).
//
// Syntax:
//   {{name}}                         variable (unknown names are an error, so typos surface in tests)
//   {{#if flag}} … {{else}} … {{/if}}  conditional block (nestable; `!flag` negates)
// A line holding only a block tag is removed entirely, so templates stay readable.
//
// Files:
//   template.json   manifest (not copied): { "when": { "<relative path>": "flag" | "!flag" } }
//   _name           written as .name (npm strips some dotfiles from published packages)
//   name.tpl        written as name (for files that are not valid before rendering, e.g. package.json)
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

export type TemplateVars = Record<string, string | boolean | number>

export interface TemplateManifest {
  when?: Record<string, string>
}

export class TemplateError extends Error {}

const STANDALONE = /^[ \t]*(\{\{(?:#if\s+!?[\w.]+|else|\/if)\}\})[ \t]*\r?\n/gm
const BLOCK = /\{\{#if\s+(!?)([\w.]+)\}\}((?:(?!\{\{#if\s)[\s\S])*?)\{\{\/if\}\}/
const VAR = /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g

function truthy(vars: TemplateVars, name: string): boolean {
  if (!(name in vars)) throw new TemplateError(`Unknown template flag '${name}'`)
  return !!vars[name]
}

export function renderString(src: string, vars: TemplateVars): string {
  let out = src.replace(STANDALONE, '$1')
  // Innermost blocks first (a block whose body contains no other `{{#if`).
  for (let m = BLOCK.exec(out); m; m = BLOCK.exec(out)) {
    const [whole, neg, flag, body] = m
    const elseIdx = findTopLevelElse(body)
    const yes = elseIdx >= 0 ? body.slice(0, elseIdx) : body
    const no = elseIdx >= 0 ? body.slice(elseIdx + '{{else}}'.length) : ''
    const cond = truthy(vars, flag) !== (neg === '!')
    out = out.slice(0, m.index) + (cond ? yes : no) + out.slice(m.index + whole.length)
  }
  if (/\{\{(#if|else|\/if)/.test(out)) throw new TemplateError('Unbalanced {{#if}} / {{/if}} in template')
  return out.replace(VAR, (_, name: string) => {
    if (!(name in vars)) throw new TemplateError(`Unknown template variable '${name}'`)
    return String(vars[name])
  })
}

function findTopLevelElse(body: string): number {
  return body.indexOf('{{else}}')
}

/** Output path for a template file: `_x` → `.x`, `x.tpl` → `x`. */
export function outputName(rel: string): string {
  return rel
    .split(/[\\/]/)
    .map((seg) => (/^_[^_]/.test(seg) ? `.${seg.slice(1)}` : seg))
    .map((seg) => seg.replace(/\.tpl$/, ''))
    .join('/')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

export interface RenderedFile {
  /** Output path relative to the target directory (forward slashes). */
  path: string
  content: string
}

/** Render a template directory in memory. */
export function renderTemplate(templateDir: string, vars: TemplateVars): RenderedFile[] {
  const manifestPath = join(templateDir, 'template.json')
  const manifest: TemplateManifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {}
  const files: RenderedFile[] = []
  for (const abs of walk(templateDir)) {
    const rel = relative(templateDir, abs).split(sep).join('/')
    if (rel === 'template.json') continue
    const cond = manifest.when?.[rel]
    if (cond) {
      const neg = cond.startsWith('!')
      if (truthy(vars, neg ? cond.slice(1) : cond) === neg) continue
    }
    let content: string
    try {
      content = renderString(readFileSync(abs, 'utf8'), vars)
    } catch (err) {
      throw new TemplateError(`${rel}: ${(err as Error).message}`)
    }
    files.push({ path: renderString(outputName(rel), vars), content })
  }
  return files
}

/** Write rendered files under `target` (refuses to overwrite existing files). */
export function writeFiles(target: string, files: RenderedFile[], opts: { overwrite?: boolean } = {}): void {
  if (!opts.overwrite) {
    const clash = files.find((f) => existsSync(join(target, f.path)))
    if (clash) throw new TemplateError(`${join(target, clash.path)} already exists.`)
  }
  for (const f of files) {
    const p = join(target, f.path)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, f.content)
  }
}
