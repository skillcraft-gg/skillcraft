import { isEnabled } from '@/core/state'
import { localProofsDir } from '@/core/paths'
import { fileExists, readJson } from '@/core/fs'
import { parseProof } from '@/core/proof'
import { gitLogWithMessages } from '@/core/git'

export async function runVerify(): Promise<void> {
  const repoPath = process.cwd()
  if (!(await isEnabled(repoPath))) {
    throw new Error('Repository is not enabled')
  }

  const proofDir = localProofsDir(repoPath)
  const dirExists = await fileExists(proofDir)
  if (!dirExists) {
    throw new Error('No proof directory found. Run commits with pending events.')
  }

  const messages = await gitLogWithMessages(repoPath, 200)
  const referenced = messages
    .map((entry) => {
      const match = entry.message.match(/Skillcraft-Ref:\s*(\S+)/)
      return match?.[1]
    })
    .filter(Boolean) as string[]

  let missing = 0
  for (const id of referenced) {
    const file = `${proofDir}/${id}.json`
    const payload = await readJson<unknown>(file)
    const proof = parseProof(payload)
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
