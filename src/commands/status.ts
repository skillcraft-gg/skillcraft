import { detectAvailableAgents, loadEnabledAgents } from '@/core/agents'
import { loadLocalConfig } from '@/core/config'
import { fileExists } from '@/core/fs'
import { gitHasRef, gitHeadCommit, gitLogWithMessages, gitRoot, isGitRepo } from '@/core/git'
import { contextPath, localRepoHookPath } from '@/core/paths'
import { currentProofIdForCommit, loadPending } from '@/core/proof'
import { isEnabled } from '@/core/state'
import { getProvider } from '@/providers'

export async function runStatus(): Promise<void> {
  const cwd = process.cwd()
  const git = await isGitRepo(cwd)
  process.stdout.write(`git: ${git ? 'enabled' : 'not a repository'}\n`)
  const repoPath = git ? await gitRoot(cwd) : cwd

  const enabled = await isEnabled(repoPath)
  process.stdout.write(`skillcraft: ${enabled ? 'enabled' : 'disabled'}\n`)

  if (!git || !enabled) {
    return
  }

  const pending = await loadPending(repoPath)
  const agents = await loadEnabledAgents(repoPath)
  process.stdout.write(`pending skills: ${pending.length}\n`)
  process.stdout.write(`agents: ${agents.length ? agents.join(', ') : 'none'}\n`)
  const contextExists = await fileExists(contextPath(repoPath))
  const hasHook = await fileExists(localRepoHookPath(repoPath))
  process.stdout.write(`context file: ${contextExists ? 'present' : 'missing'}\n`)
  process.stdout.write(`post-commit hook: ${hasHook ? 'installed' : 'missing'}\n`)

  const head = await gitHeadCommit(repoPath)
  const proofId = await currentProofIdForCommit(repoPath, head)
  process.stdout.write(`head: ${head}\n`)
  process.stdout.write(`latest proof: ${proofId ?? 'none'}\n`)

  const logs = await gitLogWithMessages(repoPath, 20)
  const withSkillcraft = logs.filter((entry) => entry.message.includes('Skillcraft-Ref:'))
  process.stdout.write(`recent commits with evidence: ${withSkillcraft.length}\n`)

  const config = await loadLocalConfig(repoPath)
  const branch = config.proofRef?.replace(/^refs\/heads\//, '') || 'skillcraft/proofs/v1'
  const proofBranchExists = await gitHasRef(repoPath, `refs/heads/${branch}`)
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
    checkTool('codex'),
    checkTool('opencode'),
  ])

  for (const [name, ok] of checks) {
    process.stdout.write(`${name}: ${ok ? 'ok' : 'missing'}\n`)
  }

  const detectedAgents = await detectAvailableAgents()
  process.stdout.write(`detected agents: ${detectedAgents.length ? detectedAgents.join(', ') : 'none'}\n`)

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
