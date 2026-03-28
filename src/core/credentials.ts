import path from 'node:path'
import { ensureDir, fileExists, readJson, writeJson } from './fs.js'
import { credentialIndexCachePath } from './paths.js'
import type { Proof } from './types.js'

export type NormalizedRequirements = {
  minCommits: number
  minRepositories: number
  tree: RequirementNode
}

export type RequirementNode =
  | { and: RequirementNode[] }
  | { or: RequirementNode[] }
  | { skill: string }
  | { loadout: string }
  | { agent: { provider: string } }
  | { model: { provider?: string; name?: string } }

export type CredentialIndexEntry = {
  id: string
  name?: string
  description?: string
  requirements: NormalizedRequirements
}

export type RequirementCheck = {
  type: 'skill' | 'loadout' | 'agent' | 'model'
  requirement: string
  satisfied: boolean
}

export type EvaluationProof = {
  proof: Proof
}

export type CredentialRequirementResult = {
  passed: boolean
  proofs: EvaluationProof[]
  provenCommits: string[]
  provenRepos: string[]
  checks: RequirementCheck[]
  reasons: string[]
  noExplicitChecks: boolean
}

type RawRequirementNode = Record<string, unknown>

const DEFAULT_CREDENTIAL_INDEX_URL = 'https://skillcraft.gg/credential-ledger/credentials/index.json'
const CREDENTIAL_INDEX_CACHE_REFRESH_MS = 6 * 60 * 60 * 1000
const CREDENTIAL_INDEX_CACHE_VERSION = 1

const CREDENTIAL_INDEX_CACHE_PATH = credentialIndexCachePath()

type CachedCredentialIndexFile = {
  cachedAt: number
  version: number
  entries: CredentialIndexEntry[]
}

type CredentialIndexLoadOptions = {
  refresh?: boolean
}

function getCredentialIndexUrl(): string {
  return process.env.SKILLCRAFT_CREDENTIAL_INDEX_URL?.trim() || DEFAULT_CREDENTIAL_INDEX_URL
}

async function readCredentialIndexCache(cachePath: string): Promise<CachedCredentialIndexFile | null> {
  try {
    const raw = await readJson<unknown>(cachePath)
    if (!raw || !isObject(raw)) {
      return null
    }

    const cachedAt = parseInteger(raw.cachedAt)
    if (cachedAt === undefined || cachedAt <= 0) {
      return null
    }

    if (raw.version !== CREDENTIAL_INDEX_CACHE_VERSION) {
      return null
    }

    if (!('entries' in raw)) {
      return null
    }

    const entries = normalizeCredentialIndexEntries(raw.entries)
    return {
      cachedAt,
      version: CREDENTIAL_INDEX_CACHE_VERSION,
      entries,
    }
  } catch {
    return null
  }
}

function parseInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function isCredentialIndexCacheFresh(cache: CachedCredentialIndexFile): boolean {
  const ageMs = Date.now() - cache.cachedAt
  return ageMs < CREDENTIAL_INDEX_CACHE_REFRESH_MS
}

export async function loadCredentialIndex(options: CredentialIndexLoadOptions = {}): Promise<CredentialIndexEntry[]> {
  const explicitPath = process.env.SKILLCRAFT_CREDENTIAL_INDEX_PATH?.trim()
  if (explicitPath) {
    return loadIndexFromPath(explicitPath)
  }

  const cached = !options.refresh ? await readCredentialIndexCache(CREDENTIAL_INDEX_CACHE_PATH) : null
  if (cached && isCredentialIndexCacheFresh(cached)) {
      return cached.entries
    }

  try {
    const entries = await loadIndexFromRemote(getCredentialIndexUrl())
    await writeCredentialIndexCache(entries)
    return entries
  } catch (error) {
    if (await fileExists(CREDENTIAL_INDEX_CACHE_PATH)) {
      const cached = await readCredentialIndexCache(CREDENTIAL_INDEX_CACHE_PATH)
      if (cached) {
        return cached.entries
      }
      return loadIndexFromPath(CREDENTIAL_INDEX_CACHE_PATH)
    }
    if (error instanceof Error) {
      throw error
    }
    throw new Error('failed to load credential index')
  }
}

async function loadIndexFromRemote(url: string): Promise<CredentialIndexEntry[]> {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'skillcraft-cli',
    },
  })

  if (!response.ok) {
    throw new Error(`failed to download credential index from ${url}`)
  }

  const raw = await response.json()
  const entries = normalizeCredentialIndexEntries(raw)
  return entries
}

async function loadIndexFromPath(filePath: string): Promise<CredentialIndexEntry[]> {
  const raw = await readJson<unknown>(filePath)
  if (!raw) {
    return []
  }

  if (isObject(raw) && Array.isArray((raw as { entries?: unknown }).entries)) {
    return normalizeCredentialIndexEntries((raw as { entries: unknown }).entries)
  }

  return normalizeCredentialIndexEntries(raw)
}

async function writeCredentialIndexCache(entries: CredentialIndexEntry[]): Promise<void> {
  await ensureDir(path.dirname(CREDENTIAL_INDEX_CACHE_PATH))
  const payload = {
    cachedAt: Date.now(),
    version: CREDENTIAL_INDEX_CACHE_VERSION,
    entries,
  }
  await writeJson(CREDENTIAL_INDEX_CACHE_PATH, payload)
}

export function normalizeRequirements(value: unknown): NormalizedRequirements {
  const requirements = isObject(value) ? value : {}

  if (requirements.mode !== undefined) {
    throw new Error('requirements.mode is not supported. Use nested and/or expressions instead.')
  }

  const requirementTree = normalizeRequirementRoot(requirements)

  return {
    minCommits: normalizeNonNegativeInteger(requirements.min_commits ?? requirements.minCommits, 0),
    minRepositories: normalizeNonNegativeInteger(requirements.min_repositories ?? requirements.minRepositories, 0),
    tree: requirementTree,
  }
}

function normalizeRequirementRoot(value: RawRequirementNode): RequirementNode {
  if (Object.prototype.hasOwnProperty.call(value, 'tree')) {
    return parseRequirementNode(value.tree, 'requirements.tree')
  }

  const hasExplicitAnd = Object.prototype.hasOwnProperty.call(value, 'and')
  const hasExplicitOr = Object.prototype.hasOwnProperty.call(value, 'or')

  if (hasExplicitAnd && hasExplicitOr) {
    throw new Error('requirements cannot include both and and or at the same level')
  }

  if (hasExplicitAnd) {
    const unexpected = Object.keys(value).filter((key) =>
      !['and', 'min_commits', 'min_repositories', 'minRepositories', 'minCommits', 'tree'].includes(key),
    )
    if (unexpected.length) {
      throw new Error(`Unexpected requirement fields: ${unexpected.join(', ')}`)
    }

    return {
      and: normalizeRequirementList((value as RawRequirementNode).and, 'requirements.and'),
    }
  }

  if (hasExplicitOr) {
    const unexpected = Object.keys(value).filter((key) =>
      !['or', 'min_commits', 'min_repositories', 'minRepositories', 'minCommits', 'tree'].includes(key),
    )
    if (unexpected.length) {
      throw new Error(`Unexpected requirement fields: ${unexpected.join(', ')}`)
    }

    return {
      or: normalizeRequirementList((value as RawRequirementNode).or, 'requirements.or'),
    }
  }

  return { and: buildImplicitAndFromShortcuts(value) }
}

function normalizeRequirementList(value: unknown, location: string): RequirementNode[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected array at ${location}`)
  }

  return value.map((entry, index) => parseRequirementNode(entry, `${location}[${index}]`))
}

function normalizeShortHandList(values: unknown, location: string): string[] {
  if (values === undefined) {
    return []
  }

  if (Array.isArray(values)) {
    return values.map((entry) => {
      const text = parseScalarText(entry)
      if (text === undefined) {
        throw new Error(`Expected text values for ${location}`)
      }
      return text
    })
  }

  const text = parseScalarText(values)
  if (!text) {
    return []
  }

  return [text]
}

function buildImplicitAndFromShortcuts(requirements: RawRequirementNode): RequirementNode[] {
  const normalized: RequirementNode[] = []
  const known = ['and', 'or', 'min_commits', 'min_repositories', 'minRepositories', 'minCommits', 'tree', 'skill', 'loadout', 'agent', 'model']

  for (const skill of normalizeShortHandList(requirements.skill, 'requirements.skill')) {
    normalized.push({ skill })
  }

  for (const loadout of normalizeShortHandList(requirements.loadout, 'requirements.loadout')) {
    normalized.push({ loadout })
  }

  const hasAgent = Object.prototype.hasOwnProperty.call(requirements, 'agent')
  const agent = normalizeAgentRequirement(requirements.agent)
  if (agent) {
    normalized.push(agent)
  } else if (hasAgent) {
    throw new Error('requirements.agent must be an object with a provider')
  }

  const hasModel = Object.prototype.hasOwnProperty.call(requirements, 'model')
  const model = normalizeModelRequirement(requirements.model)
  if (model) {
    normalized.push(model)
  } else if (hasModel) {
    throw new Error('requirements.model must be an object with optional provider and/or name')
  }

  const nested = Object.keys(requirements).filter((key) => !known.includes(key) && !key.startsWith('$'))
  if (nested.length) {
    throw new Error(`Unexpected requirement fields: ${nested.join(', ')}`)
  }

  return normalized
}

function parseRequirementNode(value: unknown, location: string): RequirementNode {
  if (!isObject(value)) {
    throw new Error(`Invalid requirement node at ${location}`)
  }

  const keys = Object.keys(value)
  if (!keys.length) {
    throw new Error(`Empty requirement node at ${location}`)
  }

  if (keys.length > 1) {
    throw new Error(`Requirement node has multiple keys at ${location}`)
  }

  const [key] = keys

  if (key === 'and' || key === 'or') {
    const valueForKey = (value as RawRequirementNode)[key]
    if (!Array.isArray(valueForKey)) {
      throw new Error(`Requirement node ${location} expected array for ${key}`)
    }

    return {
      [key]: valueForKey.map((entry, childIndex) => parseRequirementNode(entry, `${location}.${key}[${childIndex}]`)),
    } as RequirementNode
  }

  if (key === 'skill') {
    const text = parseScalarText((value as RawRequirementNode)[key])
    if (!text) {
      throw new Error(`Requirement node ${location} has empty skill`)
    }
    return { skill: text }
  }

  if (key === 'loadout') {
    const text = parseScalarText((value as RawRequirementNode)[key])
    if (!text) {
      throw new Error(`Requirement node ${location} has empty loadout`)
    }
    return { loadout: text }
  }

  if (key === 'agent') {
    const node = normalizeAgentRequirement((value as RawRequirementNode)[key])
    if (!node) {
      throw new Error(`Requirement node ${location} has invalid agent requirement`)
    }
    return node
  }

  if (key === 'model') {
    const node = normalizeModelRequirement((value as RawRequirementNode)[key])
    if (!node) {
      throw new Error(`Requirement node ${location} has invalid model requirement`)
    }
    return node
  }

  throw new Error(`Unexpected requirement key ${key} at ${location}`)
}

function normalizeAgentRequirement(value: unknown): { agent: { provider: string } } | undefined {
  if (!isObject(value)) {
    return undefined
  }

  const provider = parseScalarText(value.provider)
  if (!provider) {
    return undefined
  }

  return {
    agent: {
      provider: provider.toLowerCase(),
    },
  }
}

function normalizeModelRequirement(value: unknown): { model: { provider?: string; name?: string } } | undefined {
  if (!isObject(value)) {
    return undefined
  }

  const provider = parseScalarText(value.provider)
  const name = parseScalarText(value.name)

  if (!provider && !name) {
    return undefined
  }

  return {
    model: {
      ...(provider ? { provider: provider.toLowerCase() } : {}),
      ...(name ? { name } : {}),
    },
  }
}

export function evaluateRequirements(
  proofs: EvaluationProof[],
  provenCommits: string[],
  provenRepos: string[],
  requirements: NormalizedRequirements,
): CredentialRequirementResult {
  const proofSkills = [] as Array<{ id: string; version?: string }>
  const proofLoadouts = [] as string[]
  const proofAgents = [] as string[]
  const proofModels = [] as Array<{ provider?: string; name?: string }>

  const dedupedCommits = Array.from(new Set((provenCommits || []).filter(Boolean)))
  const dedupedRepos = Array.from(new Set((provenRepos || []).filter(Boolean)))

  for (const proofEntry of proofs) {
    const proof = proofEntry.proof
    for (const skill of proof.skills) {
      const parsed = parseIdentifierWithVersion(skill.id)
      if (parsed.id) {
        proofSkills.push({ id: parsed.id, version: parsed.version })
      }
    }

    for (const loadout of proof.loadouts) {
      const normalized = parseScalarText(loadout)
      if (normalized) {
        proofLoadouts.push(normalized)
      }
    }

    if (proof.agent?.provider && typeof proof.agent.provider === 'string') {
      proofAgents.push(proof.agent.provider)
    }

    const modelProvider = proof.model?.provider
    const modelName = proof.model?.name
    if (typeof modelProvider === 'string' || typeof modelName === 'string') {
      proofModels.push({ provider: modelProvider, name: modelName })
    }
  }

  const requirementResult = evaluateRequirementTree(requirements.tree, {
    skills: proofSkills,
    loadouts: proofLoadouts,
    agents: proofAgents,
    models: proofModels,
  })

  const checks = requirementResult.checks
  const resultReasons = [...failedRequirementReasons(checks)]

  if (requirements.minCommits > dedupedCommits.length) {
    resultReasons.push(`minimum required commits not met: have ${dedupedCommits.length}, need ${requirements.minCommits}`)
    requirementResult.passed = false
  }

  if (requirements.minRepositories > dedupedRepos.length) {
    resultReasons.push(`minimum required repositories not met: have ${dedupedRepos.length}, need ${requirements.minRepositories}`)
    requirementResult.passed = false
  }

  return {
    passed: requirementResult.passed,
    proofs,
    provenCommits: dedupedCommits,
    provenRepos: dedupedRepos,
    checks,
    reasons: resultReasons,
    noExplicitChecks: requirementResult.noExplicitChecks,
  }
}

function evaluateRequirementTree(
  node: RequirementNode,
  context: { skills: Array<{ id: string; version?: string }>; loadouts: string[]; agents: string[]; models: Array<{ provider?: string; name?: string }> },
): { passed: boolean; checks: RequirementCheck[]; noExplicitChecks: boolean } {
  if ('and' in node) {
    const checks: RequirementCheck[] = []
    const childResults = [] as { passed: boolean; checks: RequirementCheck[]; noExplicitChecks: boolean }[]
    let noExplicitChecks = true

    for (const child of node.and) {
      const childResult = evaluateRequirementTree(child, context)
      checks.push(...childResult.checks)
      childResults.push(childResult)
      if (!childResult.noExplicitChecks) {
        noExplicitChecks = false
      }
    }

    return {
      passed: childResults.every((entry) => entry.passed),
      checks,
      noExplicitChecks,
    }
  }

  if ('or' in node) {
    const checks: RequirementCheck[] = []
    const childResults = [] as { passed: boolean; checks: RequirementCheck[]; noExplicitChecks: boolean }[]
    let noExplicitChecks = true

    for (const child of node.or) {
      const childResult = evaluateRequirementTree(child, context)
      checks.push(...childResult.checks)
      childResults.push(childResult)
      if (!childResult.noExplicitChecks) {
        noExplicitChecks = false
      }
    }

    return {
      passed: childResults.some((entry) => entry.passed),
      checks,
      noExplicitChecks,
    }
  }

  if ('skill' in node) {
    const parsed = parseIdentifierWithVersion(node.skill)
    const satisfied = proofSkillsMatch(context.skills, parsed)
    return {
      passed: satisfied,
      checks: [{ type: 'skill', requirement: node.skill, satisfied }],
      noExplicitChecks: false,
    }
  }

  if ('loadout' in node) {
    const parsed = parseTextRequirement(node.loadout)
    const satisfied = context.loadouts.includes(node.loadout) || (parsed && parsed.id !== '' && context.loadouts.includes(parsed.id))

    return {
      passed: satisfied,
      checks: [{ type: 'loadout', requirement: node.loadout, satisfied }],
      noExplicitChecks: false,
    }
  }

  if ('agent' in node) {
    const expectedProvider = normalizeRequirementText(node.agent.provider)
    const satisfied = context.agents.some((provider) => provider === expectedProvider)
    return {
      passed: satisfied,
      checks: [{ type: 'agent', requirement: `provider=${expectedProvider}`, satisfied }],
      noExplicitChecks: false,
    }
  }

  if ('model' in node) {
    const expectedProvider = normalizeRequirementText(node.model.provider)
    const expectedName = normalizeRequirementText(node.model.name)
    const satisfied = context.models.some((candidate) => {
      const hasProvider = !expectedProvider || candidate.provider === expectedProvider
      const hasName = !expectedName || (candidate.name && candidate.name === expectedName)
      return hasProvider && hasName
    })

    const parts = [] as string[]
    if (expectedProvider) {
      parts.push(`provider=${expectedProvider}`)
    }
    if (expectedName) {
      parts.push(`name=${expectedName}`)
    }

    return {
      passed: satisfied,
      checks: [{ type: 'model', requirement: parts.join(',') || 'model', satisfied }],
      noExplicitChecks: false,
    }
  }

  throw new Error('Unknown requirement node encountered during evaluation')
}

function failedRequirementReasons(checks: RequirementCheck[]): string[] {
  return checks.filter((entry) => !entry.satisfied).map((entry) => `${entry.type} ${entry.requirement} not met`)
}

function proofSkillsMatch(proofSkills: Array<{ id: string; version?: string }>, parsed: { id: string; version?: string }): boolean {
  return proofSkills.some((skill) => matchesId(skill.id, skill.version, parsed))
}

function matchesId(actualId: string, actualVersion: string | undefined, expected: { id: string; version?: string }): boolean {
  if (actualId !== expected.id) {
    return false
  }

  if (!expected.version) {
    return true
  }

  return actualVersion === expected.version
}

function parseTextRequirement(value: unknown): { id: string; version?: string } {
  return parseIdentifierWithVersion(value)
}

function parseIdentifierWithVersion(value: unknown): { id: string; version?: string } {
  const trimmed = parseScalarText(value)
  if (!trimmed) {
    return { id: '' }
  }

  const parts = trimmed.split('@')
  return {
    id: parts[0],
    version: parts.length > 1 ? parts.slice(1).join('@') : undefined,
  }
}

function normalizeRequirementText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function parseScalarText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = value.trim()
  return text || undefined
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback
  }

  return Math.floor(value)
}

function isObject(value: unknown): value is RawRequirementNode {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCredentialIndexEntries(entries: unknown): CredentialIndexEntry[] {
  if (!Array.isArray(entries)) {
    return []
  }

  const normalized = [] as CredentialIndexEntry[]
  for (const entry of entries) {
    const normalizedEntry = normalizeCredentialIndexEntry(entry)
    if (normalizedEntry) {
      normalized.push(normalizedEntry)
    }
  }

  return normalized.sort((left, right) => left.id.localeCompare(right.id))
}

function normalizeCredentialIndexEntry(raw: unknown): CredentialIndexEntry | undefined {
  if (!isObject(raw)) {
    return undefined
  }

  const id = parseScalarText(raw.id)
  if (!id) {
    return undefined
  }

  try {
    return {
      id,
      name: parseScalarText(raw.name),
      description: parseScalarText(raw.description),
      requirements: normalizeRequirements(raw.requirements),
    }
  } catch {
    return undefined
  }
}

export async function getCredentialIndexEntries(options: CredentialIndexLoadOptions = {}): Promise<CredentialIndexEntry[]> {
  return loadCredentialIndex(options)
}
