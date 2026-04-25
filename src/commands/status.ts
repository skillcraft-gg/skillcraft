import { detectAvailableAgents, loadEnabledAgents } from '@/core/agents'
import { loadLocalConfig } from '@/core/config'
import { fileExists } from '@/core/fs'
import { gitHasHeadCommit, gitHasRef, gitHeadCommit, gitLogWithMessages, gitRoot, isGitRepo } from '@/core/git'
import { hasInstalledPostCommitHook } from '@/core/hooks'
import { contextPath } from '@/core/paths'
import { currentProofIdForCommit, loadPending } from '@/core/proof'
import { isEnabled } from '@/core/state'
import { getProvider } from '@/providers'
import { emitJson, getOutputMode, printEmpty, printHeader, printRows, printSection, printSuccess, printWarning } from '@/lib/output'

export async function runStatus(): Promise<void> {
  const cwd = process.cwd()
  const git = await isGitRepo(cwd)
  const repoPath = git ? await gitRoot(cwd) : cwd

  const enabled = await isEnabled(repoPath)
  const gitStatus = git ? 'enabled' : 'not a repository'
  const skillcraftStatus = enabled ? 'enabled' : 'disabled'
  const payload: Record<string, unknown> = {
    repo: repoPath,
    git: gitStatus,
    skillcraft: skillcraftStatus,
  }

  if (!git || !enabled) {
    if (getOutputMode() === 'json') {
      emitJson(payload)
      return
    }

    printHeader('Skillcraft Status', repoPath)
    printRows([
      { label: 'git', value: gitStatus, tone: git ? 'success' : 'warning' },
      { label: 'skillcraft', value: skillcraftStatus, tone: enabled ? 'success' : 'warning' },
    ])
    return
  }

  const pending = await loadPending(repoPath)
  const agents = await loadEnabledAgents(repoPath)
  const contextExists = await fileExists(contextPath(repoPath))
  const hasHook = await hasInstalledPostCommitHook(repoPath)

  const config = await loadLocalConfig(repoPath)
  const branch = config.proofRef?.replace(/^refs\/heads\//, '') || 'skillcraft/proofs/v1'
  const proofBranchExists = await gitHasRef(repoPath, `refs/heads/${branch}`)
  const contextStatus = contextExists ? 'present' : 'missing'
  const hookStatus = hasHook ? 'installed' : 'missing'
  payload.pendingSkills = pending.length
  payload.pendingEvidence = pending
  payload.agents = agents
  payload.contextFile = contextStatus
  payload.postCommitHook = hookStatus
  payload.proofBranch = {
    name: branch,
    state: proofBranchExists ? 'present' : 'missing',
  }

  if (!(await gitHasHeadCommit(repoPath))) {
    payload.head = 'none'
    payload.latestProof = 'none'
    payload.recentCommitsWithEvidence = 0

    if (getOutputMode() === 'json') {
      emitJson(payload)
      return
    }

    printHeader('Skillcraft Status', repoPath)
    printSection('Repository')
    printRows([
      { label: 'git', value: gitStatus, tone: 'success' },
      { label: 'skillcraft', value: skillcraftStatus, tone: 'success' },
      { label: 'agents', value: agents.join(', ') || 'none' },
      { label: 'pending skills', value: pending.length, tone: pending.length ? 'warning' : 'default' },
      { label: 'context file', value: contextStatus, tone: contextExists ? 'success' : 'warning' },
      { label: 'post-commit hook', value: hookStatus, tone: hasHook ? 'success' : 'warning' },
      { label: 'head', value: 'none', tone: 'muted' },
      { label: 'latest proof', value: 'none', tone: 'muted' },
      { label: 'recent commits with evidence', value: 0 },
      { label: 'proof branch', value: proofBranchExists ? 'present' : 'missing', tone: proofBranchExists ? 'success' : 'warning' },
    ])
    if (pending.length > 0) {
      printWarning(`pending evidence queued: ${pending.join(', ')}`)
    }
    return
  }

  const head = await gitHeadCommit(repoPath)
  const proofId = await currentProofIdForCommit(repoPath, head)

  const logs = await gitLogWithMessages(repoPath, 20)
  const withSkillcraft = logs.filter((entry) => entry.message.includes('Skillcraft-Ref:'))
  payload.head = head
  payload.latestProof = proofId ?? 'none'
  payload.recentCommitsWithEvidence = withSkillcraft.length

  if (getOutputMode() === 'json') {
    emitJson(payload)
    return
  }

  printHeader('Skillcraft Status', repoPath)
  printSuccess(`skillcraft: ${enabled ? 'enabled' : 'disabled'}`)
  printSection('Repository')
  printRows([
    { label: 'git', value: gitStatus, tone: 'success' },
    { label: 'skillcraft', value: skillcraftStatus, tone: 'success' },
    { label: 'agents', value: agents.join(', ') || 'none', tone: agents.length ? 'success' : 'muted' },
    { label: 'pending skills', value: pending.length, tone: pending.length ? 'warning' : 'default' },
    { label: 'context file', value: contextStatus, tone: contextExists ? 'success' : 'warning' },
    { label: 'post-commit hook', value: hookStatus, tone: hasHook ? 'success' : 'warning' },
  ])
  printSection('Evidence')
  printRows([
    { label: 'head', value: head },
    { label: 'latest proof', value: proofId ?? 'none', tone: proofId ? 'success' : 'warning' },
    { label: 'recent commits with evidence', value: withSkillcraft.length, tone: withSkillcraft.length ? 'success' : 'muted' },
    { label: 'proof branch', value: proofBranchExists ? 'present' : 'missing', tone: proofBranchExists ? 'success' : 'warning' },
  ])

  if (pending.length > 0) {
    printWarning(`pending evidence queued: ${pending.join(', ')}`)
  } else {
    printEmpty('No pending evidence queued.')
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

  const detectedAgents = await detectAvailableAgents()

  const ghAvailable = checks.find(([name]) => name === 'gh')?.[1] ?? false
  let login = ''
  if (ghAvailable) {
    login = await getProvider('gh').getUser().catch(() => '')
  }

  const payload = {
    checks: checks.map(([name, ok]) => ({ name, status: ok ? 'ok' : 'missing' })),
    detectedAgents,
    ghAuth: ghAvailable ? (login ? 'ok' : 'missing') : 'missing',
    githubUser: ghAvailable ? (login || 'unknown') : 'unknown',
  }

  if (getOutputMode() === 'json') {
    emitJson(payload)
    return
  }

  printHeader('Skillcraft Doctor')
  printSection('Checks')
  printRows(checks.map(([name, ok]) => ({
    label: name,
    value: ok ? 'ok' : 'missing',
    tone: ok ? 'success' : 'warning',
  })))
  printSection('Environment')
  printRows([
    { label: 'detected agents', value: detectedAgents.length ? detectedAgents.join(', ') : 'none', tone: detectedAgents.length ? 'success' : 'muted' },
    { label: 'gh auth', value: payload.ghAuth, tone: payload.ghAuth === 'ok' ? 'success' : 'warning' },
    { label: 'github user', value: payload.githubUser, tone: login ? 'success' : 'muted' },
  ])

  if (!ghAvailable) {
    return
  }
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
