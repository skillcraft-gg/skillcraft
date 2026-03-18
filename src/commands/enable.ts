import { isGitRepo, gitRoot, gitRemote } from '@/core/git'
import {
  skillcraftGlobalDir,
  localGitDir,
  localSkillcraftConfig,
  pluginPath,
  pendingPath,
  contextPath,
} from '@/core/paths'
import { ensureDir, writeJson } from '@/core/fs'
import { addRepo, loadGlobalConfig, saveGlobalConfig } from '@/core/config'
import { installPostCommitHook } from '@/core/hooks'
import { DefaultProofRef } from '@/core/types'
import { git, gitHasRef } from '@/core/git'

export async function runEnable(): Promise<void> {
  const cwd = process.cwd()
  if (!(await isGitRepo(cwd))) {
    throw new Error('Current directory is not a git repository')
  }
  const root = await gitRoot(cwd)

  const config = await loadGlobalConfig()
  if (!config.githubUser) {
    const fallback = process.env.GITHUB_USER || process.env.USER || 'developer'
    await saveGlobalConfig({ ...config, githubUser: fallback })
  }

  await ensureDir(localGitDir(root))
  const branchRef = `refs/heads/${DefaultProofRef}`
  if (!(await gitHasRef(root, branchRef))) {
    await git(['branch', DefaultProofRef], root)
  }
  await writeJson(localSkillcraftConfig(root), {
    version: 1,
    proofRef: DefaultProofRef,
  })
  await ensureDir(skillcraftGlobalDir())
  await writeJson(pendingPath(root), { skills: [] })
  await writeJson(contextPath(root), { activeLoadouts: [] })
  await writeJson(pluginPath(root), {
    version: 1,
    providers: ['opencode'],
    enabled: true,
  })
  await installPostCommitHook(root)

  const remote = await gitRemote(root)
  await addRepo({ path: root, remote, enabledAt: new Date().toISOString() })
  process.stdout.write(`enabled skillcraft for ${root}\n`)
}
