// A small, self-contained Model Context Protocol server over stdio: newline-delimited JSON-RPC 2.0 on
// stdin / stdout (https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio).
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'

/** Protocol revisions this server speaks (newest first). Same list as @ghuri/agents' HTTP server. */
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const
export const MCP_LATEST_PROTOCOL_VERSION: string = MCP_PROTOCOL_VERSIONS[0]

/** JSON-RPC 2.0 error codes. */
export const JSONRPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

export type JsonRpcId = string | number | null

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** Raised by a request handler: becomes a JSON-RPC error response. */
export class McpError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
  }
}

/** Raised by a tool: becomes a tool result with `isError: true` (the model sees the message). */
export class ToolError extends Error {}

export interface ToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

/** What a tool returns: text for the model and/or JSON data (sent as text and `structuredContent`). */
export interface ToolOutput {
  text?: string
  data?: unknown
  isError?: boolean
}

export interface McpTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: ToolAnnotations
  run(args: Record<string, unknown>, ctx: { signal: AbortSignal }): Promise<ToolOutput>
}

export interface McpServerInfo {
  name: string
  version: string
  title?: string
  instructions?: string
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isValidId(v: unknown): boolean {
  return v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
}

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } }
}

/** JSON-RPC dispatcher for MCP: `initialize`, `ping`, `tools/list`, `tools/call` and notifications. */
export class McpProtocol {
  private inflight = new Map<string, AbortController>()
  /** Protocol version agreed in `initialize` (undefined before). */
  protocolVersion?: string

  constructor(
    readonly info: McpServerInfo,
    readonly tools: McpTool[],
    private readonly log: (s: string) => void = () => {},
  ) {}

  initializeResult(params: Record<string, unknown>): Record<string, unknown> {
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : undefined
    this.protocolVersion =
      requested && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : MCP_LATEST_PROTOCOL_VERSION
    return {
      protocolVersion: this.protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: this.info.name,
        version: this.info.version,
        ...(this.info.title ? { title: this.info.title } : {}),
      },
      ...(this.info.instructions ? { instructions: this.info.instructions } : {}),
    }
  }

  listTools(): Array<Record<string, unknown>> {
    return this.tools.map((t) => ({
      name: t.name,
      ...(t.title ? { title: t.title } : {}),
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: { ...(t.title ? { title: t.title } : {}), ...t.annotations } } : {}),
    }))
  }

  async callTool(name: string, args: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
    const tool = this.tools.find((t) => t.name === name)
    if (!tool) throw new McpError(JSONRPC.INVALID_PARAMS, `Unknown tool: ${name}`)
    if (args !== undefined && !isPlainObject(args)) {
      return { content: [{ type: 'text', text: 'Tool arguments must be an object.' }], isError: true }
    }
    try {
      const out = await tool.run((args ?? {}) as Record<string, unknown>, { signal })
      const content: Array<{ type: 'text'; text: string }> = []
      const result: Record<string, unknown> = { content, isError: !!out.isError }
      if (out.text !== undefined) content.push({ type: 'text', text: out.text })
      if (out.data !== undefined) {
        const json = out.data === null ? null : JSON.parse(JSON.stringify(out.data))
        if (out.text === undefined) content.push({ type: 'text', text: JSON.stringify(json) })
        result.structuredContent = isPlainObject(json) ? json : { result: json }
      }
      if (!content.length) content.push({ type: 'text', text: '' })
      return result
    } catch (err) {
      const message =
        err instanceof ToolError ? err.message : `${(err as Error)?.name ?? 'Error'}: ${errorMessage(err)}`
      if (!(err instanceof ToolError))
        this.log(`[ghuri mcp] tool ${name} failed: ${(err as Error)?.stack ?? err}\n`)
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>, signal: AbortSignal) {
    switch (method) {
      case 'initialize':
        return this.initializeResult(params)
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: this.listTools() }
      case 'tools/call':
        if (typeof params.name !== 'string')
          throw new McpError(JSONRPC.INVALID_PARAMS, 'tools/call requires a tool name')
        return this.callTool(params.name, params.arguments, signal)
      case 'resources/list':
        return { resources: [] }
      case 'resources/templates/list':
        return { resourceTemplates: [] }
      case 'prompts/list':
        return { prompts: [] }
      case 'logging/setLevel':
        return {}
      default:
        throw new McpError(JSONRPC.METHOD_NOT_FOUND, `Method not found: ${method}`)
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === 'notifications/cancelled' && isPlainObject(params)) {
      const key = idKey(params.requestId as JsonRpcId)
      this.inflight.get(key)?.abort(new Error(String(params.reason ?? 'cancelled')))
    }
    // notifications/initialized and others need no action.
  }

  /** Handle one parsed message; `null` when nothing must be sent (notifications, responses, cancelled requests). */
  async handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
    if (!isPlainObject(message) || message.jsonrpc !== '2.0') {
      const id = isPlainObject(message) && isValidId(message.id) ? (message.id as JsonRpcId) : null
      return errorResponse(id, JSONRPC.INVALID_REQUEST, 'Invalid Request')
    }
    const hasId = 'id' in message && message.id !== undefined
    if (typeof message.method !== 'string') {
      // A response from the client (to a server request we never send): ignore.
      if (('result' in message || 'error' in message) && hasId) return null
      return errorResponse(
        isValidId(message.id) ? (message.id as JsonRpcId) : null,
        JSONRPC.INVALID_REQUEST,
        'Invalid Request',
      )
    }
    if (!hasId) {
      this.handleNotification(message.method, message.params)
      return null
    }
    if (!isValidId(message.id) || message.id === null)
      return errorResponse(null, JSONRPC.INVALID_REQUEST, 'Invalid Request: id must be a string or number')
    const id = message.id as JsonRpcId
    const params = message.params === undefined ? {} : message.params
    if (!isPlainObject(params)) return errorResponse(id, JSONRPC.INVALID_PARAMS, 'params must be an object')
    const controller = new AbortController()
    const key = idKey(id)
    this.inflight.set(key, controller)
    try {
      const result = await this.dispatch(message.method, params, controller.signal)
      if (controller.signal.aborted) return null
      return { jsonrpc: '2.0', id, result }
    } catch (err) {
      if (controller.signal.aborted) return null
      if (err instanceof McpError) return errorResponse(id, err.code, err.message, err.data)
      this.log(`[ghuri mcp] ${message.method} failed: ${(err as Error)?.stack ?? err}\n`)
      return errorResponse(id, JSONRPC.INTERNAL_ERROR, errorMessage(err))
    } finally {
      if (this.inflight.get(key) === controller) this.inflight.delete(key)
    }
  }

  /** Abort every running request (server shutdown). */
  abortAll(): void {
    for (const c of this.inflight.values()) c.abort(new Error('server shutting down'))
  }
}

function idKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`
}

function errorMessage(err: unknown): string {
  return String((err as Error)?.message ?? err)
}

export interface ServeStdioOptions {
  input: Readable
  /** Writes one protocol line (a newline is appended here). */
  write: (line: string) => void
  log?: (s: string) => void
}

/**
 * Read newline-delimited JSON-RPC messages from `input` and write responses with `write`. Requests run
 * concurrently; resolves once `input` ends and every running request has answered.
 */
export async function serveStdio(protocol: McpProtocol, opts: ServeStdioOptions): Promise<void> {
  const send = (msg: unknown) => opts.write(`${JSON.stringify(msg)}\n`)
  const pending = new Set<Promise<void>>()
  const track = (p: Promise<void>) => {
    pending.add(p)
    p.finally(() => pending.delete(p))
  }
  const rl = createInterface({ input: opts.input, crlfDelay: Number.POSITIVE_INFINITY })
  for await (const raw of rl) {
    const line = raw.trim()
    if (!line) continue
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      send(errorResponse(null, JSONRPC.PARSE_ERROR, 'Parse error'))
      continue
    }
    if (Array.isArray(message)) {
      const batch = message
      track(
        (async () => {
          if (!batch.length) return send(errorResponse(null, JSONRPC.INVALID_REQUEST, 'Empty batch'))
          const responses = (await Promise.all(batch.map((m) => protocol.handleMessage(m)))).filter(Boolean)
          if (responses.length) send(responses)
        })(),
      )
      continue
    }
    track(
      protocol.handleMessage(message).then((r) => {
        if (r) send(r)
      }),
    )
  }
  await Promise.allSettled([...pending])
}
