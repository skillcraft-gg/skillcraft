import { isEnabled } from '@/core/state'
import { gitLogWithMessages } from '@/core/git'
import { loadProofFromRepo } from '@/core/progress'

function countProofRefs(messages: string[]): number {
  return messages.filter((message) => message.includes('Skillcraft-Ref:')).length
}

export async function runProgress(repoPathArg?: unknown): Promise<void> {
  const repoPath = typeof repoPathArg === 'string' && repoPathArg ? repoPathArg : process.cwd()
  if (!(await isEnabled(repoPath))) {
    throw new Error('Repository is not enabled for Skillcraft')
  }
  const recent = await gitLogWithMessages(repoPath, 200)
  const messages = recent.map((entry) => entry.message)
  const total = countProofRefs(messages)
  const proofs = await loadProofFromRepo(repoPath)
  process.stdout.write(`commits-with-proof: ${total}\n`)
  process.stdout.write(`proof files: ${proofs.length}\n`)

  const skills = new Set<string>()
  const loadouts = new Set<string>()
  for (const proof of proofs) {
    proof.skills.forEach((item) => skills.add(item.id))
    proof.loadouts.forEach((item) => loadouts.add(item))
  }
  process.stdout.write(`unique skills: ${skills.size}\n`)
  process.stdout.write(`unique loadouts: ${loadouts.size}\n`)

  if (skills.size) {
    process.stdout.write(`skills: ${Array.from(skills).join(', ')}\n`)
  }
  if (loadouts.size) {
    process.stdout.write(`loadouts: ${Array.from(loadouts).join(', ')}\n`)
  }
}
