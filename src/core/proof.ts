import { createHash } from 'node:crypto'
import path from 'node:path'
import { ensureDir, readJson, writeJson } from './fs.js'
import { localProofsDir, pendingPath, contextPath } from './paths.js'
import { PendingSchema, ContextSchema, type Proof } from './types.js'
import { gitCommitMessage } from './git.js'
import { isValidSkillIdentifier, splitSkillIdentifier } from './validation.js'

function parseSkillFromRaw(value: string): { id: string; version?: string } | undefined {
  const parsed = splitSkillIdentifier(value)
  if (!parsed.id) {
    return undefined
  }

  if (!isValidSkillIdentifier(parsed.id)) {
    return undefined
  }

  return {
    id: parsed.id,
    version: parsed.version,
  }
}

export function normalizeSkillIds(raw: string[]): string[] {
  const normalized = raw
    .filter(Boolean)
    .map((item) => splitSkillIdentifier(item))
    .filter((entry): entry is { id: string; version?: string; slug: string } => !!entry.id)
    .map((entry) => `${entry.id}${entry.version ? `@${entry.version}` : ''}`)

  return Array.from(new Set(normalized)).filter(isValidSkillIdentifier).sort()
}

export function buildProofId(skills: string[], timestamp: string, loadouts: string[]): string {
  const normalized = {
    skills,
    loadouts,
    timestamp,
  }
  const digest = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
  return digest.slice(0, 8)
}

export async function loadPending(repoPath: string): Promise<string[]> {
  const raw = await readJson<unknown>(pendingPath(repoPath))
  const parsed = PendingSchema.safeParse(raw ?? { skills: [] })
  return parsed.success ? normalizeSkillIds(parsed.data.skills) : []
}

export async function loadContext(repoPath: string): Promise<string[]> {
  const raw = await readJson<unknown>(contextPath(repoPath))
  const parsed = ContextSchema.safeParse(raw ?? { activeLoadouts: [] })
  return parsed.success ? parsed.data.activeLoadouts : []
}

export function parseProof(payload: unknown): Proof | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined
  }
  const record = payload as Record<string, unknown>
  if (typeof record.version !== 'number' || typeof record.commit !== 'string' || !Array.isArray(record.skills)) {
    return undefined
  }
  if (!record.timestamp || typeof record.timestamp !== 'string') {
    return undefined
  }
  const loadouts = Array.isArray(record.loadouts) ? record.loadouts.map(String) : []
  const skills = record.skills
    .map((entry) => {
      if (typeof entry === 'string') {
        return { id: entry }
      }
      if (entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string') {
        return { id: entry.id, version: typeof entry.version === 'string' ? entry.version : undefined }
      }
      return undefined
    })
    .filter((entry): entry is { id: string; version?: string } => !!entry)
  return {
    version: record.version,
    commit: record.commit,
    skills,
    loadouts,
    timestamp: record.timestamp,
  }
}

export async function readProof(repoPath: string, proofId: string): Promise<Proof | undefined> {
  const file = path.join(localProofsDir(repoPath), `${proofId}.json`)
  const payload = await readJson<unknown>(file)
  return parseProof(payload)
}

export async function writeProof(repoPath: string, proof: Proof): Promise<string> {
  const proofId = buildProofId(proof.skills.map((skill) => skill.id), proof.timestamp, proof.loadouts)
  await ensureDir(localProofsDir(repoPath))
  const proofFile = path.join(localProofsDir(repoPath), `${proofId}.json`)
  await writeJson(proofFile, proof)
  return proofId
}

export async function currentProofIdForCommit(repoPath: string, commit: string): Promise<string | undefined> {
  const dir = localProofsDir(repoPath)
  try {
    const files = await import('node:fs/promises').then((m) => m.readdir(dir))
    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue
      }
      const proof = await readProof(repoPath, file.replace('.json', ''))
      if (proof?.commit === commit) {
        return file.replace('.json', '')
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

export async function buildProofFromPending(
  repoPath: string,
  commit: string,
  timestamp: string = new Date().toISOString(),
): Promise<{ proofId: string; proof: Proof } | undefined> {
  const pending = await loadPending(repoPath)
  if (!pending.length) {
    return undefined
  }
  const loadouts = await loadContext(repoPath)

  const proof: Proof = {
    version: 1,
    commit,
    skills: pending
      .map((skill) => parseSkillFromRaw(skill))
      .filter((entry): entry is { id: string; version?: string } => !!entry),
    loadouts,
    timestamp,
  }

  const proofId = await writeProof(repoPath, proof)
  return { proofId, proof }
}

export async function stripDraftMessage(message: string): Promise<string> {
  return message
    .replace(/\nSkillcraft-Ref: .*$/gm, '')
    .trimEnd()
}

export async function buildCommitMessageWithProof(repoPath: string, proofId: string): Promise<string> {
  const existing = await gitCommitMessage(repoPath)
  const cleaned = await stripDraftMessage(existing)
  if (cleaned.includes('Skillcraft-Ref:')) {
    return cleaned
  }
  return `${cleaned}\n\nSkillcraft-Ref: ${proofId}\n`
}
