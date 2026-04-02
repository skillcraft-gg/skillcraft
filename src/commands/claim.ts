import { createHash } from 'node:crypto'
import yaml from 'yaml'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { loadRepos } from '@/core/config'
import { hasSkillcraftDir } from '@/core/state'
import { loadProofFromRepo } from '@/core/progress'
import { getProvider } from '@/providers'
import { loadGlobalConfig } from '@/core/config'
import { git, gitRemote } from '@/core/git'

export async function runClaimList(): Promise<void> {
  const config = await loadGlobalConfig()
  const provider = getProvider(config.provider ?? 'gh')
  const issues = await provider.listClaimIssues('skillcraft-gg/credential-ledger')
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
  const status = await provider.getIssueStatus('skillcraft-gg/credential-ledger', issue)
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

  const unpushed = await findUnpushedCommits(payload.sources)
  if (unpushed.length > 0) {
    process.stdout.write('⚠️ Warning: some claim commits may not be pushed yet. Please push recent commits before re-submitting the claim.\n')
    for (const entry of unpushed) {
      process.stdout.write(`- ${entry.commit} in ${entry.repo}\n`)
    }
    process.exitCode = 1
    return
  }

  const yamlPayload = yaml.stringify(payload)
  const config = await loadGlobalConfig()
  const provider = getProvider(config.provider ?? 'gh')
  const issue = await provider.createIssue('skillcraft-gg/credential-ledger', `claim: ${credential}`, yamlPayload)
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

type UnpushedCommit = {
  repo: string
  commit: string
}

async function findUnpushedCommits(sources: Array<{ repo: string; commits: string[] }>): Promise<UnpushedCommit[]> {
  const unpushed: UnpushedCommit[] = []

  for (const source of sources) {
    const remote = normalizeRemoteSource(source.repo)
    if (!remote) {
      for (const commit of source.commits) {
        unpushed.push({ repo: source.repo, commit })
      }
      continue
    }

    const commitList = Array.from(new Set(source.commits.map((commit) => commit.trim()).filter(Boolean)))
    if (!commitList.length) {
      continue
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'skillcraft-claim-check-'))
    try {
      try {
        await git(['clone', '--quiet', '--no-checkout', remote, tempDir])
      } catch {
        for (const commit of commitList) {
          unpushed.push({ repo: remote, commit })
        }
        continue
      }

      for (const commit of commitList) {
        const isPushed = await isCommitOnRemote(tempDir, commit)
        if (!isPushed) {
          unpushed.push({ repo: remote, commit })
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  return unpushed
}

async function isCommitOnRemote(repoDir: string, commit: string): Promise<boolean> {
  try {
    await git(['cat-file', '-e', `${commit}^{commit}`], repoDir)
  } catch {
    return false
  }

  try {
    const output = await git(['branch', '-r', '--contains', commit], repoDir)
    return !!output
  } catch {
    return false
  }
}

function normalizeRemoteSource(rawRepo: string): string | undefined {
  const repo = rawRepo.trim()
  if (!repo) {
    return undefined
  }

  if (/^[a-zA-Z]:[\\/]/.test(repo) || repo.startsWith('/') || repo.startsWith('./') || repo.startsWith('../')) {
    return undefined
  }

  if (/^[a-z][a-z0-9+.-]*:/.test(repo)) {
    return repo
  }

  if (repo.startsWith('git@') || repo.startsWith('ssh://') || repo.startsWith('http://') || repo.startsWith('https://')) {
    return repo
  }

  return undefined
}
