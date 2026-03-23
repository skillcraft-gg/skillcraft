import { skillcraftGlobalDir, skillcraftConfigPath, skillcraftReposPath, trackedCredentialsPath, localSkillcraftConfig } from './paths.js'
import {
  ConfigSchema,
  ReposFileSchema,
  RepoEntry,
  TrackedCredentialsFileSchema,
  type Config,
  type ReposFile,
  type TrackedCredentialEntry,
  type TrackedCredentialsFile,
} from './types.js'
import { ensureDir, readJson, writeJson } from './fs.js'

export async function loadGlobalConfig(): Promise<Config> {
  const raw = await readJson<unknown>(skillcraftConfigPath())
  const parsed = ConfigSchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return ConfigSchema.parse({})
  }
  return parsed.data
}

export async function loadLocalConfig(repoPath: string): Promise<Config> {
  const raw = await readJson<unknown>(localSkillcraftConfig(repoPath))
  const parsed = ConfigSchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return ConfigSchema.parse({})
  }

  return parsed.data
}

export async function saveGlobalConfig(config: Config): Promise<void> {
  await ensureDir(skillcraftGlobalDir())
  await writeJson(skillcraftConfigPath(), config)
}

export async function loadRepos(): Promise<ReposFile> {
  const raw = await readJson<unknown>(skillcraftReposPath())
  const parsed = ReposFileSchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return { repos: [] }
  }
  return parsed.data
}

export async function saveRepos(file: ReposFile): Promise<void> {
  await ensureDir(skillcraftGlobalDir())
  await writeJson(skillcraftReposPath(), file)
}

export async function addRepo(entry: RepoEntry): Promise<void> {
  const repos = await loadRepos()
  const next = repos.repos.filter((item) => item.path !== entry.path)
  next.push(entry)
  await saveRepos({ repos: next })
}

export async function removeRepo(repoPath: string): Promise<void> {
  const repos = await loadRepos()
  const next = repos.repos.filter((item) => item.path !== repoPath)
  await saveRepos({ repos: next })
}

export async function loadTrackedCredentials(): Promise<TrackedCredentialsFile> {
  const raw = await readJson<unknown>(trackedCredentialsPath())
  const parsed = TrackedCredentialsFileSchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return { credentials: [] }
  }
  return parsed.data
}

export async function saveTrackedCredentials(file: TrackedCredentialsFile): Promise<void> {
  await ensureDir(skillcraftGlobalDir())
  await writeJson(trackedCredentialsPath(), file)
}

export async function addTrackedCredential(id: string): Promise<boolean> {
  const current = await loadTrackedCredentials()
  if (current.credentials.some((entry) => entry.id === id)) {
    return false
  }

  current.credentials.push({ id, trackedAt: new Date().toISOString() })
  current.credentials.sort(sortTrackedCredentialEntries)
  await saveTrackedCredentials(current)
  return true
}

export async function removeTrackedCredential(id: string): Promise<boolean> {
  const current = await loadTrackedCredentials()
  const before = current.credentials.length
  const next = current.credentials.filter((entry) => entry.id !== id)
  if (next.length === before) {
    return false
  }
  await saveTrackedCredentials({ credentials: next })
  return true
}

export function sortTrackedCredentialEntries(a: TrackedCredentialEntry, b: TrackedCredentialEntry): number {
  return a.id.localeCompare(b.id)
}

export function reposByPath(repos: ReposFile, repoPath: string): RepoEntry | undefined {
  return repos.repos.find((r) => r.path === repoPath)
}
