import { isEnabled } from '@/core/state'
import { gitRemote } from '@/core/git'
import { loadProofFromRepo } from '@/core/progress'
import { addTrackedCredential, loadRepos, loadTrackedCredentials, removeTrackedCredential } from '@/core/config'
import { assertNonEmpty } from '@/core/validation'
import { evaluateRequirements, getCredentialIndexEntries, type CredentialIndexEntry, type CredentialRequirementResult, type RequirementCheck } from '@/core/credentials'
import { emitJson, getOutputMode, printBulletList, printEmpty, printHeader, printRows, printSection, printSuccess, printWarning } from '@/lib/output'

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
  const outputMode = options.outputMode ?? getOutputMode()
  const tracked = await resolveTrackedRepos()
  const trackedCredentials = await loadTrackedCredentials()

  const trackedCredList = trackedCredentials.credentials
  if (!trackedCredList.length) {
    if (outputMode === 'json') {
      emitJson(
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
    printHeader('Credential Progress')
    printEmpty('no credentials tracked')
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

  if (outputMode === 'json') {
    emitJson(payload)
    return
  }

  printHeader('Credential Progress')
  printSection('Evidence')
  printRows([
    { label: 'tracked credentials', value: trackedCredList.length },
    { label: 'tracked repositories', value: tracked.length },
    { label: 'proof files', value: proofFiles, tone: proofFiles ? 'success' : 'muted' },
    { label: 'proof commits', value: provenCommitList.length, tone: provenCommitList.length ? 'success' : 'muted' },
    { label: 'proof repositories', value: provenRepoList.length, tone: provenRepoList.length ? 'success' : 'muted' },
  ])

  printSection('Credentials')
  for (const entry of evaluated) {
    const summary = `${entry.credentialId}: ${entry.status}`
    if (entry.passed) {
      printSuccess(summary)
    } else {
      printWarning(summary)
    }

    printRows([
      { label: 'checks', value: entry.passed ? 'passed' : 'blocked', tone: entry.passed ? 'success' : 'warning' },
      {
        label: 'proof scope',
        value: `${entry.proofFiles} proofs, ${entry.provenCommits}/${entry.requiredMinCommits} commits, ${entry.provenRepositories}/${entry.requiredMinRepositories} repositories`,
      },
    ])

    if (entry.reasons.length) {
      printBulletList(entry.reasons)
    }
  }
}

export async function runProgressTrack(rawId: string): Promise<void> {
  const id = assertNonEmpty(rawId, 'credential id')
  const indexById = mapCredentials(await getCredentialIndexEntries())
  if (!indexById.has(id)) {
    throw new Error(`credential not found in credential index: ${id}`)
  }

  const added = await addTrackedCredential(id)
  const message = added ? `tracking credential: ${id}` : `credential already tracked: ${id}`
  if (getOutputMode() === 'json') {
    emitJson({ id, tracked: true, added, message })
    return
  }

  if (!added) {
    printWarning(message)
    return
  }
  printSuccess(message)
}

export async function runProgressUntrack(rawId: string): Promise<void> {
  const id = assertNonEmpty(rawId, 'credential id')
  const removed = await removeTrackedCredential(id)
  const message = removed ? `untracked credential: ${id}` : `credential not tracked: ${id}`
  if (getOutputMode() === 'json') {
    emitJson({ id, tracked: false, removed, message })
    return
  }

  if (!removed) {
    printWarning(message)
    return
  }
  printSuccess(message)
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
