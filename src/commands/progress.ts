import { isEnabled } from '@/core/state'
import { gitLogWithMessages } from '@/core/git'
import { loadProofFromRepo } from '@/core/progress'
import { loadRepos } from '@/core/config'

function countProofRefs(messages: string[]): number {
  return messages.filter((message) => message.includes('Skillcraft-Ref:')).length
}

async function resolveTrackedRepos(): Promise<string[]> {
  const data = await loadRepos()
  const repoPaths = new Set<string>()
  const repos: string[] = []

  for (const entry of data.repos) {
    if (repoPaths.has(entry.path)) {
      continue
    }
    repoPaths.add(entry.path)

    if (await isEnabled(entry.path)) {
      repos.push(entry.path)
    }
  }

  return repos
}

export async function runProgress(): Promise<void> {
  const tracked = await resolveTrackedRepos()
  if (!tracked.length) {
    process.stdout.write('no tracked repositories\n')
    return
  }

  let commitProofRefs = 0
  let proofFiles = 0
  const skills = new Set<string>()
  const loadouts = new Set<string>()

  for (const repoPath of tracked) {
    const recent = await gitLogWithMessages(repoPath, 200)
    const messages = recent.map((entry) => entry.message)
    commitProofRefs += countProofRefs(messages)

    const proofs = await loadProofFromRepo(repoPath)
    proofFiles += proofs.length

    for (const proof of proofs) {
      proof.skills.forEach((item) => skills.add(item.id))
      proof.loadouts.forEach((item) => loadouts.add(item))
    }
  }

  process.stdout.write(`commits-with-proof: ${commitProofRefs}\n`)
  process.stdout.write(`proof files: ${proofFiles}\n`)
  process.stdout.write(`unique skills: ${skills.size}\n`)
  process.stdout.write(`unique loadouts: ${loadouts.size}\n`)

  if (skills.size) {
    process.stdout.write(`skills: ${Array.from(skills).join(', ')}\n`)
  }
  if (loadouts.size) {
    process.stdout.write(`loadouts: ${Array.from(loadouts).join(', ')}\n`)
  }
}
