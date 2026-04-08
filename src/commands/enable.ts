import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
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
  process.stdout.write(`enabled skillcraft for ${root} (agents: ${nextAgents.join(', ')})\n`)
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

  if (!input.isTTY || !output.isTTY) {
    throw new Error('Multiple supported agents detected (codex, opencode). Re-run with --agent codex, --agent opencode, or both.')
  }

  return promptForAgents(available)
}

async function promptForAgents(available: AgentIntegration[]): Promise<AgentIntegration[]> {
  const rl = createInterface({ input, output })
  try {
    output.write(`Multiple supported agents detected: ${available.join(', ')}\n`)
    output.write('Select one or more agents to enable (comma-separated, e.g. 1,2):\n')
    available.forEach((agent, index) => {
      output.write(`${index + 1}. ${agent}\n`)
    })

    const answer = await rl.question('Agents: ')
    const selected = sortAgents(answer.split(',').map((value) => {
      const trimmed = value.trim()
      const index = Number.parseInt(trimmed, 10)
      if (Number.isFinite(index) && index >= 1 && index <= available.length) {
        return available[index - 1]
      }
      return parseAgentOptions([trimmed])[0]
    }).filter((value): value is AgentIntegration => !!value))

    if (!selected.length) {
      throw new Error('No valid agent selection provided.')
    }
    return selected
  } finally {
    rl.close()
  }
}

function sortAgents(agents: readonly AgentIntegration[]): AgentIntegration[] {
  return Array.from(new Set(agents)).sort() as AgentIntegration[]
}
