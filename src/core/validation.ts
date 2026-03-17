const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*(?:@[^\s/]+)?$/

export function isValidIdentifier(value: string): boolean {
  return identifierPattern.test(value)
}

export function assertNonEmpty(value: string, field: string): string {
  const v = value.trim()
  if (!v) {
    throw new Error(`Expected ${field} to be provided`)
  }
  return v
}

export function splitIdentifierAndVersion(value: string): { id: string; version?: string } {
  const parts = value.split('@')
  const id = parts[0] || ''
  const version = parts.length > 1 ? parts.slice(1).join('@') : undefined
  return {
    id,
    version,
  }
}

export function splitArgPair(input: string): { owner: string; slug: string } {
  const [owner, slug] = input.split('/')
  if (!owner || !slug) {
    throw new Error(`Expected <owner>/<slug>, received ${input}`)
  }
  return { owner, slug: slug.trim() }
}
