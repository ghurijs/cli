// Ghuri documentation for `ghuri mcp`: the docs site's llms-full.txt, fetched once per session and split into
// pages (`# Title`) and sections (`## Heading`) for keyword search.
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DOCS_URL = 'https://ghurijs.github.io/docs/llms-full.txt'
export const DOCS_SITE = 'https://ghurijs.github.io/docs/'

export interface DocSection {
  heading: string
  text: string
}

export interface DocPage {
  title: string
  slug: string
  description: string
  text: string
  sections: DocSection[]
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Split llms-full.txt into pages and sections, ignoring `#` lines inside code fences. */
export function parseLlmsFull(src: string): DocPage[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const pages: DocPage[] = []
  let page: { title: string; lines: string[] } | undefined
  let fence: string | undefined
  const flush = () => {
    if (page) pages.push(buildPage(page.title, page.lines))
  }
  for (const line of lines) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line)
    if (m) {
      if (!fence) fence = m[1]
      else if (line.trim().startsWith(fence) && /^[`~]+$/.test(line.trim())) fence = undefined
    } else if (!fence && /^# \S/.test(line)) {
      flush()
      page = { title: line.slice(2).trim(), lines: [] }
      continue
    }
    page?.lines.push(line)
  }
  flush()
  return pages
}

function buildPage(title: string, lines: string[]): DocPage {
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  let description = ''
  if (lines[i]?.startsWith('> ')) {
    description = lines[i].slice(2).trim()
  }
  const sections: DocSection[] = []
  let current: DocSection = { heading: '', text: '' }
  let fence: string | undefined
  const body: string[] = []
  for (const line of lines) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line)
    if (m) {
      if (!fence) fence = m[1]
      else if (line.trim().startsWith(fence) && /^[`~]+$/.test(line.trim())) fence = undefined
    } else if (!fence && /^## \S/.test(line)) {
      if (current.heading || current.text.trim()) sections.push({ ...current, text: current.text.trim() })
      current = { heading: line.slice(3).trim(), text: '' }
      body.push(line)
      continue
    }
    current.text += `${line}\n`
    body.push(line)
  }
  if (current.heading || current.text.trim()) sections.push({ ...current, text: current.text.trim() })
  return { title, slug: slugify(title), description, text: body.join('\n').trim(), sections }
}

const STOPWORDS = new Set(
  'a an and are as at be by can do does for from how i in is it of on or the to what when where which with use using ghuri'.split(
    ' ',
  ),
)

function terms(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9_@./-]+/)
    .map((w) => w.replace(/^[./-]+|[./-]+$/g, ''))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  return [...new Set(words)]
}

function count(haystack: string, needle: string): number {
  let n = 0
  let i = haystack.indexOf(needle)
  while (i >= 0 && n < 50) {
    n++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return n
}

export interface DocHit {
  page: string
  slug: string
  section: string
  score: number
  text: string
}

export interface DocsOptions {
  url?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

/** Loads the docs once (per process) and answers searches. Failures are not cached, so a later call retries. */
export class DocsIndex {
  private pages?: Promise<DocPage[]>
  readonly url: string

  constructor(private readonly opts: DocsOptions = {}) {
    this.url = opts.url ?? DOCS_URL
  }

  load(): Promise<DocPage[]> {
    if (!this.pages) {
      this.pages = this.fetchText().then(parseLlmsFull)
      this.pages.catch(() => {
        this.pages = undefined
      })
    }
    return this.pages
  }

  private async fetchText(): Promise<string> {
    const url = this.url
    if (url.startsWith('file:') || isAbsolute(url)) {
      const file = url.startsWith('file:') ? fileURLToPath(url) : url
      try {
        return await readFile(file, 'utf8')
      } catch (err) {
        throw new Error(`Could not read the Ghuri docs from ${file}: ${(err as Error).message}`)
      }
    }
    const doFetch = this.opts.fetch ?? globalThis.fetch
    let res: Response
    try {
      res = await doFetch(url, { signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000) })
    } catch (err) {
      throw new Error(
        `Could not fetch the Ghuri docs from ${url} (${(err as Error).message}). Are you offline? ` +
          `Browse ${DOCS_SITE} instead, or start the server with --docs-url <file or URL>.`,
      )
    }
    if (!res.ok) {
      throw new Error(
        `Could not fetch the Ghuri docs from ${url} (HTTP ${res.status}). The file may not be published yet; ` +
          `browse ${DOCS_SITE} instead, or start the server with --docs-url <file or URL>.`,
      )
    }
    return res.text()
  }

  async search(query: string, limit = 5): Promise<DocHit[]> {
    const pages = await this.load()
    const ts = terms(query)
    if (!ts.length) return []
    const phrase = query.toLowerCase().trim()
    const hits: DocHit[] = []
    for (const page of pages) {
      const title = page.title.toLowerCase()
      for (const section of page.sections) {
        const heading = section.heading.toLowerCase()
        const text = section.text.toLowerCase()
        let score = 0
        let matched = 0
        for (const t of ts) {
          const n = count(text, t)
          const inHeading = heading.includes(t)
          const inTitle = title.includes(t)
          if (n || inHeading || inTitle) matched++
          score += Math.log2(1 + n) * 2 + (inHeading ? 6 : 0) + (inTitle ? 4 : 0)
        }
        if (!matched) continue
        score *= matched / ts.length
        if (phrase.length > 3 && text.includes(phrase)) score += 8
        if (phrase.length > 3 && heading.includes(phrase)) score += 8
        hits.push({
          page: page.title,
          slug: page.slug,
          section: section.heading,
          score: Math.round(score * 100) / 100,
          text: section.text,
        })
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /** A page by slug, title or docs path (`topics/models`), case-insensitive; undefined if none matches. */
  async get(path: string): Promise<DocPage | undefined> {
    const pages = await this.load()
    const raw = path
      .trim()
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/?docs\//, '')
      .replace(/[#?].*$/, '')
      .replace(/\/+$/, '')
    const want = slugify(raw)
    const last = slugify(raw.split('/').pop() ?? raw)
    return (
      pages.find((p) => p.slug === want || p.title.toLowerCase() === raw.toLowerCase()) ??
      pages.find((p) => p.slug === last) ??
      pages.find((p) => p.slug.startsWith(`${last}-`) || p.slug.endsWith(`-${last}`)) ??
      pages.find((p) => last.length > 3 && p.slug.includes(last))
    )
  }
}
