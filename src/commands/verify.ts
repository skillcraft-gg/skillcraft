import { isEnabled } from '@/core/state'
import { gitLogWithMessages } from '@/core/git'
import { readProof } from '@/core/proof'
import { findUnpushedCommitsWithOptions, listRemotes } from '@/core/remote'

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
  for (const id of referenced) {
    const proof = await readProof(repoPath, id)
    if (!proof) {
      missing += 1
      process.stdout.write(`missing proof object: ${id}\n`)
      continue
    }
    if (!proof.commit || !proof.timestamp) {
      missing += 1
      process.stdout.write(`invalid proof object: ${id}\n`)
      continue
    }

    proofCommits.push(proof.commit)
  }

  if (missing > 0) {
    process.stdout.write(`verify failed: ${missing} missing/invalid proofs\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write(`verify passed: ${referenced.length} commit proofs resolved\n`)

  const remotes = await listRemotes(repoPath)
  if (!remotes.length) {
    process.stdout.write('⚠️ Warning: no git remotes configured for repository\n')
    return
  }

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
    if (missingHere.length > 0) {
      process.stdout.write(`⚠️ Warning: proof commits not pushed to ${remote.url}: ${missingHere.join(', ')}\n`)
    } else {
      process.stdout.write(`remote status: ${remote.url} (all referenced proof commits present)\n`)
    }
  }
}
