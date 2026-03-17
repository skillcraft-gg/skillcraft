const localIdentifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*(?:@[^\s/]+)?$/
const localIdentifierPatternWithoutVersion = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const externalSourceIdWithoutVersion = /^([a-zA-Z0-9][a-zA-Z0-9._-]*):([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:\/([a-zA-Z0-9][a-zA-Z0-9._-]*))?$/

export type ParsedSkillId = {
  id: string
  owner?: string
  slug: string
  source?: string
  version?: string
}

export function normalizeSkillId(value: string): string | undefined {
  const parsed = splitSkillIdentifier(value)
  if (!parsed.id) {
    return undefined
  }
  return `${parsed.id}${parsed.version ? `@${parsed.version}` : ''}`
}

export function isValidIdentifier(value: string): boolean {
  return localIdentifierPattern.test(value)
}

export function isValidSkillIdentifier(value: string): boolean {
  return !!splitSkillIdentifier(value).id
}

export function splitSkillIdentifier(input: string): ParsedSkillId {
  const trimmed = input.trim()
  const parsed = splitIdentifierAndVersion(trimmed)
  const id = parsed.id || ''

  if (isLocalIdentifierWithoutVersion(id)) {
    const [owner, slug] = id.split('/')
    return {
      id,
      owner,
      slug,
      version: parsed.version,
    }
  }

  const match = externalSourceIdWithoutVersion.exec(id)
  if (!match) {
    return {
      id: '',
      slug: '',
      version: parsed.version,
    }
  }

  const source = match[1]
  const firstPart = match[2]
  const secondPart = match[3]

  if (secondPart === undefined) {
    return {
      id: `${source}:${firstPart}`,
      source,
      slug: firstPart,
      version: parsed.version,
    }
  }

  return {
    id: `${source}:${firstPart}/${secondPart}`,
    source,
    owner: firstPart,
    slug: secondPart,
    version: parsed.version,
  }
}

function isLocalIdentifierWithoutVersion(value: string): boolean {
  return localIdentifierPatternWithoutVersion.test(value)
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
