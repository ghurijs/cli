// JSON-safe summaries of arbitrary values (settings, field options) and secret redaction for `ghuri mcp`.

/** Keys whose string values are never shown. */
export const SECRET_KEY_PATTERN: RegExp =
  /SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE|CREDENTIAL|SIGNING_?KEY|ACCESS_?KEY|AUTH_?KEY|SALT|DSN/i

/** Convert anything into plain JSON: classes/functions become `[Function Name]`, cycles and depth are cut. */
export function toJson(value: unknown, maxDepth = 12): unknown {
  const seen = new WeakSet<object>()
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v ?? null
    switch (typeof v) {
      case 'string':
      case 'boolean':
        return v
      case 'number':
        return Number.isFinite(v) ? v : String(v)
      case 'bigint':
        return v.toString()
      case 'symbol':
        return v.toString()
      case 'function':
        return `[${/^class[\s{]/.test(Function.prototype.toString.call(v)) ? 'class' : 'Function'} ${(v as Function).name || 'anonymous'}]`
    }
    const obj = v as object
    if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString()
    if (obj instanceof RegExp) return obj.toString()
    if (obj instanceof URL) return obj.toString()
    if (seen.has(obj)) return '[Circular]'
    if (depth >= maxDepth) return Array.isArray(obj) ? `[Array(${obj.length})]` : `[${ctorName(obj)}]`
    seen.add(obj)
    try {
      if (Array.isArray(obj)) return obj.map((x) => walk(x, depth + 1))
      if (obj instanceof Map)
        return Object.fromEntries([...obj].map(([k, x]) => [String(k), walk(x, depth + 1)]))
      if (obj instanceof Set) return [...obj].map((x) => walk(x, depth + 1))
      if (typeof (obj as any).toJSON === 'function') {
        try {
          return walk((obj as any).toJSON(), depth + 1)
        } catch {}
      }
      const proto = Object.getPrototypeOf(obj)
      const out: Record<string, unknown> = {}
      if (proto !== Object.prototype && proto !== null) {
        const name = ctorName(obj)
        if (name && name !== 'Object') out.__type = name
      }
      for (const [k, x] of Object.entries(obj)) {
        if (typeof x === 'function' && !/^[A-Z]/.test(x.name)) continue // methods of config objects
        out[k] = walk(x, depth + 1)
      }
      return out
    } finally {
      seen.delete(obj)
    }
  }
  return walk(value, 0)
}

function ctorName(obj: object): string {
  return (obj as any).constructor?.name ?? 'Object'
}

/** `postgres://user:pass@host/db` → `postgres://***@host/db`. */
export function redactUrl(s: string): string {
  return s.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, '$1***@')
}

/** Hide secret-looking values: strings under secret-looking keys, and credentials inside URLs. */
export function redact<T>(value: T, key?: string): T {
  const walk = (v: unknown, k?: string): unknown => {
    if (typeof v === 'string') {
      if (k && SECRET_KEY_PATTERN.test(k)) return v ? '(hidden)' : ''
      return redactUrl(v)
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, k))
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [kk, x] of Object.entries(v)) out[kk] = walk(x, kk)
      return out
    }
    return v
  }
  return walk(value, key) as T
}
