import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { git } from './git'

export type RemoteSourceEntry = {
  repo: string
  commits: string[]
}

export type UnpushedCommit = {
  repo: string
  commit: string
}

export type RepoRemote = {
  name: string
  url: string
}

export function normalizeRemoteSource(rawRepo: string): string | undefined {
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

  if (repo.startsWith('file://')) {
    return repo
  }

  return undefined
}

export async function listRemotes(repoPath: string): Promise<RepoRemote[]> {
  try {
    const raw = await git(['config', '--get-regexp', '^remote\..*\.url$'], repoPath)
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(' ')
        if (separator === -1) {
          return undefined
        }

        const key = line.slice(0, separator)
        const url = line.slice(separator + 1).trim()
        const name = key.slice('remote.'.length, -'.url'.length)

        if (!url || !name) {
          return undefined
        }

        return { name, url }
      })
      .filter((value): value is RepoRemote => !!value)
  } catch {
    return []
  }
}

export async function findUnpushedCommits(sources: ReadonlyArray<RemoteSourceEntry>): Promise<UnpushedCommit[]> {
  return findUnpushedCommitsWithOptions(sources, { normalize: true })
}

export async function findUnpushedCommitsWithOptions(
  sources: ReadonlyArray<RemoteSourceEntry>,
  options: { normalize?: boolean } = {},
): Promise<UnpushedCommit[]> {
  const normalize = options.normalize ?? true
  const unpushed: UnpushedCommit[] = []

  for (const source of sources) {
    const remote = normalize ? normalizeRemoteSource(source.repo) : source.repo
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

    const missing = await findMissingCommitsInRemote(remote, commitList)
    for (const commit of missing) {
      unpushed.push({ repo: remote, commit })
    }
  }

  return unpushed
}

export async function findMissingCommitsInRemote(remoteUrl: string, commits: string[]): Promise<string[]> {
  const commitList = Array.from(new Set(commits.map((commit) => commit.trim()).filter(Boolean)))
  if (!commitList.length) {
    return []
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'skillcraft-remote-check-'))
  try {
    try {
      await git(['clone', '--quiet', '--no-checkout', remoteUrl, tempDir], process.cwd())
    } catch {
      return commitList
    }

    const missing: string[] = []
    for (const commit of commitList) {
      const isPushed = await isCommitOnRemote(tempDir, commit)
      if (!isPushed) {
        missing.push(commit)
      }
    }

    return missing
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
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
