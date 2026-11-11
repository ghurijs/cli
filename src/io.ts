import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type { CommandIO, CommandStyle } from '@ghuri/core'
import pc from 'picocolors'

export interface CliIO extends CommandIO {
  /** Whether prompts are available. */
  interactive: boolean
  color: boolean
}

export interface CreateIOOptions {
  stdout?: (s: string) => void
  stderr?: (s: string) => void
  stdin?: Readable
  output?: Writable
  interactive?: boolean
  color?: boolean
}

export function makeStyle(color: boolean): CommandStyle & {
  dim(s: string): string
  cyan(s: string): string
  green(s: string): string
} {
  const c = pc.createColors(color)
  return {
    success: c.green,
    warning: c.yellow,
    error: c.red,
    notice: c.cyan,
    bold: c.bold,
    dim: c.dim,
    cyan: c.cyan,
    green: c.green,
  }
}

const withNewline = (s: string) => (s.endsWith('\n') ? s : `${s}\n`)

/** The terminal CommandIO handed to commands (Django's `self.stdout` / `self.stderr` / `input()`). */
export function createIO(opts: CreateIOOptions = {}): CliIO {
  const stdin = opts.stdin ?? process.stdin
  const output = opts.output ?? process.stdout
  const interactive = opts.interactive ?? (!!(stdin as any).isTTY && !!(output as any).isTTY)
  const color = opts.color ?? (!process.env.NO_COLOR && !!(process.stdout as any).isTTY)
  const out = opts.stdout ?? ((s: string) => process.stdout.write(s))
  const err = opts.stderr ?? ((s: string) => process.stderr.write(s))
  const io: CliIO = {
    interactive,
    color,
    style: makeStyle(color),
    stdout: (msg) => out(withNewline(String(msg))),
    stderr: (msg) => err(withNewline(String(msg))),
  }
  if (interactive) {
    io.prompt = (question, o = {}) => ask(stdin, output, question, o)
    io.confirm = async (question, o = {}) => {
      const def = o.default ?? false
      const answer = (await ask(stdin, output, `${question} ${def ? '[Y/n]' : '[y/N]'} `, {})).trim()
      if (!answer) return def
      return /^y(es)?$/i.test(answer)
    }
  }
  return io
}

function ask(
  stdin: Readable,
  output: Writable,
  question: string,
  opts: { password?: boolean; default?: string },
): Promise<string> {
  const label = opts.default ? `${question.replace(/\s*$/, '')} [${opts.default}] ` : question
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: stdin, output, terminal: true })
    if (opts.password) {
      // Hide typed characters but keep the question visible.
      const anyRl = rl as any
      let questionShown = false
      anyRl._writeToOutput = (s: string) => {
        if (!questionShown) {
          questionShown = true
          output.write(s)
        } else if (s.includes('\n') || s.includes('\r')) output.write('\n')
      }
    }
    rl.on('SIGINT', () => {
      rl.close()
      reject(new Error('Operation cancelled.'))
    })
    rl.question(label, (answer) => {
      rl.close()
      resolve(answer === '' && opts.default !== undefined ? opts.default : answer)
    })
  })
}
