import { isGitRepo, gitHeadCommit, gitLogWithMessages, gitHasRef } from '@/core/git'
import { loadPending, currentProofIdForCommit } from '@/core/proof'
import { contextPath, localRepoHookPath } from '@/core/paths'
import { fileExists } from '@/core/fs'
import { isEnabled } from '@/core/state'
import { loadLocalConfig } from '@/core/config'
import { getProvider } from '@/providers'

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

  const config = await loadLocalConfig(cwd)
  const branch = config.proofRef?.replace(/^refs\/heads\//, '') || 'skillcraft/proofs/v1'
  const proofBranchExists = await gitHasRef(cwd, `refs/heads/${branch}`)
  process.stdout.write(`proof branch: ${proofBranchExists ? 'present' : 'missing'}\n`)

  if (pending.length > 0) {
    process.stdout.write(`pending evidence queued: ${pending.join(', ')}\n`)
  }
}

export async function runDoctor(): Promise<void> {
  const checks = await Promise.all([
    checkTool('node'),
    checkTool('npm'),
    checkTool('git'),
    checkTool('gh'),
    checkTool('opencode'),
  ])

  for (const [name, ok] of checks) {
    process.stdout.write(`${name}: ${ok ? 'ok' : 'missing'}\n`)
  }

  const ghAvailable = checks.find(([name]) => name === 'gh')?.[1] ?? false
  if (!ghAvailable) {
    process.stdout.write('gh auth: missing\n')
    process.stdout.write('github user: unknown\n')
    return
  }

  const login = await getProvider('gh').getUser().catch(() => '')
  process.stdout.write(`gh auth: ${login ? 'ok' : 'missing'}\n`)
  process.stdout.write(`github user: ${login || 'unknown'}\n`)
}

async function checkTool(tool: string): Promise<[string, boolean]> {
  return [tool, await isToolAvailable(tool)]
}

async function isToolAvailable(tool: string): Promise<boolean> {
  try {
    const { execSync } = await import('node:child_process')
    execSync(`command -v ${tool}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
