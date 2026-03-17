import { isGitRepo, gitHeadCommit, gitLogWithMessages } from '@/core/git'
import { loadPending, currentProofIdForCommit } from '@/core/proof'
import { localSkillcraftConfig, contextPath, localRepoHookPath, localProofsDir } from '@/core/paths'
import { fileExists } from '@/core/fs'
import { isEnabled } from '@/core/state'

export async function runStatus(): Promise<void> {
  const cwd = process.cwd()
  const git = await isGitRepo(cwd)
  process.stdout.write(`git: ${git ? 'enabled' : 'not a repository'}\n`)

  const enabled = await isEnabled(cwd)
  process.stdout.write(`skillcraft: ${enabled ? 'enabled' : 'disabled'}\n`)

  if (!git || !enabled) {
    return
  }

  const pending = await loadPending(cwd)
  process.stdout.write(`pending skills: ${pending.length}\n`)
  const contextExists = await fileExists(contextPath(cwd))
  const hasHook = await fileExists(localRepoHookPath(cwd))
  process.stdout.write(`context file: ${contextExists ? 'present' : 'missing'}\n`)
  process.stdout.write(`post-commit hook: ${hasHook ? 'installed' : 'missing'}\n`)

  const head = await gitHeadCommit(cwd)
  const proofId = await currentProofIdForCommit(cwd, head)
  process.stdout.write(`head: ${head}\n`)
  process.stdout.write(`latest proof: ${proofId ?? 'none'}\n`)

  const logs = await gitLogWithMessages(cwd, 20)
  const withSkillcraft = logs.filter((entry) => entry.message.includes('Skillcraft-Ref:'))
  process.stdout.write(`recent commits with evidence: ${withSkillcraft.length}\n`)

  const proofDirExists = await fileExists(localProofsDir(cwd))
  process.stdout.write(`proof dir: ${proofDirExists ? 'present' : 'missing'}\n`)

  if (pending.length > 0) {
    process.stdout.write(`pending evidence queued: ${pending.join(', ')}\n`)
  }
}

export async function runDoctor(): Promise<void> {
  const cwd = process.cwd()
  const checks = [
    ['node', !!process.version],
    ['git', (await isGitRepo(cwd))],
    ['skillcraft config', await fileExists(localSkillcraftConfig(cwd))],
    ['plugin hook', await fileExists(localRepoHookPath(cwd))],
  ]

  for (const [name, ok] of checks) {
    process.stdout.write(`${name}: ${ok ? 'ok' : 'missing'}\n`)
  }

  if (!process.env.GITHUB_TOKEN && !(await isToolAvailable('gh'))) {
    process.stdout.write('gh: not installed\n')
    return
  }
  process.stdout.write('gh: available\n')
}

async function isToolAvailable(tool: string): Promise<boolean> {
  try {
    const { execSync } = await import('node:child_process')
    execSync(`command -v ${tool}`)
    return true
  } catch {
    return false
  }
}
