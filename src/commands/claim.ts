import { createHash } from 'node:crypto'
import yaml from 'yaml'
import { loadRepos } from '@/core/config'
import { hasSkillcraftDir } from '@/core/state'
import { loadProofFromRepo } from '@/core/progress'
import { getProvider } from '@/providers'
import { loadGlobalConfig } from '@/core/config'
import { gitRemote } from '@/core/git'

export async function runClaimList(): Promise<void> {
  const config = await loadGlobalConfig()
  const provider = getProvider(config.provider ?? 'gh')
  const issues = await provider.listClaimIssues('skillcraft-gg/credentials')
  if (!issues.length) {
    process.stdout.write('no claim issues found\n')
    return
  }
  for (const issue of issues) {
    process.stdout.write(`#${issue.number} ${issue.title} (${issue.state})\n`)
  }
}

export async function runClaimStatus(reference: string): Promise<void> {
  const issue = Number(reference)
  if (!issue) {
    throw new Error('claim status requires issue number')
  }
  const config = await loadGlobalConfig()
  const provider = getProvider(config.provider ?? 'gh')
  const status = await provider.getIssueStatus('skillcraft-gg/credentials', issue)
  process.stdout.write(`issue #${issue}\n`)
  process.stdout.write(`state: ${status.state}\n`)
  process.stdout.write(`labels: ${status.labels.join(', ') || 'none'}\n`)
  process.stdout.write(`url: ${status.url}\n`)
}

export async function runClaim(credential: string, opts: { allRepos?: boolean; repo?: string[] }): Promise<void> {
  const payload = await makeClaimPayload(credential, {
    allRepos: opts?.allRepos,
    repo: opts?.repo,
  })
  const yamlPayload = yaml.stringify(payload)
  const config = await loadGlobalConfig()
  const provider = getProvider(config.provider ?? 'gh')
  const issue = await provider.createIssue('skillcraft-gg/credentials', `claim: ${credential}`, yamlPayload)
  process.stdout.write(`opened claim: #${issue}\n`)
  process.stdout.write(`payload:\n${yamlPayload}\n`)
}

async function makeClaimPayload(
  credential: string,
  options: { allRepos?: boolean; repo?: string[] },
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

    const commitIds = Array.from(new Set(proofs.map((proof) => proof?.commit).filter(Boolean) as string[]))
    sources.push({
      repo: remote,
      commits: commitIds,
    })
  }

  const username = process.env.GITHUB_USER || process.env.USER || 'unknown'
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
