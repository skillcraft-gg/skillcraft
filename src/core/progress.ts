import fs from 'node:fs/promises'
import { localProofsDir } from './paths.js'
import { fileExists, readJson } from './fs.js'
import { Proof } from './types.js'
import { parseProof } from './proof.js'

export async function loadProofFromRepo(repoPath: string): Promise<Proof[]> {
  const dir = localProofsDir(repoPath)
  if (!(await fileExists(dir))) {
    return []
  }

  const entries = await fs.readdir(dir)
  const proofs: Proof[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue
    }
    const payload = await readJson<unknown>(`${dir}/${entry}`)
    const proof = parseProof(payload)
    if (proof) {
      proofs.push(proof)
    }
  }
  return proofs
}
