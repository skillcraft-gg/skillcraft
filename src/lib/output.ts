import { stdin as input, stderr, stdout } from 'node:process'

export type OutputMode = 'text' | 'json'

export type OutputTone = 'default' | 'success' | 'warning' | 'danger' | 'muted' | 'accent'

export type OutputRow = {
  label: string
  value: string | number | boolean | undefined | null
  tone?: OutputTone
}

const ansi = {
  reset: '\u001B[0m',
  bold: '\u001B[1m',
  dim: '\u001B[2m',
  green: '\u001B[32m',
  yellow: '\u001B[33m',
  red: '\u001B[31m',
  cyan: '\u001B[36m',
} as const

let outputMode: OutputMode = process.argv.includes('--json') ? 'json' : 'text'

export class CommandError extends Error {
  code: string

  constructor(message: string, code = 'COMMAND_FAILED') {
    super(message)
    this.name = 'CommandError'
    this.code = code
  }
}

export function configureOutputMode(argv: readonly string[] = process.argv): OutputMode {
  outputMode = argv.includes('--json') ? 'json' : 'text'
  return outputMode
}

export function setOutputMode(mode: OutputMode): void {
  outputMode = mode
}

export function getOutputMode(): OutputMode {
  return outputMode
}

export function isJsonOutput(): boolean {
  return outputMode === 'json'
}

export function isTextOutput(): boolean {
  return outputMode === 'text'
}

export function isRichTextEnabled(): boolean {
  return isTextOutput() && ((stdout.isTTY === true || stderr.isTTY === true) || process.env.SKILLCRAFT_FORCE_TTY === '1')
}

export function isInteractiveOutputAllowed(): boolean {
  if (isJsonOutput()) {
    return false
  }

  return (input.isTTY === true && stdout.isTTY === true) || process.env.SKILLCRAFT_FORCE_TTY === '1'
}

export function emitJson(payload: unknown): void {
  stdout.write(`${JSON.stringify(payload)}\n`)
}

export function emitJsonError(error: unknown): void {
  const normalized = normalizeError(error)
  stderr.write(`${JSON.stringify({
    error: {
      message: normalized.message,
      code: normalized.code,
    },
  })}\n`)
}

export function normalizeError(error: unknown): CommandError {
  if (error instanceof CommandError) {
    return error
  }

  if (error instanceof Error) {
    const code = typeof (error as { code?: unknown }).code === 'string'
      ? String((error as { code?: string }).code)
      : 'COMMAND_FAILED'
    return new CommandError(error.message, code)
  }

  return new CommandError(String(error))
}

export function fail(message: string, code = 'COMMAND_FAILED'): never {
  throw new CommandError(message, code)
}

export function printResult<T>(mode: OutputMode, label: string, data: T): void {
  if (mode === 'json') {
    emitJson({ label, data })
    return
  }

  writeStdout(`${label}: ${JSON.stringify(data)}`)
}

export function printHeader(title: string, subtitle?: string): void {
  if (!isTextOutput()) {
    return
  }

  if (!isRichTextEnabled()) {
    writeStdout(title)
    if (subtitle) {
      writeStdout(subtitle)
    }
    return
  }

  writeStdout(color(`== ${title} ==`, 'accent'))
  if (subtitle) {
    writeStdout(color(subtitle, 'muted'))
  }
}

export function printSection(title: string): void {
  if (!isTextOutput()) {
    return
  }

  if (!isRichTextEnabled()) {
    writeStdout(title)
    return
  }

  writeStdout('')
  writeStdout(color(title, 'bold'))
}

export function printRows(rows: OutputRow[]): void {
  if (!isTextOutput() || !rows.length) {
    return
  }

  const width = rows.reduce((max, row) => Math.max(max, row.label.length), 0)
  for (const row of rows) {
    const value = formatValue(row.value)
    const paddedLabel = `${row.label}${'.'.repeat(Math.max(2, width - row.label.length + 2))}`
    const renderedValue = color(value, row.tone ?? 'default')
    writeStdout(`${isRichTextEnabled() ? color(paddedLabel, 'muted') : `${row.label}:`} ${renderedValue}`)
  }
}

export function printBulletList(items: readonly string[]): void {
  if (!isTextOutput() || !items.length) {
    return
  }

  for (const item of items) {
    writeStdout(`- ${item}`)
  }
}

export function printSuccess(message: string): void {
  printCallout('success', message)
}

export function printWarning(message: string): void {
  printCallout('warning', message)
}

export function printInfo(message: string): void {
  printCallout('default', message)
}

export function printEmpty(message: string): void {
  printCallout('muted', message)
}

export function printOutro(message: string): void {
  printCallout('default', message)
}

export function printLines(lines: string[]): void {
  stdout.write(`${lines.join('\n')}\n`)
}

export function printError(message: string): void {
  stderr.write(`${message}\n`)
}

function printCallout(tone: OutputTone, message: string): void {
  if (!isTextOutput()) {
    return
  }

  if (!isRichTextEnabled()) {
    writeStdout(message)
    return
  }

  const marker = tone === 'success'
    ? '[ok]'
    : tone === 'warning'
      ? '[warn]'
      : tone === 'danger'
        ? '[err]'
        : '[i]'
  writeStdout(`${color(marker, tone)} ${message}`)
}

function writeStdout(message: string): void {
  stdout.write(`${message}\n`)
}

function formatValue(value: OutputRow['value']): string {
  if (value === undefined || value === null || value === '') {
    return 'none'
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }

  return String(value)
}

function color(value: string, tone: OutputTone | 'bold'): string {
  if (!isRichTextEnabled()) {
    return value
  }

  if (tone === 'bold') {
    return `${ansi.bold}${value}${ansi.reset}`
  }

  if (tone === 'success') {
    return `${ansi.green}${value}${ansi.reset}`
  }

  if (tone === 'warning') {
    return `${ansi.yellow}${value}${ansi.reset}`
  }

  if (tone === 'danger') {
    return `${ansi.red}${value}${ansi.reset}`
  }

  if (tone === 'muted') {
    return `${ansi.dim}${value}${ansi.reset}`
  }

  if (tone === 'default') {
    return value
  }

  return `${ansi.cyan}${value}${ansi.reset}`
}
