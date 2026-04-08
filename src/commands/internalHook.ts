import { removeFile, writeJson } from '@/core/fs'
import { amendCommitMessage, gitHeadCommit, gitRoot, isGitRepo } from '@/core/git'
import { handleCodexAgentHook, normalizeAgentName } from '@/core/agents'
import { contextPath, pendingPath } from '@/core/paths'
import { buildCommitMessageWithProof, buildProofFromPending, pushProofBranch, writeProof } from '@/core/proof'
import { isEnabled } from '@/core/state'

export async function runHook(repoPath: string): Promise<void> {
  if (!(await isEnabled(repoPath))) {
    return
  }

  const commit = await gitHeadCommit(repoPath)
  const timestamp = new Date().toISOString()

  const result = await buildProofFromPending(repoPath, commit, timestamp)
  if (!result) {
    return
  }

  const message = await buildCommitMessageWithProof(repoPath, result.proofId)
  await amendCommitMessage(repoPath, message)

  const amendedCommit = await gitHeadCommit(repoPath)
  if (amendedCommit !== commit) {
    await writeProof(repoPath, {
      ...result.proof,
      commit: amendedCommit,
    })
  }

  await writeJson(pendingPath(repoPath), { skills: [] })
}

export async function runHookPush(repoPath: string, remote = 'origin'): Promise<void> {
  await pushProofBranch(repoPath, remote)
}

export async function runHookClear(repoPath: string): Promise<void> {
  await Promise.all([removeFile(pendingPath(repoPath)), removeFile(contextPath(repoPath))])
  process.stdout.write(`cleared hook state in ${repoPath}\n`)
}

export async function runAgentHook(agentName: string, repoPath?: string): Promise<void> {
  const agent = normalizeAgentName(agentName)
  if (!agent) {
    throw new Error(`Unsupported agent hook: ${agentName}`)
  }

  const payload = await readJsonFromStdin()
  const payloadCwd = payload && typeof payload === 'object' && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).cwd === 'string'
    ? String((payload as Record<string, unknown>).cwd)
    : undefined
  const targetRepo = await resolveHookRepoPath(payloadCwd || repoPath || process.cwd())

  if (agent === 'codex') {
    await handleCodexAgentHook(targetRepo, payload)
  }
}

async function readJsonFromStdin(): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) {
    return {}
  }
  return JSON.parse(raw)
}

async function resolveHookRepoPath(candidate: string): Promise<string> {
  if (await isGitRepo(candidate)) {
    return gitRoot(candidate)
  }
  return candidate
}
