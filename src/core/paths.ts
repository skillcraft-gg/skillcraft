import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

function defaultUserDir(): string {
  return path.resolve(process.env.HOME || os.homedir(), '.skillcraft')
}

export function skillcraftGlobalDir(): string {
  return defaultUserDir()
}

export function skillcraftConfigPath(): string {
  return path.join(skillcraftGlobalDir(), 'config.json')
}

export function skillcraftReposPath(): string {
  return path.join(skillcraftGlobalDir(), 'repos.json')
}

export function localStateDir(repoPath: string): string {
  return path.join(repoPath, '.skillcraft')
}

export function localGitDir(repoPath: string): string {
  return path.join(repoPath, '.git', 'skillcraft')
}

export function localSkillcraftConfig(repoPath: string): string {
  return path.join(localStateDir(repoPath), '.skillcraft.json')
}

export function localProofsDir(repoPath: string): string {
  return path.join(repoPath, '.git', 'refs', 'skillcraft', 'checkpoints', 'v1')
}

export function localRepoHookPath(repoPath: string): string {
  return path.join(repoPath, '.git', 'hooks', 'post-commit')
}

export function pendingPath(repoPath: string): string {
  return path.join(localGitDir(repoPath), 'pending.json')
}

export function contextPath(repoPath: string): string {
  return path.join(localGitDir(repoPath), 'context.json')
}

export function pluginPath(repoPath: string): string {
  return path.join(localGitDir(repoPath), 'agent.json')
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
