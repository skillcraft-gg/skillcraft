import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { detectAvailableAgents, parseAgentOptions, unsupportedAgentOptions } from '@/core/agents'
import { launchLearnMode, type LearnModeAgent } from '@/core/learn'
import { gitRoot, isGitRepo } from '@/core/git'
import { maybePromptToStarSkillcraft } from '@/lib/starPrompt'

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
  process.stdout.write('Skillcraft Learn Mode disabled. Run `skillcraft learn` to start another guided session.\n')
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
    if (!isInteractiveSelectionAllowed()) {
      throw new Error('Multiple supported agents detected (codex, opencode). Re-run with --agent opencode. Codex Learn Mode is coming soon.')
    }
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
  const rl = createInterface({ input, output })
  try {
    output.write('Multiple supported agents detected: codex, opencode\n')
    output.write('Select a learn-mode agent:\n')
    output.write('1. opencode\n')
    output.write('2. codex (coming soon)\n')

    const answer = (await rl.question('Agent: ')).trim()
    if (answer === '1' || answer.toLowerCase() === 'opencode') {
      return 'opencode'
    }
    if (answer === '2' || answer.toLowerCase() === 'codex') {
      throw new Error('Learn Mode for codex is not available yet. Re-run with 1 or --agent opencode.')
    }
    throw new Error('No valid learn-mode agent selection provided.')
  } finally {
    rl.close()
  }
}

function isInteractiveSelectionAllowed(): boolean {
  return (input.isTTY && output.isTTY) || process.env.SKILLCRAFT_FORCE_TTY === '1'
}
