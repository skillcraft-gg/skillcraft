import { buildProofFromPending, buildCommitMessageWithProof, pushProofBranch } from '@/core/proof'
import { isEnabled } from '@/core/state'
import { removeFile, writeJson } from '@/core/fs'
import { pendingPath, contextPath } from '@/core/paths'
import { amendCommitMessage, gitHeadCommit } from '@/core/git'
import { writeProof } from '@/core/proof'

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
  await Promise.all([removeFile(pendingPath(repoPath)), removeFile(contextPath(repoPath)),])
  process.stdout.write(`cleared hook state in ${repoPath}\n`)
}
