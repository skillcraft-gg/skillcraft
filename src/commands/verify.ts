import { isEnabled } from '@/core/state'
import { gitLogWithMessages } from '@/core/git'
import { readProof } from '@/core/proof'
import { findUnpushedCommitsWithOptions, listRemotes } from '@/core/remote'
import { CommandError, emitJson, emitJsonError, getOutputMode, printBulletList, printHeader, printRows, printSection, printSuccess, printWarning } from '@/lib/output'

export async function runVerify(): Promise<void> {
  const repoPath = process.cwd()
  if (!(await isEnabled(repoPath))) {
    throw new Error('Repository is not enabled')
  }

  const messages = await gitLogWithMessages(repoPath, 200)
  const referenced = messages
    .map((entry: { message: string }) => {
      const match = entry.message.match(/Skillcraft-Ref:\s*(\S+)/)
      return match?.[1]
    })
    .filter(Boolean) as string[]

  let missing = 0
  const proofCommits: string[] = []
  const missingProofs: string[] = []
  const invalidProofs: string[] = []
  for (const id of referenced) {
    const proof = await readProof(repoPath, id)
    if (!proof) {
      missing += 1
      missingProofs.push(id)
      continue
    }
    if (!proof.commit || !proof.timestamp) {
      missing += 1
      invalidProofs.push(id)
      continue
    }

    proofCommits.push(proof.commit)
  }

  if (missing > 0) {
    if (getOutputMode() === 'json') {
      emitJsonError(new CommandError(`verify failed: ${missing} missing/invalid proofs`, 'VERIFY_FAILED'))
    } else {
      printHeader('Verify')
      printWarning(`verify failed: ${missing} missing/invalid proofs`)
      if (missingProofs.length) {
        printSection('Missing proof objects')
        printBulletList(missingProofs.map((id) => `missing proof object: ${id}`))
      }
      if (invalidProofs.length) {
        printSection('Invalid proof objects')
        printBulletList(invalidProofs.map((id) => `invalid proof object: ${id}`))
      }
    }
    process.exitCode = 1
    return
  }

  const remotes = await listRemotes(repoPath)
  const remoteResults: Array<{ remote: string; status: string; missingCommits: string[] }> = []

  if (remotes.length) {
    const sources = remotes.map((remote) => ({ repo: remote.url, commits: proofCommits }))
    const missingCommits = await findUnpushedCommitsWithOptions(sources, { normalize: false })

    const missingByRemote = new Map<string, string[]>()
    for (const { repo, commit } of missingCommits) {
      const missingForRemote = missingByRemote.get(repo)
      if (missingForRemote) {
        missingForRemote.push(commit)
      } else {
        missingByRemote.set(repo, [commit])
      }
    }

    const uniqueMissing = (remoteUrl: string): string[] => {
      const values = missingByRemote.get(remoteUrl)
      return values ? Array.from(new Set(values)) : []
    }

    for (const remote of remotes) {
      const missingHere = uniqueMissing(remote.url)
      remoteResults.push({
        remote: remote.url,
        status: missingHere.length > 0 ? 'missing' : 'ok',
        missingCommits: missingHere,
      })
    }
  }

  if (getOutputMode() === 'json') {
    emitJson({
      status: 'passed',
      referencedProofs: referenced.length,
      proofCommits,
      remotes: remoteResults,
      warnings: !remotes.length ? ['no git remotes configured for repository'] : remoteResults
        .filter((entry) => entry.missingCommits.length > 0)
        .map((entry) => `proof commits not pushed to ${entry.remote}: ${entry.missingCommits.join(', ')}`),
    })
    return
  }

  printHeader('Verify')
  printSuccess(`verify passed: ${referenced.length} commit proofs resolved`)

  if (!remotes.length) {
    printWarning('⚠️ Warning: no git remotes configured for repository')
    return
  }

  printSection('Remotes')
  for (const remote of remoteResults) {
    if (remote.missingCommits.length > 0) {
      printWarning(`⚠️ Warning: proof commits not pushed to ${remote.remote}: ${remote.missingCommits.join(', ')}`)
    } else {
      printRows([{ label: 'remote status', value: `${remote.remote} (all referenced proof commits present)`, tone: 'success' }])
    }
  }
}
