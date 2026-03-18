import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { ensureDir, readJson, writeJson } from './fs.js'
import { pendingPath, contextPath } from './paths.js'
import { DefaultProofRef, PendingSchema, ContextSchema, type Proof } from './types.js'
import { git, gitCommitMessage, gitHasRef, gitLsTreeNames, gitRemote, gitShowText } from './git.js'
import { isValidSkillIdentifier, splitSkillIdentifier } from './validation.js'
import { loadLocalConfig } from './config.js'

const PROOFS_DIR = 'proofs'

function normalizeProofBranch(proofRef?: string): string {
  const clean = proofRef?.trim() || DefaultProofRef
  return clean.replace(/^refs\/heads\//, '')
}

function proofPathForId(proofId: string): string {
  return `${PROOFS_DIR}/${proofId}.json`
}

async function proofBranch(repoPath: string): Promise<string> {
  const config = await loadLocalConfig(repoPath)
  return normalizeProofBranch(config.proofRef)
}

async function proofSearchRefs(repoPath: string, branch: string): Promise<string[]> {
  const normalized = normalizeProofBranch(branch)
  const localRef = `refs/heads/${normalized}`
  const remoteRef = `refs/remotes/origin/${normalized}`
  const refs = [] as string[]

  if (await gitHasRef(repoPath, localRef)) {
    refs.push(normalized)
  }
  if (await gitHasRef(repoPath, remoteRef)) {
    refs.push(`origin/${normalized}`)
  }

  if (!refs.length) {
    refs.push(normalized)
  }

  return refs
}

async function ensureProofBranch(repoPath: string, branch: string): Promise<void> {
  const fullRef = `refs/heads/${branch}`
  if (await gitHasRef(repoPath, fullRef)) {
    return
  }

  await git(['branch', branch], repoPath)
}

async function withProofWorktree<T>(repoPath: string, branch: string, action: (worktree: string) => Promise<T>): Promise<T> {
  await removeProofWorktrees(repoPath, branch)
  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'skillcraft-proof-'))

  try {
    await git(['worktree', 'add', '--quiet', worktree, branch], repoPath)
    return await action(worktree)
  } finally {
    await removeProofWorktree(repoPath, worktree)
  }
}

async function removeProofWorktree(repoPath: string, worktreePath: string): Promise<void> {
  try {
    await git(['worktree', 'remove', '--force', worktreePath], repoPath)
  } catch {
    await fs.rm(worktreePath, { force: true, recursive: true })
  }
}

async function removeProofWorktrees(repoPath: string, branch: string): Promise<void> {
  const targetRef = `refs/heads/${branch}`

  try {
    const raw = await git(['worktree', 'list', '--porcelain'], repoPath)
    const lines = raw.split('\n')
    let currentWorktree: string | undefined
    let currentBranch: string | undefined

    const maybeRemove = async () => {
      if (!currentWorktree || currentBranch !== targetRef) {
        return
      }
      await removeProofWorktree(repoPath, currentWorktree)
    }

    for (const line of lines) {
      if (!line) {
        currentWorktree = undefined
        currentBranch = undefined
        continue
      }

      if (line.startsWith('worktree ')) {
        await maybeRemove()
        currentWorktree = line.slice(9)
        currentBranch = undefined
        continue
      }

      if (line.startsWith('branch ')) {
        currentBranch = line.slice(7)
      }
    }

    await maybeRemove()
  } catch {
    return
  }
}

export async function loadProofsFromRepo(repoPath: string): Promise<Proof[]> {
  const branch = await proofBranch(repoPath)
  const searchRefs = await proofSearchRefs(repoPath, branch)
  const files = new Set<string>()

  for (const proofRef of searchRefs) {
    const listed = await gitLsTreeNames(repoPath, proofRef, PROOFS_DIR)
    for (const file of listed) {
      files.add(file)
    }
  }

  const proofs: Proof[] = []

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue
    }

    const proofId = path.basename(file, '.json')
    const proof = await readProof(repoPath, proofId)
    if (proof) {
      proofs.push(proof)
    }
  }

  return proofs
}

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
  const branch = await proofBranch(repoPath)
  const file = proofPathForId(proofId)
  const searchRefs = await proofSearchRefs(repoPath, branch)

  for (const proofRef of searchRefs) {
    const payload = await gitShowText(repoPath, proofRef, file)
    if (!payload) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }

    const proof = parseProof(parsed)
    if (proof) {
      return proof
    }
  }

  return undefined
}

export async function writeProof(repoPath: string, proof: Proof): Promise<string> {
  const proofId = buildProofId(proof.skills.map((skill) => skill.id), proof.timestamp, proof.loadouts)
  const branch = await proofBranch(repoPath)
  await ensureProofBranch(repoPath, branch)

  const proofFile = proofPathForId(proofId)
  await withProofWorktree(repoPath, branch, async (worktree) => {
    await ensureDir(path.join(worktree, PROOFS_DIR))
    await writeJson(path.join(worktree, proofFile), proof)
    await git(['add', proofFile], worktree, { env: { ...process.env, SKILLCRAFT_HOOK_DISABLED: '1' } })

    const status = await git(
      ['status', '--porcelain', '--', proofFile],
      worktree,
      { env: { ...process.env, SKILLCRAFT_HOOK_DISABLED: '1' } },
    )
    if (!status) {
      return
    }

    await git(
      ['commit', '--no-gpg-sign', '-m', `add Skillcraft proof ${proofId}`],
      worktree,
      { env: { ...process.env, SKILLCRAFT_HOOK_DISABLED: '1' } },
    )
  })

  return proofId
}

export async function pushProofBranch(repoPath: string, remoteName = 'origin'): Promise<void> {
  const branch = await proofBranch(repoPath)
  const remote = await gitRemote(repoPath, remoteName)
  if (!remote || !remoteName) {
    return
  }

  try {
    await git(['push', remoteName, `${branch}:${branch}`], repoPath, { env: { ...process.env, SKILLCRAFT_HOOK_DISABLED: '1' } })
  } catch {
    return
  }
}

export async function currentProofIdForCommit(repoPath: string, commit: string): Promise<string | undefined> {
  const proofs = await loadProofsFromRepo(repoPath)

  for (const proof of proofs) {
    if (proof.commit === commit) {
      return buildProofId(
        proof.skills.map((skill) => skill.id),
        proof.timestamp,
        proof.loadouts,
      )
    }
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
