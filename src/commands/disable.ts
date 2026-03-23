import { isGitRepo, gitRoot } from '@/core/git'
import {
  localGitDir,
  localSkillcraftConfig,
  pendingPath,
  contextPath,
  pluginPath,
  managedPluginPath,
  aiModelContextPath,
} from '@/core/paths'
import { removePostCommitHook } from '@/core/hooks'
import { removeFile } from '@/core/fs'
import { removeRepo } from '@/core/config'

export async function runDisable(): Promise<void> {
  const cwd = process.cwd()
  if (!(await isGitRepo(cwd))) {
    throw new Error('Current directory is not a git repository')
  }
  const root = await gitRoot(cwd)

  await Promise.all([
    removeFile(localSkillcraftConfig(root)),
    removeFile(pendingPath(root)),
    removeFile(contextPath(root)),
    removeFile(pluginPath(root)),
    removeFile(managedPluginPath(root)),
    removeFile(aiModelContextPath(root)),
    removeFile(localGitDir(root)),
  ])
  await removePostCommitHook(root)
  await removeRepo(root)
  process.stdout.write(`disabled skillcraft for ${root}\n`)
}
