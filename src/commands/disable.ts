import { removeRepo } from '@/core/config'
import {
  disableAgentIntegration,
  loadEnabledAgents,
  parseAgentOptions,
  saveEnabledAgents,
  unsupportedAgentOptions,
} from '@/core/agents'
import { removeFile, removePath } from '@/core/fs'
import { gitRoot, isGitRepo } from '@/core/git'
import { removePostCommitHook } from '@/core/hooks'
import { aiModelContextPath, localGitDir, localSkillcraftConfig, pendingPath, contextPath, pluginPath } from '@/core/paths'
import { type AgentIntegration } from '@/core/types'
import { emitJson, getOutputMode, printHeader, printRows, printSuccess } from '@/lib/output'

type DisableOptions = {
  agents?: string[]
}

export async function runDisable(options: DisableOptions = {}): Promise<void> {
  const cwd = process.cwd()
  if (!(await isGitRepo(cwd))) {
    throw new Error('Current directory is not a git repository')
  }
  const root = await gitRoot(cwd)
  const currentAgents = await loadEnabledAgents(root)
  const targetAgents = resolveDisableAgents(options.agents || [], currentAgents)

  for (const agent of targetAgents) {
    await disableAgentIntegration(root, agent)
  }

  const remainingAgents = currentAgents.filter((agent) => !targetAgents.includes(agent))
  if (remainingAgents.length) {
    await saveEnabledAgents(root, remainingAgents)
    const message = `disabled skillcraft agents for ${root} (remaining: ${remainingAgents.join(', ')})`
    if (getOutputMode() === 'json') {
      emitJson({
        repo: root,
        disabled: false,
        removedAgents: targetAgents,
        remainingAgents,
        message,
      })
      return
    }

    printHeader('Skillcraft Updated', root)
    printSuccess(message)
    printRows([
      { label: 'removed agents', value: targetAgents.join(', ') || 'none' },
      { label: 'remaining agents', value: remainingAgents.join(', '), tone: 'success' },
    ])
    return
  }

  await removeGenericSkillcraftState(root)
  const message = `disabled skillcraft for ${root}`
  if (getOutputMode() === 'json') {
    emitJson({
      repo: root,
      disabled: true,
      removedAgents: targetAgents,
      remainingAgents: [],
      message,
    })
    return
  }

  printHeader('Skillcraft Disabled', root)
  printSuccess(message)
}

function resolveDisableAgents(rawAgents: readonly string[], currentAgents: AgentIntegration[]): AgentIntegration[] {
  const invalid = unsupportedAgentOptions(rawAgents)
  if (invalid.length) {
    throw new Error(`Unsupported agent value: ${invalid.join(', ')}`)
  }

  if (!currentAgents.length) {
    return []
  }

  const requested = parseAgentOptions(rawAgents)
  if (!requested.length) {
    return currentAgents
  }

  const active = requested.filter((agent) => currentAgents.includes(agent))
  if (!active.length) {
    throw new Error(`None of the requested agents are enabled in this repository: ${requested.join(', ')}`)
  }

  return active
}

async function removeGenericSkillcraftState(root: string): Promise<void> {
  await Promise.all([
    removeFile(localSkillcraftConfig(root)),
    removeFile(pendingPath(root)),
    removeFile(contextPath(root)),
    removeFile(pluginPath(root)),
    removeFile(aiModelContextPath(root)),
    removePath(localGitDir(root)),
  ])
  await removePostCommitHook(root)
  await removeRepo(root)
}
