import { skillcraftGlobalDir, skillcraftConfigPath, skillcraftReposPath } from './paths.js'
import { ConfigSchema, ReposFileSchema, RepoEntry, type Config, type ReposFile } from './types.js'
import { ensureDir, readJson, writeJson } from './fs.js'

export async function loadGlobalConfig(): Promise<Config> {
  const raw = await readJson<unknown>(skillcraftConfigPath())
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

export function reposByPath(repos: ReposFile, repoPath: string): RepoEntry | undefined {
  return repos.repos.find((r) => r.path === repoPath)
}
