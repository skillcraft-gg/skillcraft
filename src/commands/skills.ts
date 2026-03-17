import path from 'node:path'
import fs from 'node:fs/promises'
import { getProvider } from '@/providers'
import { loadGlobalConfig } from '@/core/config'
import { assertNonEmpty, splitArgPair, splitSkillIdentifier, normalizeSkillId } from '@/core/validation'
import { isEnabled } from '@/core/state'
import { loadProofFromRepo } from '@/core/progress'
import { loadPending, normalizeSkillIds } from '@/core/proof'
import { pendingPath } from '@/core/paths'
import { writeJson } from '@/core/fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ora from 'ora'

const execPromise = promisify(execFile)

type SearchIndexEntry = {
  id: string
  name?: string
  path?: string
  url?: string
  owner?: string
  slug?: string
  runtime?: string[]
  tags?: string[]
  updatedAt?: string
}

type SearchIndexOptions = {
  source?: string
  limit?: number
  outputMode?: 'text' | 'json'
}

type SearchResult = {
  id: string
  name?: string
  path?: string
  url?: string
  owner?: string
  slug?: string
  runtime?: string[]
  tags?: string[]
}

export async function runSkillsPublish(slug: string): Promise<void> {
  const ref = assertNonEmpty(slug, 'skill id')
  const { owner, slug: slugPart } = splitArgPair(ref)
  const cwd = process.cwd()
  if (!(await isEnabled(cwd))) {
    throw new Error('Repository is not enabled')
  }

  const files = await Promise.all([
    fs.access(path.join(cwd, 'SKILL.md')).then(() => true).catch(() => false),
    fs.access(path.join(cwd, 'skill.yaml')).then(() => true).catch(() => false),
  ])
  if (!files[0] || !files[1]) {
    throw new Error('SKILL.md and skill.yaml are required for publishing')
  }

  const config = await loadGlobalConfig()
  const provider = getProvider(config.provider ?? 'gh')
  await provider.getUser()

  const destination = 'skillcraft-gg/skills'
  const branch = `skillcraft-skill-${owner}-${slugPart}`
  const temp = path.join(process.cwd(), '.skillcraft-temp-skill-publish')

  try {
    await fs.rm(temp, { force: true, recursive: true })
    await provider.cloneRepo(destination, temp)
    await runGit(temp, ['checkout', '-B', branch])

    const target = path.join(temp, 'skills', owner, slugPart)
    await fs.rm(target, { force: true, recursive: true })
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.cp(cwd, target, { recursive: true })

    await runGit(temp, ['add', `skills/${owner}/${slugPart}`])
    await runGit(temp, ['commit', '-m', `Publish skill ${ref}`]).catch(() => {
      throw new Error('nothing to commit; skill may already be published')
    })
    await runGit(temp, ['push', '-u', 'origin', branch]).catch(() => {
      throw new Error('unable to push skill publish branch')
    })
    await provider.createPullRequest(destination, branch, `Publish skill: ${ref}`).catch(() => {
      process.stdout.write('unable to create PR automatically. Please open one manually from your branch.\n')
    })

    process.stdout.write(`published skill ${ref} from ${destination}\n`)
  } finally {
    await fs.rm(temp, { force: true, recursive: true })
  }
}

export async function runSkillsAdd(rawId: string): Promise<void> {
  const cwd = process.cwd()
  if (!(await isEnabled(cwd))) {
    throw new Error('Repository is not enabled')
  }

  const cleanInput = assertNonEmpty(rawId, 'skill id')
  const parsed = splitSkillIdentifier(cleanInput)
  if (!parsed.id) {
    throw new Error('invalid skill id format')
  }

  const index = await loadSearchIndex()
  if (!index.has(parsed.id)) {
    throw new Error(`skill ${parsed.id} is not listed in the search index`)
  }

  const normalized = normalizeSkillIds([`${parsed.id}${parsed.version ? `@${parsed.version}` : ''}`])
  const existing = await loadPending(cwd)
  const next = normalizeSkillIds([...existing, ...normalized])

  await writeJson(pendingPath(cwd), { skills: next })
  process.stdout.write(`queued skill: ${normalized[0]}\n`)
}

export async function runSkillsValidate(): Promise<void> {
  const cwd = process.cwd()
  const checks = [
    ['SKILL.md', await exists(path.join(cwd, 'SKILL.md'))],
    ['skill.yaml', await exists(path.join(cwd, 'skill.yaml'))],
  ]
  for (const [name, ok] of checks) {
    process.stdout.write(`${name}: ${ok ? 'ok' : 'missing'}\n`)
  }
}

export async function runSkillsList(): Promise<void> {
  const cwd = process.cwd()
  if (!(await isEnabled(cwd))) {
    throw new Error('Repository is not enabled')
  }

  const [proofs, pending] = await Promise.all([loadProofFromRepo(cwd), loadPending(cwd)])
  const skills = new Set<string>()
  for (const proof of proofs) {
    for (const item of proof.skills) {
      skills.add(item.id)
    }
  }
  for (const skill of pending) {
    skills.add(skill)
  }

  if (!skills.size) {
    process.stdout.write('no skills detected\n')
    return
  }

  const list = Array.from(skills).sort().join('\n')
  process.stdout.write(`skills detected (${skills.size}):\n${list}\n`)
}

export async function runSkillsSearch(rawQuery?: string, options: SearchIndexOptions = {}): Promise<void> {
  const entries = await loadSearchIndexEntries(options.outputMode)
  if (!entries.length) {
    if (options.outputMode === 'json') {
      process.stdout.write(`${JSON.stringify({
        query: rawQuery?.trim(),
        source: options.source?.trim(),
        limit: getSearchLimit(options.limit),
        count: 0,
        results: [],
        message: 'no skills indexed',
      })}\n`)
    } else {
      process.stdout.write('no skills indexed\n')
    }
    return
  }

  const query = rawQuery?.trim().toLowerCase()
  const sourceFilter = options.source?.trim().toLowerCase()
  const limit = getSearchLimit(options.limit)

  const filtered = entries.filter((entry) => {
    if (sourceFilter) {
      const source = getSkillSource(entry.id)
      if (source !== sourceFilter) {
        return false
      }
    }

    if (!query) {
      return true
    }

    const fields = [
      entry.id,
      entry.name,
      entry.owner,
      entry.slug,
      entry.path,
      entry.url,
      ...(entry.runtime || []),
      ...(entry.tags || []),
    ].filter((value): value is string => !!value).map((value) => value.toLowerCase())

    return fields.some((value) => value.includes(query))
  })

  const sorted = [...filtered].sort((left, right) => {
    const leftName = (left.name || left.id).toLowerCase()
    const rightName = (right.name || right.id).toLowerCase()
    if (leftName === rightName) {
      return left.id.localeCompare(right.id)
    }
    return leftName.localeCompare(rightName)
  })

  const shown = sorted.slice(0, limit)
  if (!shown.length) {
    const message = query ? `no skills match "${rawQuery?.trim()}"` : 'no skills match current filters'
    if (options.outputMode === 'json') {
      process.stdout.write(`${JSON.stringify({
        query: rawQuery?.trim(),
        source: options.source?.trim(),
        limit,
        count: 0,
        results: [],
        message,
      })}\n`)
    } else {
      process.stdout.write(`${message}\n`)
    }
    return
  }

  const title = query ? `skills matching "${rawQuery?.trim()}"` : 'skills index'
  const lines = shown.map((entry) => {
    const runtime = (entry.runtime || []).length ? ` [${entry.runtime!.join(', ')}]` : ''
    const tags = (entry.tags || []).length ? ` {${entry.tags!.join(', ')}}` : ''
    const updatedLabel = formatUpdatedAt(entry.updatedAt)
    const name = formatSearchResultName(entry)
    return `${entry.id}${name ? ` — ${name}` : ''}${runtime}${tags}${updatedLabel}`
  })

  if (options.outputMode === 'json') {
    const payload = {
      query: rawQuery?.trim(),
      source: options.source?.trim(),
      limit,
      count: shown.length,
      total: sorted.length,
      results: shown.map((entry) => {
        const row: SearchResult = {
          id: entry.id,
          name: entry.name,
          path: entry.path,
          url: entry.url,
          owner: entry.owner,
          slug: entry.slug,
          runtime: entry.runtime,
          tags: entry.tags,
        }
        return row
      }),
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`)
    return
  }

  process.stdout.write(`${title} (${shown.length}):\n${lines.join('\n')}\n`)
}

function isJson(value: unknown): value is SearchIndexEntry[] {
  return Array.isArray(value)
}

async function loadSearchIndex(): Promise<Set<string>> {
  const entries = await loadSearchIndexEntries()
  return new Set(entries.map((entry) => entry.id))
}

async function loadSearchIndexEntries(outputMode: SearchIndexOptions['outputMode'] = undefined): Promise<SearchIndexEntry[]> {
  const explicitPath = process.env.SKILLCRAFT_SEARCH_INDEX_PATH?.trim()
  const source = explicitPath || process.env.SKILLCRAFT_SEARCH_INDEX_URL || 'https://skillcraft.gg/skills/search/index.json'
  const loadEntries = async () => {
    if (explicitPath) {
      const raw = await fs.readFile(explicitPath, 'utf8')
      const parsed = JSON.parse(raw)
      return normalizeSearchIndexEntries(isJson(parsed) ? parsed : [])
    }

    const url = process.env.SKILLCRAFT_SEARCH_INDEX_URL || 'https://skillcraft.gg/skills/search/index.json'
    const response = await fetch(url, {
      headers: {
        'user-agent': 'skillcraft-cli',
      },
    })
    if (!response.ok) {
      throw new Error(`failed to download search index from ${url}`)
    }

    const parsed = await response.json()
    return normalizeSearchIndexEntries(isJson(parsed) ? parsed : [])
  }

  if (!shouldShowSearchSpinner(outputMode)) {
    return loadEntries()
  }

  const action = explicitPath ? `reading local index from ${source}` : `downloading index from ${source}`
  const spinner = ora({
    text: `Loading ${action}...`,
  }).start()

  try {
    const entries = await loadEntries()
    spinner.succeed(`loaded ${entries.length} indexed entries`)
    return entries
  } catch (error) {
    spinner.fail('failed to load search index')
    throw error
  }
}

function shouldShowSearchSpinner(outputMode: SearchIndexOptions['outputMode']): boolean {
  if (outputMode !== 'text') {
    return false
  }

  return process.stdout.isTTY === true || process.stderr.isTTY === true
}

function normalizeSearchIndexEntries(entries: SearchIndexEntry[]): SearchIndexEntry[] {
  return entries
    .map((entry) => normalizeSearchIndexEntry(entry))
    .filter((entry): entry is SearchIndexEntry => !!entry)
}

function normalizeSearchIndexEntry(raw: SearchIndexEntry): SearchIndexEntry | undefined {
  const rawId = normalizeString(raw.id)
  const id = normalizeSkillId(rawId)
  if (!id) {
    return undefined
  }

  return {
    id,
    name: normalizeText(raw.name),
    path: normalizeText(raw.path),
    url: normalizeText(raw.url),
    owner: normalizeText(raw.owner),
    slug: normalizeText(raw.slug),
    runtime: normalizeStringArray(raw.runtime),
    tags: normalizeStringArray(raw.tags),
    updatedAt: normalizeText(raw.updatedAt),
  }
}

function normalizeString(value: unknown): string {
  return String(value || '').trim()
}

function normalizeText(value: unknown): string | undefined {
  const text = normalizeString(value)
  return text || undefined
}

function normalizeStringArray(value: unknown): string[] {
  if (value === undefined) {
    return []
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (!Array.isArray(value)) {
    return []
  }

  const normalized: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }
    const text = item.trim()
    if (text) {
      normalized.push(text)
    }
  }
  return normalized
}

function getSkillSource(id: string): string | undefined {
  const separatorIndex = id.indexOf(':')
  if (separatorIndex < 1) {
    return undefined
  }

  const source = id.slice(0, separatorIndex).trim()
  if (!source) {
    return undefined
  }

  return source.toLowerCase()
}

function getSearchLimit(raw: number | undefined): number {
  const requestedLimit = raw === undefined ? 20 : Math.floor(raw)
  return Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20
}

function formatSearchResultName(entry: SearchIndexEntry): string {
  const name = (entry.name || '').trim()
  if (!name) {
    return ''
  }

  const slug = deriveSearchResultSlug(entry)
  if (!slug) {
    return name
  }

  if (name.toLowerCase() === slug.toLowerCase()) {
    return ''
  }

  return name
}

function deriveSearchResultSlug(entry: SearchIndexEntry): string {
  if (entry.slug && entry.slug.trim()) {
    return entry.slug.trim()
  }

  const id = entry.id.trim()
  const separator = id.indexOf(':')
  const suffix = separator >= 0 ? id.slice(separator + 1) : id
  const parts = suffix.split('/').filter(Boolean)

  return parts.length ? parts.at(-1) : suffix
}

function formatUpdatedAt(value?: string): string {
  if (!value) {
    return ''
  }

  const updatedAt = new Date(value)
  if (Number.isNaN(updatedAt.getTime())) {
    return ''
  }

  return ` (updated ${updatedAt.toISOString().slice(0, 10)})`
}

async function exists(pathToCheck: string): Promise<boolean> {
  try {
    await fs.access(pathToCheck)
    return true
  } catch {
    return false
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execPromise('git', args, { cwd })
  return stdout.trim()
}

export async function runSkillsValidateAndExit(): Promise<void> {
  await runSkillsValidate()
}
