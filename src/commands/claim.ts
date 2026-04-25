import { createHash } from 'node:crypto'
import yaml from 'yaml'
import { loadRepos } from '@/core/config'
import { hasSkillcraftDir } from '@/core/state'
import { loadProofFromRepo } from '@/core/progress'
import { getProvider } from '@/providers'
import { loadGlobalConfig } from '@/core/config'
import { gitIsAncestor, gitRemote } from '@/core/git'
import { findUnpushedCommits } from '@/core/remote'
import { maybePromptToStarSkillcraft } from '@/lib/starPrompt'
import { CommandError, emitJson, emitJsonError, getOutputMode, printBulletList, printEmpty, printHeader, printRows, printSection, printSuccess, printWarning } from '@/lib/output'

export async function runClaimList(): Promise<void> {
  const config = await loadGlobalConfig()
  const provider = getProvider(config.provider ?? 'gh')
  const claimant = await resolveClaimant(provider, config.githubUser)
  const issues = await provider.listClaimIssues('skillcraft-gg/credential-ledger')

  const matching = issues.filter((issue) => {
    const parsed = parseClaimMetadataFromBody(issue.body)
    return (
      parsed?.claimant === normalizeText(claimant) &&
      !!parsed?.credential
    )
  })

  const claims = matching.map((issue) => ({
    number: issue.number,
    title: issue.title,
    status: getClaimLifecycleStatus(issue.labels?.map((entry) => entry?.name) || []),
    url: issue.url,
  }))

  if (getOutputMode() === 'json') {
    emitJson({
      claimant,
      count: claims.length,
      claims,
    })
    return
  }

  if (!matching.length) {
    printHeader('Claims')
    printEmpty(`no claims found for ${claimant || 'user'}`)
    return
  }

  printHeader('Claims', claimant)
  printBulletList(claims.map((issue) => `#${issue.number} ${issue.title} (${issue.status})`))
}

export async function runClaimStatus(reference: string): Promise<void> {
  const credential = normalizeText(reference)
  if (!credential) {
    throw new Error('claim status requires a credential identifier')
  }

  const config = await loadGlobalConfig()
  const provider = getProvider(config.provider ?? 'gh')
  const claimant = await resolveClaimant(provider, config.githubUser)

  const issue = await findClaimIssue(provider, credential, claimant)
  if (!issue) {
    throw new Error(`No claim found for credential ${credential} for user ${claimant || 'unknown'}. Run "skillcraft claim" to see your claims.`)
  }

  const status = await provider.getIssueStatus('skillcraft-gg/credential-ledger', issue)
  const runs = await provider.listClaimProcessingRuns('skillcraft-gg/credential-ledger', issue)

  const payload = {
    credential,
    claimant,
    issue,
    state: getClaimLifecycleStatus(status.labels),
    labels: status.labels,
    url: status.url,
    processing: runs.length
      ? {
        status: runs[0].status,
        conclusion: runs[0].conclusion ?? undefined,
        url: runs[0].url,
        attempts: runs.length,
      }
      : undefined,
  }

  if (getOutputMode() === 'json') {
    emitJson(payload)
    return
  }

  printHeader('Claim Status', credential)
  process.stdout.write(`issue #${issue}\n`)
  process.stdout.write(`state: ${payload.state}\n`)
  process.stdout.write(`labels: ${status.labels.join(', ') || 'none'}\n`)
  process.stdout.write(`url: ${status.url}\n`)

  if (!runs.length) {
    process.stdout.write('processing actions: none found\n')
    return
  }

  const latest = runs[0]
  printSection('Processing')
  process.stdout.write(`processing actions: ${latest.status}${latest.conclusion ? ` (${latest.conclusion})` : ''}\n`)
  process.stdout.write(`latest run: ${latest.url}\n`)
  if (runs.length > 1) {
    process.stdout.write(`previous attempts: ${runs.length - 1}\n`)
  }
}

async function findClaimIssue(provider: ReturnType<typeof getProvider>, credential: string, claimant: string): Promise<number | undefined> {
  const issues = await provider.listClaimIssues('skillcraft-gg/credential-ledger')
  const normalizedCredential = normalizeText(credential)
  const normalizedClaimant = normalizeText(claimant)

  const matches = issues
    .map((issue) => {
      const parsed = parseClaimMetadataFromBody(issue.body)
      if (!parsed || parsed.claimant !== normalizedClaimant || parsed.credential !== normalizedCredential) {
        return undefined
      }

      return issue.number
    })
    .filter((value): value is number => !!value)

  return matches.sort((a, b) => b - a)[0]
}

async function findOpenClaimIssue(
  provider: ReturnType<typeof getProvider>,
  credential: string,
  claimant: string,
): Promise<{
  number: number
  state: string
  url?: string
  labels?: Array<{ name: string }>
} | undefined> {
  const issues = await provider.listClaimIssues('skillcraft-gg/credential-ledger')
  const normalizedCredential = normalizeText(credential)
  const normalizedClaimant = normalizeText(claimant)

  const matches = issues.filter((issue) => {
    if (normalizeText(issue.state) !== 'open') {
      return false
    }

    const parsed = parseClaimMetadataFromBody(issue.body)
    return !!parsed && parsed.claimant === normalizedClaimant && parsed.credential === normalizedCredential
  })

  return matches.sort((a, b) => a.number - b.number)[0]
}

export async function runClaim(credential: string, opts: { allRepos?: boolean; repo?: string[] }): Promise<void> {
  const config = await loadGlobalConfig()
  const provider = getProvider(config.provider ?? 'gh')

  const claimant = await resolveClaimant(provider, config.githubUser)

  const payload = await makeClaimPayload(credential, {
    allRepos: opts?.allRepos,
    repo: opts?.repo,
  }, claimant)

  const normalizedCredential = normalizeText(credential)
  const normalizedClaimant = normalizeText(claimant)

  const unpushed = await findUnpushedCommits(payload.sources)
  if (unpushed.length > 0) {
    const message = '⚠️ Warning: some claim commits may not be pushed yet. Please push recent commits before re-submitting the claim.'
    if (getOutputMode() === 'json') {
      emitJsonError(new CommandError(message, 'UNPUSHED_COMMITS'))
      process.exitCode = 1
      return
    }

    printHeader('Claim Blocked', credential)
    printWarning(message)
    printBulletList(unpushed.map((entry) => `${entry.commit} in ${entry.repo}`))
    process.exitCode = 1
    return
  }

  if (normalizedCredential && normalizedClaimant) {
    const existing = await findOpenClaimIssue(provider, normalizedCredential, normalizedClaimant)
    if (existing) {
      const url = existing.url || await provider.getIssueUrl('skillcraft-gg/credential-ledger', existing.number)
      const state = getClaimLifecycleStatus(existing.labels?.map((entry) => entry?.name) || [])
      if (getOutputMode() === 'json') {
        emitJson({
          credential,
          claimant,
          issue: existing.number,
          state,
          url,
          alreadySubmitted: true,
          message: 'claim already submitted',
        })
        return
      }

      printHeader('Claim Status', credential)
      printWarning('claim already submitted')
      printRows([
        { label: 'issue', value: `#${existing.number}` },
        { label: 'state', value: state, tone: 'warning' },
        { label: 'url', value: url },
      ])
      return
    }

    await ensureNotIssuedClaim(provider, normalizedCredential, normalizedClaimant)
  }

  const yamlPayload = yaml.stringify(payload)
  const issue = await provider.createIssue('skillcraft-gg/credential-ledger', `claim: ${credential}`, yamlPayload)
  if (getOutputMode() === 'json') {
    emitJson({
      credential,
      claimant,
      issue,
      payload,
      yaml: yamlPayload,
      message: `opened claim: #${issue}`,
    })
  } else {
    printHeader('Claim Opened', credential)
    printSuccess(`opened claim: #${issue}`)
    printSection('Claim Payload')
    process.stdout.write(`${yamlPayload}\n`)
  }
  await maybePromptToStarSkillcraft()
}

async function resolveClaimant(provider: ReturnType<typeof getProvider>, configuredUser?: string): Promise<string> {
  const envUser = process.env.GITHUB_USER || process.env.USER || ''
  try {
    const user = await provider.getUser()
    if (user) {
      return user
    }
  } catch {
  }
  return configuredUser || envUser || 'unknown'
}

function normalizeText(value: string) {
  return (value || '').trim().toLowerCase()
}

async function ensureNotIssuedClaim(provider: ReturnType<typeof getProvider>, credential: string, claimant: string): Promise<void> {
  const issues = await provider.listClaimIssues('skillcraft-gg/credential-ledger')

  const alreadyIssued = issues.find((issue) => {
    if (!issueHasLabel(issue, 'skillcraft-issued')) {
      return false
    }

    const parsed = parseClaimMetadataFromBody(issue.body)
    if (!parsed) {
      return false
    }

    return parsed.credential === credential && parsed.claimant === claimant
  })

  if (!alreadyIssued) {
    return
  }

  const suffix = alreadyIssued.url ? ` (${alreadyIssued.url})` : ''
  throw new Error(`You already have an issued claim for ${credential}. Existing issue: #${alreadyIssued.number}${suffix}`)
}

function parseClaimMetadataFromBody(body?: string): { credential: string; claimant: string } | undefined {
  if (!body) {
    return undefined
  }

  try {
    const normalizedBody = String(body).replace(/\\n/g, '\n')
    const parsed = yaml.parse(normalizedBody)
    if (!parsed || typeof parsed !== 'object') {
      return undefined
    }

    const rawCredential = parsed.credential && typeof parsed.credential === 'string' ? parsed.credential : parsed.credential?.id
    const rawClaimant = parsed.claimant?.github
    const credential = normalizeText(rawCredential)
    const claimant = normalizeText(rawClaimant)
    if (!credential || !claimant) {
      return undefined
    }
    return { credential, claimant }
  } catch {
    return undefined
  }
}

function issueHasLabel(issue: { labels?: Array<{ name: string }> }, expected: string): boolean {
  const normalized = expected.toLowerCase()
  return (issue.labels || []).some((entry) => normalizeText(entry?.name) === normalized)
}

function getClaimLifecycleStatus(labels: string[] | undefined): string {
  const normalized = new Set((labels || []).map((value) => normalizeText(value)))

  if (normalized.has('skillcraft-issued')) {
    return 'issued'
  }
  if (normalized.has('skillcraft-rejected')) {
    return 'rejected'
  }
  if (normalized.has('skillcraft-verified')) {
    return 'verified'
  }
  if (normalized.has('skillcraft-processing')) {
    return 'processing'
  }

  return 'pending'
}

async function makeClaimPayload(
  credential: string,
  options: { allRepos?: boolean; repo?: string[] },
  claimant = 'unknown',
): Promise<{
  claim_version: number
  claimant: { github: string }
  credential: { id: string }
  sources: Array<{ repo: string; commits: string[] }>
  claim_id: string
}> {
  const repos = await resolveClaimRepos(options)
  const sources = [] as Array<{ repo: string; commits: string[] }>
  for (const repoPath of repos) {
    const proofs = await loadProofFromRepo(repoPath)
    const remote = (await gitRemote(repoPath)) || repoPath

    const reachableProofs = await Promise.all(
      proofs.map(async (proof) => ((await gitIsAncestor(repoPath, proof.commit)) ? proof : undefined)),
    )

    const commitIds = Array.from(
      new Set(reachableProofs.map((proof) => proof?.commit).filter(Boolean) as string[]),
    )

    sources.push({
      repo: remote,
      commits: commitIds,
    })
  }

  const username = claimant
  const claimSeed = `${username}:${credential}:${sources.map((s) => `${s.repo}:${s.commits.length}`).join('|')}:${Date.now()}`
  const claimId = createHash('sha256').update(claimSeed).digest('hex').slice(0, 8)

  return {
    claim_version: 1,
    claimant: {
      github: username,
    },
    credential: {
      id: credential,
    },
    sources,
    claim_id: `sha256:${claimId}`,
  }
}

async function resolveClaimRepos(options: { allRepos?: boolean; repo?: string[] }): Promise<string[]> {
  const repoList = options.allRepos ? (await loadRepos()).repos.map((entry) => entry.path) : [process.cwd()]
  const selected = options.repo ? options.repo : repoList
  const valid = [] as string[]
  for (const repoPath of selected) {
    if (!(await hasSkillcraftDir(repoPath))) {
      continue
    }
    valid.push(repoPath)
  }
  return valid
}
