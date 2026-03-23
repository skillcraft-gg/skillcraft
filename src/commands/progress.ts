import { isEnabled } from '@/core/state'
import { gitRemote } from '@/core/git'
import { loadProofFromRepo } from '@/core/progress'
import { addTrackedCredential, loadRepos, loadTrackedCredentials, removeTrackedCredential } from '@/core/config'
import { assertNonEmpty } from '@/core/validation'
import { evaluateRequirements, getCredentialIndexEntries, type CredentialIndexEntry, type CredentialRequirementResult, type RequirementCheck } from '@/core/credentials'
import { printLines } from '@/lib/output'

type ProgressOutputMode = {
  outputMode?: 'text' | 'json'
  refreshIndex?: boolean
}

type EvaluatedCredentialResult = {
  credentialId: string
  name?: string
  description?: string
  passed: boolean
  status: 'eligible' | 'blocked'
  reasons: string[]
  checks: RequirementCheck[]
  requiredMinCommits: number
  requiredMinRepositories: number
  provenCommits: number
  provenRepositories: number
  proofFiles: number
}

type ProgressPayload = {
  trackedCredentials: number
  trackedRepositories: number
  evidence: {
    proofFiles: number
    provenCommits: number
    provenRepositories: number
  }
  credentials: EvaluatedCredentialResult[]
}

type ProofEntry = {
  proof: {
    commit: string
    loadouts: string[]
    skills: Array<{ id: string; version?: string }>
    agent?: { provider?: string }
    model?: { provider?: string; name?: string }
    version: number
    timestamp: string
  }
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

export async function runProgress(options: ProgressOutputMode = {}): Promise<void> {
  const tracked = await resolveTrackedRepos()
  const trackedCredentials = await loadTrackedCredentials()

  const trackedCredList = trackedCredentials.credentials
  if (!trackedCredList.length) {
    if (options.outputMode === 'json') {
      printJsonResult(
        buildPayload({
          tracked,
          trackedCredentialsCount: 0,
          proofFiles: 0,
          provenCommits: 0,
          provenRepositories: 0,
          evaluated: [],
        }),
      )
      return
    }
    process.stdout.write('no credentials tracked\n')
    return
  }

  const indexById = mapCredentials(await getCredentialIndexEntries({ refresh: options.refreshIndex }))

  let proofFiles = 0
  const proofs: ProofEntry[] = []
  const provenRepos = new Set<string>()
  const provenCommits = new Set<string>()

  for (const repoPath of tracked) {
    const proofsInRepo = await loadProofFromRepo(repoPath)
    proofFiles += proofsInRepo.length

    if (!proofsInRepo.length) {
      continue
    }

    const remote = (await gitRemote(repoPath)) || repoPath
    provenRepos.add(remote)

    for (const proof of proofsInRepo) {
      if (proof?.commit) {
        provenCommits.add(proof.commit)
      }
      proofs.push({ proof })
    }
  }

  const provenCommitList = Array.from(provenCommits)
  const provenRepoList = Array.from(provenRepos)

  const payload = buildPayload({
    tracked,
    trackedCredentialsCount: trackedCredList.length,
    proofFiles,
    provenCommits: provenCommitList.length,
    provenRepositories: provenRepoList.length,
    evaluated: [],
  })

  const evaluated = [] as EvaluatedCredentialResult[]
  for (const entry of trackedCredList) {
    const definition = indexById.get(entry.id)
    if (!definition) {
      evaluated.push(makeMissingDefinitionResult(entry.id, proofs.length, provenCommitList.length, provenRepoList.length))
      continue
    }

    const result = evaluateRequirements(proofs, provenCommitList, provenRepoList, definition.requirements)
    evaluated.push(formatResult(entry.id, definition, result, proofs.length, provenCommitList.length, provenRepoList.length))
  }

  payload.credentials = evaluated

  if (options.outputMode === 'json') {
    printJsonResult(payload)
    return
  }

  const lines = [] as string[]
  lines.push(`tracked credentials: ${trackedCredList.length}`)
  lines.push(`tracked repositories: ${tracked.length}`)
  lines.push(`proof files: ${proofFiles}`)
  lines.push(`proof commits: ${provenCommitList.length}`)
  lines.push(`proof repositories: ${provenRepoList.length}`)
  lines.push('')

  for (const entry of evaluated) {
    lines.push(`${entry.credentialId}: ${entry.status}`)
    lines.push(`  checks: ${entry.passed ? 'passed' : 'blocked'}`)
    lines.push(`  proof scope: ${entry.proofFiles} proofs, ${entry.provenCommits}/${entry.requiredMinCommits} commits, ${entry.provenRepositories}/${entry.requiredMinRepositories} repositories`)
    if (entry.reasons.length) {
      lines.push('  reasons:')
      for (const reason of entry.reasons) {
        lines.push(`    - ${reason}`)
      }
    }
    lines.push('')
  }

  printLines(lines)
}

export async function runProgressTrack(rawId: string): Promise<void> {
  const id = assertNonEmpty(rawId, 'credential id')
  const indexById = mapCredentials(await getCredentialIndexEntries())
  if (!indexById.has(id)) {
    throw new Error(`credential not found in credential index: ${id}`)
  }

  const added = await addTrackedCredential(id)
  if (!added) {
    process.stdout.write(`credential already tracked: ${id}\n`)
    return
  }
  process.stdout.write(`tracking credential: ${id}\n`)
}

export async function runProgressUntrack(rawId: string): Promise<void> {
  const id = assertNonEmpty(rawId, 'credential id')
  const removed = await removeTrackedCredential(id)
  if (!removed) {
    process.stdout.write(`credential not tracked: ${id}\n`)
    return
  }
  process.stdout.write(`untracked credential: ${id}\n`)
}

function buildPayload(params: {
  tracked: string[]
  trackedCredentialsCount: number
  proofFiles: number
  provenCommits: number
  provenRepositories: number
  evaluated: EvaluatedCredentialResult[]
}): ProgressPayload {
  return {
    trackedCredentials: params.trackedCredentialsCount,
    trackedRepositories: params.tracked.length,
    evidence: {
      proofFiles: params.proofFiles,
      provenCommits: params.provenCommits,
      provenRepositories: params.provenRepositories,
    },
    credentials: params.evaluated,
  }
}

function printJsonResult(payload: ProgressPayload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function mapCredentials(index: CredentialIndexEntry[]): Map<string, CredentialIndexEntry> {
  return new Map(index.map((entry) => [entry.id, entry]))
}

function makeMissingDefinitionResult(
  credentialId: string,
  proofFiles: number,
  provenCommits: number,
  provenRepositories: number,
): EvaluatedCredentialResult {
  return {
    credentialId,
    passed: false,
    status: 'blocked',
    reasons: ['credential definition is not available'],
    checks: [],
    requiredMinCommits: 0,
    requiredMinRepositories: 0,
    provenCommits,
    provenRepositories,
    proofFiles,
  }
}

function formatResult(
  credentialId: string,
  definition: CredentialIndexEntry,
  result: CredentialRequirementResult,
  proofFiles: number,
  provenCommits: number,
  provenRepositories: number,
): EvaluatedCredentialResult {
  return {
    credentialId,
    name: definition.name,
    description: definition.description,
    passed: result.passed,
    status: result.passed ? 'eligible' : 'blocked',
    reasons: result.reasons,
    checks: result.checks,
    requiredMinCommits: definition.requirements.minCommits,
    requiredMinRepositories: definition.requirements.minRepositories,
    provenCommits,
    provenRepositories,
    proofFiles,
  }
}
