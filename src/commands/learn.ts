import { detectAvailableAgents, parseAgentOptions, unsupportedAgentOptions } from '@/core/agents'
import { launchLearnMode, type LearnModeAgent } from '@/core/learn'
import { gitRoot, isGitRepo } from '@/core/git'
import { maybePromptToStarSkillcraft } from '@/lib/starPrompt'
import { emitJson, getOutputMode, printHeader, printInfo, printOutro, printRows } from '@/lib/output'
import { promptSelect } from '@/lib/prompts'

type LearnOptions = {
  agents?: string[]
}

export async function runLearn(options: LearnOptions = {}): Promise<void> {
  const cwd = process.cwd()
  if (!(await isGitRepo(cwd))) {
    throw new Error('Current directory is not a git repository')
  }

  const root = await gitRoot(cwd)
  const agent = await resolveLearnAgent(options.agents || [])
  const result = await launchLearnMode(root, agent)
  const message = 'Skillcraft Learn Mode disabled. Run `skillcraft learn` to start another guided session.'

  if (getOutputMode() === 'json') {
    emitJson({
      repo: root,
      agent,
      exitCode: result.exitCode,
      message,
    })
  } else {
    printHeader('Learn Mode', root)
    printInfo('Guided session finished.')
    printRows([
      { label: 'agent', value: agent, tone: 'success' },
      { label: 'exit code', value: result.exitCode, tone: result.exitCode === 0 ? 'success' : 'warning' },
    ])
    printOutro(message)
  }

  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode
    return
  }

  await maybePromptToStarSkillcraft()
}

async function resolveLearnAgent(rawAgents: readonly string[]): Promise<LearnModeAgent> {
  const invalid = unsupportedAgentOptions(rawAgents)
  if (invalid.length) {
    throw new Error(`Unsupported agent value: ${invalid.join(', ')}`)
  }

  const available = await detectAvailableAgents()
  const requested = parseAgentOptions(rawAgents)
  if (requested.length) {
    return resolveRequestedLearnAgent(requested, available)
  }

  const hasOpenCode = available.includes('opencode')
  const hasCodex = available.includes('codex')

  if (!hasOpenCode && !hasCodex) {
    throw new Error('No supported AI coding agents detected. Install opencode to use `skillcraft learn`.')
  }

  if (hasOpenCode && hasCodex) {
    return promptForLearnAgent()
  }

  if (hasOpenCode) {
    return 'opencode'
  }

  throw new Error('Learn Mode for codex is not available yet. Install opencode and re-run with --agent opencode.')
}

function resolveRequestedLearnAgent(
  requested: ReturnType<typeof parseAgentOptions>,
  available: Awaited<ReturnType<typeof detectAvailableAgents>>,
): LearnModeAgent {
  if (requested.includes('codex')) {
    throw new Error('Learn Mode for codex is not available yet. Re-run with --agent opencode.')
  }

  if (!requested.includes('opencode')) {
    throw new Error('No valid learn-mode agent selection provided.')
  }

  if (!available.includes('opencode')) {
    throw new Error('OpenCode is not installed. Install opencode to use `skillcraft learn --agent opencode`.')
  }

  return 'opencode'
}

async function promptForLearnAgent(): Promise<LearnModeAgent> {
  process.stdout.write('Multiple supported agents detected: codex, opencode\n')
  process.stdout.write('Select a learn-mode agent:\n')
  process.stdout.write('1. opencode\n')
  process.stdout.write('2. codex (coming soon)\n')

  const selected = await promptSelect({
    message: 'Select a learn-mode agent',
    options: [
      { value: 'opencode', label: 'opencode', hint: 'Available now' },
      { value: 'codex', label: 'codex', hint: 'Coming soon' },
    ],
    missingInteractiveMessage: 'Multiple supported agents detected (codex, opencode). Re-run with --agent opencode. Codex Learn Mode is coming soon.',
  })

  if (selected === 'codex') {
    throw new Error('Learn Mode for codex is not available yet. Re-run with --agent opencode.')
  }

  return 'opencode'
}
