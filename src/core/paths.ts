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

export function trackedCredentialsPath(): string {
  return path.join(skillcraftGlobalDir(), 'credentials.json')
}

export function credentialIndexCachePath(): string {
  return path.join(skillcraftGlobalDir(), 'cache', 'credentials', 'index.json')
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

export function localRepoHookPath(repoPath: string): string {
  return path.join(repoPath, '.git', 'hooks', 'post-commit')
}

export function localRepoPrePushHookPath(repoPath: string): string {
  return path.join(repoPath, '.git', 'hooks', 'pre-push')
}

export function localRepoPostPushHookPath(repoPath: string): string {
  return path.join(repoPath, '.git', 'hooks', 'post-push')
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

export function managedPluginPath(repoPath: string): string {
  return opencodePluginPath(repoPath)
}

export function opencodePluginPath(repoPath: string): string {
  return path.join(repoPath, '.opencode', 'plugins', 'skillcraft.mjs')
}

export function codexConfigPath(repoPath: string): string {
  return path.join(repoPath, '.codex', 'config.toml')
}

export function codexHooksPath(repoPath: string): string {
  return path.join(repoPath, '.codex', 'hooks.json')
}

export function codexMarketplacePath(repoPath: string): string {
  return path.join(repoPath, '.agents', 'plugins', 'marketplace.json')
}

export function codexPluginRootPath(repoPath: string): string {
  return path.join(repoPath, 'plugins', 'skillcraft-codex')
}

export function codexPluginManifestPath(repoPath: string): string {
  return path.join(codexPluginRootPath(repoPath), '.codex-plugin', 'plugin.json')
}

export function codexPluginSkillPath(repoPath: string): string {
  return path.join(codexPluginRootPath(repoPath), 'skills', 'skillcraft', 'SKILL.md')
}

export function projectSkillsRootPath(repoPath: string): string {
  return path.join(repoPath, '.agents', 'skills')
}

export function installedSkillsIndexPath(repoPath: string): string {
  return path.join(projectSkillsRootPath(repoPath), '.skillcraft-index.json')
}

export function aiModelContextPath(repoPath: string): string {
  return path.join(localGitDir(repoPath), 'ai-model-context.json')
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
