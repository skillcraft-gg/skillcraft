import { addRepo, loadGlobalConfig, saveGlobalConfig } from '@/core/config'
import {
  detectAvailableAgents,
  enableAgentIntegration,
  ensureAiModelContext,
  loadEnabledAgents,
  parseAgentOptions,
  saveEnabledAgents,
  unsupportedAgentOptions,
} from '@/core/agents'
import { ensureDir, writeJson } from '@/core/fs'
import { gitCreateUnrelatedBranch, gitHasRef, gitRemote, gitRoot, isGitRepo } from '@/core/git'
import { installPostCommitHook } from '@/core/hooks'
import { contextPath, localGitDir, localSkillcraftConfig, pendingPath, skillcraftGlobalDir } from '@/core/paths'
import { DefaultProofRef, type AgentIntegration } from '@/core/types'
import { getProvider } from '@/providers'
import { emitJson, getOutputMode, printHeader, printRows, printSection, printSuccess } from '@/lib/output'
import { promptMultiSelect } from '@/lib/prompts'

type EnableOptions = {
  agents?: string[]
}

export async function runEnable(options: EnableOptions = {}): Promise<void> {
  const cwd = process.cwd()
  if (!(await isGitRepo(cwd))) {
    throw new Error('Current directory is not a git repository')
  }
  const root = await gitRoot(cwd)
  const requestedAgents = await resolveRequestedAgents(options.agents || [])

  const config = await loadGlobalConfig()
  if (!config.githubUser) {
    const provider = getProvider(config.provider ?? 'gh')
    const fallback = await provider.getUser().catch(() => process.env.GITHUB_USER || process.env.USER || 'developer')
    await saveGlobalConfig({ ...config, githubUser: fallback })
  }

  await ensureDir(localGitDir(root))

  const branchRef = `refs/heads/${DefaultProofRef}`
  if (!(await gitHasRef(root, branchRef))) {
    await gitCreateUnrelatedBranch(root, DefaultProofRef, 'Initialize Skillcraft proofs branch')
  }

  await writeJson(localSkillcraftConfig(root), {
    version: 1,
    proofRef: DefaultProofRef,
  })
  await ensureDir(skillcraftGlobalDir())
  await writeJson(pendingPath(root), { skills: [] })
  await writeJson(contextPath(root), { activeLoadouts: [] })

  const existingAgents = await loadEnabledAgents(root)
  const nextAgents = sortAgents([...existingAgents, ...requestedAgents])
  for (const agent of requestedAgents) {
    await enableAgentIntegration(root, agent)
  }
  await ensureAiModelContext(root, nextAgents[0] || 'opencode')
  await saveEnabledAgents(root, nextAgents)
  await installPostCommitHook(root)

  const remote = await gitRemote(root)
  await addRepo({ path: root, remote, enabledAt: new Date().toISOString() })

  const message = `enabled skillcraft for ${root} (agents: ${nextAgents.join(', ')})`
  if (getOutputMode() === 'json') {
    emitJson({
      repo: root,
      enabled: true,
      agents: nextAgents,
      remote: remote || undefined,
      proofBranch: DefaultProofRef,
      message,
    })
    return
  }

  printHeader('Skillcraft Enabled', root)
  printSuccess(message)
  printSection('Configuration')
  printRows([
    { label: 'agents', value: nextAgents.join(', '), tone: 'success' },
    { label: 'proof branch', value: DefaultProofRef },
    { label: 'remote', value: remote || 'none', tone: remote ? 'default' : 'muted' },
  ])
}

async function resolveRequestedAgents(rawAgents: readonly string[]): Promise<AgentIntegration[]> {
  const invalid = unsupportedAgentOptions(rawAgents)
  if (invalid.length) {
    throw new Error(`Unsupported agent value: ${invalid.join(', ')}`)
  }

  const requested = parseAgentOptions(rawAgents)
  if (requested.length) {
    return requested
  }

  const available = await detectAvailableAgents()
  if (!available.length) {
    throw new Error('No supported AI coding agents detected. Install opencode or codex, or pass --agent explicitly.')
  }
  if (available.length === 1) {
    return available
  }

  return promptForAgents(available)
}

async function promptForAgents(available: AgentIntegration[]): Promise<AgentIntegration[]> {
  const selected = await promptMultiSelect({
    message: 'Select one or more agents to enable',
    options: available.map((agent) => ({
      value: agent,
      label: agent,
      hint: `Enable ${agent} integration`,
    })),
    requiredMessage: 'No valid agent selection provided.',
    missingInteractiveMessage: 'Multiple supported agents detected (codex, opencode). Re-run with --agent codex, --agent opencode, or both.',
  })

  return sortAgents(selected)
}

function sortAgents(agents: readonly AgentIntegration[]): AgentIntegration[] {
  return Array.from(new Set(agents)).sort() as AgentIntegration[]
}
