import { loadProofsFromRepo } from './proof.js'
import type { Proof } from './types.js'

export async function loadProofFromRepo(repoPath: string): Promise<Proof[]> {
  return loadProofsFromRepo(repoPath)
}
