import { fileExists, readJson } from './fs.js'
import { localSkillcraftConfig, localGitDir } from './paths.js'
import { ConfigSchema } from './types.js'

export async function isEnabled(repoPath: string): Promise<boolean> {
  const configPath = localSkillcraftConfig(repoPath)
  if (!(await fileExists(configPath))) {
    return false
  }
  const raw = await readJson<unknown>(configPath)
  const parsed = ConfigSchema.safeParse(raw ?? {})
  return parsed.success
}

export async function hasSkillcraftDir(repoPath: string): Promise<boolean> {
  return fileExists(localGitDir(repoPath))
}
