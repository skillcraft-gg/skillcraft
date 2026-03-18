import { isEnabled } from '@/core/state'
import { gitLogWithMessages } from '@/core/git'
import { readProof } from '@/core/proof'

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
    }
  }

  if (missing > 0) {
    process.stdout.write(`verify failed: ${missing} missing/invalid proofs\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write(`verify passed: ${referenced.length} commit proofs resolved\n`)
}
