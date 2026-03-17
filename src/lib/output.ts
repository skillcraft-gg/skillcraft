import { Command } from 'commander'

type OutputMode = 'text' | 'json'

export function getOutputMode(program: Command): OutputMode {
  const raw = program.opts<{ json?: boolean }>().json
  return raw ? 'json' : 'text'
}

export function printResult<T>(mode: OutputMode, label: string, data: T): void {
  if (mode === 'json') {
    process.stdout.write(`${JSON.stringify({ label, data })}\n`)
    return
  }
  process.stdout.write(`${label}: ${JSON.stringify(data)}\n`)
}

export function printLines(lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`)
}

export function printError(message: string): void {
  process.stderr.write(`${message}\n`)
}
